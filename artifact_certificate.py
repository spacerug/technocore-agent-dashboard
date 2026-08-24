"""Create safe, signed pre-genesis digital-artifact packages.

This module does not mint a token.  It creates a portable artwork copy and an
independently verifiable Ed25519 certificate tied to the user's existing DID.
The GUI may then publish a short declaration through Technocore.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature

from technocore_core import (
    DashboardError,
    Identity,
    SendResult,
    clean_text,
    public_key_for_did,
    public_receipt,
)


SCHEMA = "technocore-agent-dashboard/pre-genesis-artifact/v1"
MAX_ARTWORK_BYTES = 100 * 1024 * 1024
TITLE_LIMIT = 120
URL_LIMIT = 2048
IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


@dataclass(frozen=True)
class ArtifactPackage:
    """Files and public announcement created for one digital artifact."""

    directory: Path
    artwork_path: Path
    certificate_path: Path
    manifest: dict[str, Any]
    certificate_sha256: str
    announcement_text: str


def _base64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_base64url(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))
    except (ValueError, base64.binascii.Error) as exc:
        raise DashboardError("The artifact certificate contains an unreadable signature.") from exc


def _canonical_bytes(unsigned_manifest: dict[str, Any]) -> bytes:
    return json.dumps(
        unsigned_manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _certificate_bytes(manifest: dict[str, Any]) -> bytes:
    return (
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode("utf-8")


def _safe_title(title: str) -> str:
    normalized = " ".join(title.split())
    if not normalized:
        raise DashboardError("Give the artwork a title first.")
    if len(normalized) > TITLE_LIMIT:
        raise DashboardError(f"Keep the artwork title under {TITLE_LIMIT} characters.")
    return normalized


def _safe_source_url(source_url: str) -> str | None:
    normalized = source_url.strip()
    if not normalized:
        return None
    if len(normalized) > URL_LIMIT:
        raise DashboardError("The public artwork URL is too long.")
    parsed = urllib.parse.urlparse(normalized)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise DashboardError("The public artwork URL must begin with http:// or https://.")
    if parsed.username or parsed.password:
        raise DashboardError("Do not put usernames or passwords inside the public artwork URL.")
    return normalized


def _slug(title: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return (value or "digital-artifact")[:48].rstrip("-")


def detect_image_type(path: str | Path) -> str:
    """Accept common image files by their bytes, not by a possibly misleading name."""

    image_path = Path(path).expanduser().resolve()
    if not image_path.is_file():
        raise DashboardError(f"Artwork file not found: {image_path}")
    size = image_path.stat().st_size
    if size <= 0:
        raise DashboardError("The selected artwork file is empty.")
    if size > MAX_ARTWORK_BYTES:
        raise DashboardError("Choose an artwork file smaller than 100 MB.")

    with image_path.open("rb") as handle:
        header = handle.read(16)
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    raise DashboardError("Choose a PNG, JPEG, GIF, or WebP image. Other files are refused.")


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact_certificate(manifest: dict[str, Any]) -> None:
    """Verify the detached proof and the minimum certificate structure."""

    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise DashboardError("This is not a supported artifact certificate.")
    proof = manifest.get("proof")
    if not isinstance(proof, dict):
        raise DashboardError("The artifact certificate has no signature proof.")
    creator_did = manifest.get("creator_did")
    if not isinstance(creator_did, str):
        raise DashboardError("The artifact certificate has no creator DID.")
    if proof.get("verification_method") != creator_did:
        raise DashboardError("The certificate signature does not name the creator DID.")
    signature = proof.get("signature_base64url")
    if not isinstance(signature, str):
        raise DashboardError("The artifact certificate has no readable signature.")

    unsigned = dict(manifest)
    unsigned.pop("proof", None)
    try:
        public_key_for_did(creator_did).verify(
            _decode_base64url(signature), _canonical_bytes(unsigned)
        )
    except InvalidSignature as exc:
        raise DashboardError("The artifact certificate signature is invalid or was changed.") from exc


def build_artifact_announcement(
    manifest: dict[str, Any], certificate_sha256: str
) -> str:
    artwork = manifest["artwork"]
    source_url = manifest.get("source_url")
    source = f" | Public source: {source_url}" if source_url else ""
    text = (
        "FLOP PRE-GENESIS DIGITAL ARTIFACT"
        f" | ID: {manifest['artifact_id']}"
        f" | Title: {manifest['title']}"
        f" | Creator DID: {manifest['creator_did']}"
        f" | Original SHA-256: {artwork['sha256']}"
        f" | Certificate SHA-256: {certificate_sha256}"
        f"{source}"
        " | Declaration: This is an original digital-artwork provenance record published "
        "through FLOP Labs' Technocore. It is not an on-chain NFT, token, official FLOP "
        "protocol asset, or promise of rewards."
    )
    return clean_text(text)


def create_artifact_package(
    identity: Identity,
    image_path: str | Path,
    title: str,
    source_url: str,
    output_root: str | Path,
    *,
    created_at: str | None = None,
) -> ArtifactPackage:
    """Copy the artwork and create a signed, safe-to-publish certificate package."""

    original = Path(image_path).expanduser().resolve()
    media_type = detect_image_type(original)
    safe_title = _safe_title(title)
    safe_url = _safe_source_url(source_url)
    artwork_sha256 = sha256_file(original)
    output_base = Path(output_root).expanduser().resolve()
    output_base.mkdir(parents=True, exist_ok=True)

    base_id = f"{_slug(safe_title)}-{artwork_sha256[:12]}"
    artifact_id = base_id
    counter = 2
    while (output_base / artifact_id).exists():
        artifact_id = f"{base_id}-{counter}"
        counter += 1

    directory = output_base / artifact_id
    directory.mkdir()
    artwork_path = directory / f"artwork{IMAGE_TYPES[media_type]}"
    shutil.copy2(original, artwork_path)
    if sha256_file(artwork_path) != artwork_sha256:
        raise DashboardError("The copied artwork did not match the original. Nothing was published.")

    unsigned_manifest: dict[str, Any] = {
        "schema": SCHEMA,
        "status": "pre-genesis-digital-artifact",
        "artifact_id": artifact_id,
        "title": safe_title,
        "creator_did": identity.did,
        "created_at_utc": created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "artwork": {
            "filename": artwork_path.name,
            "media_type": media_type,
            "bytes": artwork_path.stat().st_size,
            "sha256": artwork_sha256,
        },
        "source_url": safe_url,
        "declaration": (
            "The creator DID declares authorship of this exact artwork file and may seek to "
            "mint the same SHA-256 content on FLOP Network if official NFT support becomes "
            "available. This certificate is not an on-chain NFT, token, official FLOP "
            "protocol asset, or promise of rewards."
        ),
    }
    proof = {
        "type": "Ed25519",
        "verification_method": identity.did,
        "canonicalization": "UTF-8 JSON; sorted keys; compact separators; proof omitted",
        "signature_base64url": _base64url(identity.key.sign(_canonical_bytes(unsigned_manifest))),
    }
    manifest = {**unsigned_manifest, "proof": proof}
    verify_artifact_certificate(manifest)

    certificate_path = directory / "artifact-certificate.json"
    certificate_data = _certificate_bytes(manifest)
    certificate_path.write_bytes(certificate_data)
    certificate_sha256 = hashlib.sha256(certificate_data).hexdigest()
    announcement = build_artifact_announcement(manifest, certificate_sha256)

    instructions = (
        "PRE-GENESIS DIGITAL ARTIFACT PACKAGE\n"
        "====================================\n\n"
        "Safe to upload publicly:\n"
        "  * artwork image\n"
        "  * artifact-certificate.json\n"
        "  * a Technocore launch receipt created by the dashboard\n\n"
        "Never place flop_agent_identity.json, a PEM identity, a password, a seed phrase,\n"
        "or a wallet private key in this folder.\n\n"
        "This package is a signed provenance record. It is not an on-chain NFT and does\n"
        "not claim official FLOP status or guarantee a reward.\n"
    )
    (directory / "README-FIRST.txt").write_text(instructions, encoding="utf-8")

    return ArtifactPackage(
        directory=directory,
        artwork_path=artwork_path,
        certificate_path=certificate_path,
        manifest=manifest,
        certificate_sha256=certificate_sha256,
        announcement_text=announcement,
    )


def save_artifact_launch_receipt(package: ArtifactPackage, result: SendResult) -> Path:
    """Save a public receipt beside the certificate without any private material."""

    if not result.confirmed or not result.posted:
        raise DashboardError("A launch receipt can be saved only after Technocore confirms it.")
    sequence = result.posted.get("seq", "unknown")
    path = package.directory / f"technocore-{result.room}-seq-{sequence}.json"
    payload = {
        "artifact_id": package.manifest["artifact_id"],
        "certificate_filename": package.certificate_path.name,
        "certificate_sha256": package.certificate_sha256,
        "artwork_filename": package.artwork_path.name,
        "technocore": public_receipt(result),
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return path
