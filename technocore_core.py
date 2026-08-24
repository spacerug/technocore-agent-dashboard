"""Safe, testable core for the Technocore Agent Dashboard.

The GUI imports this module.  It deliberately contains no Tkinter code so the
identity and signing behavior can be tested without opening a window.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)


DEFAULT_BASE_URL = "https://technocore.chat"
ROOM_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
INVISIBLE_CATEGORIES = ("Cc", "Cf", "Cs", "Co", "Zl", "Zp")
MAX_MESSAGE_CHARS = 4096
MULTICODEC_ED25519 = b"\xed\x01"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
USER_AGENT = "Technocore-Agent-Dashboard/1.1.1 (+https://github.com/flop-labs/technocore-chat)"


class DashboardError(Exception):
    """Base error safe to show in the desktop app."""


class IdentityError(DashboardError):
    """The selected identity file is missing, unsupported, or inconsistent."""


class ServiceError(DashboardError):
    """Technocore could not complete a request."""

    def __init__(self, message: str, *, status: int | None = None, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass(frozen=True)
class Identity:
    """An Ed25519 signing identity loaded from a local file."""

    path: Path
    did: str
    key: Ed25519PrivateKey = field(repr=False)
    source_format: str = "json"


@dataclass(frozen=True)
class SendResult:
    """Outcome of a signed message request."""

    confirmed: bool
    room: str
    nonce: int
    did: str
    text: str
    posted: dict[str, Any] | None
    detail: str


def clean_text(text: str, limit: int = MAX_MESSAGE_CHARS) -> str:
    """Mirror Technocore's public single-line sweep exactly."""

    cleaned = "".join(
        " " if unicodedata.category(char) in INVISIBLE_CATEGORIES else char for char in text
    ).strip()
    if not cleaned:
        raise DashboardError("Your message needs at least one visible character.")
    if len(cleaned) > limit:
        raise DashboardError(
            f"Your message is {len(cleaned):,} characters. Technocore allows {limit:,}."
        )
    return cleaned


def validate_room(room: str) -> str:
    normalized = room.strip()
    if not ROOM_RE.fullmatch(normalized):
        raise DashboardError(
            "Room names use lowercase letters, numbers, _ or -. They must be 1-48 characters."
        )
    return normalized


def _base58_encode(raw: bytes) -> str:
    number = int.from_bytes(raw, "big")
    output = ""
    while number:
        number, remainder = divmod(number, 58)
        output = B58[remainder] + output
    leading_zeros = len(raw) - len(raw.lstrip(b"\0"))
    return ("1" * leading_zeros) + (output or "1")


def did_for_key(key: Ed25519PrivateKey) -> str:
    public_raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return "did:key:z" + _base58_encode(MULTICODEC_ED25519 + public_raw)


def sign_message(key: Ed25519PrivateKey, room: str, nonce: int, text: str) -> str:
    room = validate_room(room)
    swept = clean_text(text)
    canonical = f"{room}|{nonce}|{swept}".encode("utf-8")
    return base64.urlsafe_b64encode(key.sign(canonical)).decode("ascii").rstrip("=")


def verify_signature(did: str, signature: str, room: str, nonce: int, text: str) -> None:
    """Verify a signature locally; useful for tests and receipt validation."""

    if not did.startswith("did:key:z"):
        raise IdentityError("The identity does not contain a supported did:key value.")
    encoded = did.removeprefix("did:key:z")
    number = 0
    for char in encoded:
        try:
            number = number * 58 + B58.index(char)
        except ValueError as exc:
            raise IdentityError("The DID contains invalid base58 characters.") from exc
    decoded = number.to_bytes((number.bit_length() + 7) // 8, "big")
    if not decoded.startswith(MULTICODEC_ED25519) or len(decoded) != 34:
        raise IdentityError("Only Ed25519 did:key identities are supported.")
    padding = "=" * (-len(signature) % 4)
    raw_signature = base64.urlsafe_b64decode(signature + padding)
    canonical = f"{validate_room(room)}|{nonce}|{clean_text(text)}".encode("utf-8")
    Ed25519PublicKey.from_public_bytes(decoded[2:]).verify(raw_signature, canonical)


def _decode_text_secret(value: str) -> tuple[bytes, str] | None:
    text = value.strip()
    if not text:
        return None

    if "BEGIN" in text and "PRIVATE KEY" in text:
        try:
            key = serialization.load_pem_private_key(text.encode("utf-8"), password=None)
        except (TypeError, ValueError):
            return None
        if isinstance(key, Ed25519PrivateKey):
            return (
                key.private_bytes(
                    serialization.Encoding.Raw,
                    serialization.PrivateFormat.Raw,
                    serialization.NoEncryption(),
                ),
                "PEM stored in JSON",
            )
        return None

    hex_text = text[2:] if text.lower().startswith("0x") else text
    if len(hex_text) in (64, 128) and re.fullmatch(r"[0-9a-fA-F]+", hex_text):
        raw = bytes.fromhex(hex_text)
        return (raw[:32], "hex")

    try:
        padding = "=" * (-len(text) % 4)
        raw = base64.urlsafe_b64decode(text + padding)
    except (ValueError, base64.binascii.Error):
        return None
    if len(raw) in (32, 64):
        return (raw[:32], "base64")
    return None


def _decode_secret(value: Any) -> tuple[bytes, str] | None:
    if isinstance(value, str):
        return _decode_text_secret(value)
    if isinstance(value, list) and len(value) in (32, 64):
        if all(isinstance(item, int) and 0 <= item <= 255 for item in value):
            return (bytes(value[:32]), "byte array")
    if isinstance(value, dict):
        # Standard Ed25519 JWK private component.
        if value.get("kty") == "OKP" and value.get("crv") == "Ed25519" and "d" in value:
            decoded = _decode_secret(value["d"])
            if decoded:
                return (decoded[0], "JWK")
    return None


def _walk_secret_candidates(data: Any, trail: tuple[str, ...] = ()) -> list[tuple[bytes, str]]:
    candidates: list[tuple[bytes, str]] = []
    if isinstance(data, dict):
        for key, value in data.items():
            lowered = str(key).lower().replace("-", "_")
            next_trail = (*trail, str(key))
            looks_private = any(token in lowered for token in ("private", "secret", "seed"))
            is_jwk_private = lowered == "d" and data.get("kty") == "OKP"
            if looks_private or is_jwk_private:
                decoded = _decode_secret(value)
                if decoded:
                    candidates.append((decoded[0], f"{'.'.join(next_trail)} ({decoded[1]})"))
            if isinstance(value, (dict, list)):
                candidates.extend(_walk_secret_candidates(value, next_trail))
    elif isinstance(data, list):
        for index, value in enumerate(data):
            if isinstance(value, (dict, list)):
                candidates.extend(_walk_secret_candidates(value, (*trail, str(index))))
    return candidates


def _find_expected_dids(data: Any) -> list[str]:
    found: list[str] = []
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, str) and value.startswith("did:key:z"):
                found.append(value.strip())
            elif isinstance(value, (dict, list)):
                found.extend(_find_expected_dids(value))
    elif isinstance(data, list):
        for value in data:
            found.extend(_find_expected_dids(value))
    return list(dict.fromkeys(found))


def load_identity(path: str | Path, password: str | None = None) -> Identity:
    """Load and validate a JSON or encrypted PEM Ed25519 identity."""

    identity_path = Path(path).expanduser().resolve()
    if not identity_path.is_file():
        raise IdentityError(f"Identity file not found: {identity_path}")

    raw_file = identity_path.read_bytes()
    if raw_file.lstrip().startswith(b"-----BEGIN"):
        try:
            key = serialization.load_pem_private_key(
                raw_file,
                password=password.encode("utf-8") if password else None,
            )
        except (TypeError, ValueError) as exc:
            raise IdentityError("That PEM password is incorrect, or the file is not usable.") from exc
        if not isinstance(key, Ed25519PrivateKey):
            raise IdentityError("The selected PEM is not an Ed25519 private key.")
        return Identity(identity_path, did_for_key(key), key, "encrypted PEM")

    try:
        data = json.loads(raw_file.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IdentityError("The selected file is not readable JSON or PEM.") from exc

    expected_dids = _find_expected_dids(data)
    candidates = _walk_secret_candidates(data)
    if not candidates:
        raise IdentityError(
            "I could not find an Ed25519 private key in this JSON. Select flop_agent_identity.json."
        )

    unique: dict[bytes, str] = {}
    for raw, label in candidates:
        unique.setdefault(raw, label)

    matches: list[tuple[Ed25519PrivateKey, str, str]] = []
    for raw, label in unique.items():
        try:
            key = Ed25519PrivateKey.from_private_bytes(raw)
        except ValueError:
            continue
        derived = did_for_key(key)
        if not expected_dids or derived in expected_dids:
            matches.append((key, derived, label))

    if not matches:
        raise IdentityError(
            "The private key does not match the public DID stored in this JSON. Nothing was signed."
        )
    if len(matches) > 1:
        raise IdentityError("This JSON contains more than one possible private key. Choose a simpler file.")

    key, derived_did, label = matches[0]
    return Identity(identity_path, derived_did, key, f"JSON: {label}")


def create_encrypted_pem(identity: Identity, destination: str | Path, passphrase: str) -> Path:
    """Create, but never overwrite, a passphrase-encrypted copy of an identity."""

    if len(passphrase) < 12:
        raise IdentityError("Use a passphrase with at least 12 characters.")
    output = Path(destination).expanduser().resolve()
    if output.exists():
        raise IdentityError(f"I will not overwrite the existing file: {output.name}")
    pem = identity.key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(passphrase.encode("utf-8")),
    )
    output.write_bytes(pem)
    try:
        os.chmod(output, 0o600)
    except OSError:
        pass
    return output


def discover_identity_files(app_directory: str | Path) -> list[Path]:
    """Look only in obvious locations; never crawl a user's drive for secrets."""

    app_dir = Path(app_directory).resolve()
    user_profile = Path(os.environ.get("USERPROFILE", Path.home()))
    roots = [
        app_dir,
        app_dir.parent,
        user_profile / "Desktop",
        user_profile / "OneDrive" / "Desktop",
    ]
    names = ("flop_agent_identity.json", "identity.pem", "identity_encrypted.pem")
    files: list[Path] = []
    for root in roots:
        for name in names:
            candidate = root / name
            if candidate.is_file() and candidate not in files:
                files.append(candidate)
    return files


class TechnocoreClient:
    """Small signed client with timeout-safe write verification."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._last_nonce: dict[tuple[str, str], int] = {}

    def _request(self, request: urllib.request.Request) -> tuple[int, str, dict[str, str]]:
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8", errors="replace")
                return response.status, body, dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ServiceError(
                f"Technocore returned HTTP {exc.code}: {exc.reason}",
                status=exc.code,
                body=body,
            ) from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            raise ServiceError(f"Could not reach Technocore: {reason}") from exc
        except TimeoutError as exc:
            raise ServiceError("Technocore did not answer before the connection timed out.") from exc

    def check_health(self) -> str:
        request = urllib.request.Request(
            f"{self.base_url}/healthz",
            headers={"User-Agent": USER_AGENT, "Accept": "text/plain"},
        )
        status, body, _ = self._request(request)
        if status != 200:
            raise ServiceError(f"Technocore health check returned HTTP {status}.", status=status)
        return body.strip() or "OK"

    def read_room(self, room: str, limit: int = 50) -> dict[str, Any]:
        room = validate_room(room)
        safe_limit = max(1, min(int(limit), 200))
        query = urllib.parse.urlencode({"format": "json", "limit": safe_limit})
        url = f"{self.base_url}/r/{urllib.parse.quote(room, safe='')}?{query}"
        request = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        _, body, _ = self._request(request)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ServiceError("Technocore returned an unreadable room response.", body=body) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list):
            raise ServiceError("Technocore returned an unexpected room response.", body=body)
        return payload

    @staticmethod
    def _find_post(payload: dict[str, Any], did: str, nonce: int) -> dict[str, Any] | None:
        for message in payload.get("messages", []):
            if message.get("from") == did and message.get("nonce") == nonce:
                return message
        posted = payload.get("posted")
        if isinstance(posted, dict) and posted.get("from") == did and posted.get("nonce") == nonce:
            return posted
        return None

    def _choose_nonce(self, identity: Identity, room: str, room_payload: dict[str, Any]) -> int:
        server_last = 0
        for message in room_payload.get("messages", []):
            if message.get("from") == identity.did and isinstance(message.get("nonce"), int):
                server_last = max(server_last, message["nonce"])
        key = (identity.did, room)
        local_last = self._last_nonce.get(key, 0)
        now_ms = time.time_ns() // 1_000_000
        nonce = max(now_ms, server_last + 1, local_last + 1)
        if len(str(nonce)) > 19:
            raise DashboardError("The computer clock produced an invalid Technocore nonce.")
        self._last_nonce[key] = nonce
        return nonce

    def send_signed(self, identity: Identity, room: str, text: str) -> SendResult:
        room = validate_room(room)
        cleaned = clean_text(text)
        before = self.read_room(room, limit=200)
        nonce = self._choose_nonce(identity, room, before)
        signature = sign_message(identity.key, room, nonce, cleaned)
        verify_signature(identity.did, signature, room, nonce, cleaned)

        payload = json.dumps(
            {"did": identity.did, "sig": signature, "nonce": str(nonce), "text": text},
            ensure_ascii=False,
        ).encode("utf-8")
        url = f"{self.base_url}/r/{urllib.parse.quote(room, safe='')}?format=json"
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
            },
        )

        try:
            _, body, _ = self._request(request)
            response_payload = json.loads(body)
            posted = self._find_post(response_payload, identity.did, nonce)
            if posted is None:
                raise ServiceError("Technocore answered, but the signed message was not in its receipt.")
            return SendResult(
                True,
                room,
                nonce,
                identity.did,
                cleaned,
                posted,
                "Technocore returned a matching signed receipt.",
            )
        except (ServiceError, json.JSONDecodeError) as write_error:
            # A proxy timeout can happen after the origin stored the message. Read before
            # ever suggesting another send, so the UI cannot accidentally create duplicates.
            try:
                after = self.read_room(room, limit=200)
                posted = self._find_post(after, identity.did, nonce)
            except ServiceError:
                posted = None
            if posted is not None:
                return SendResult(
                    True,
                    room,
                    nonce,
                    identity.did,
                    cleaned,
                    posted,
                    "The write response failed, but the signed message was found in the room.",
                )
            detail = str(write_error)
            if isinstance(write_error, ServiceError) and write_error.body:
                detail = f"{detail}\n{write_error.body.strip()}"
            return SendResult(
                False,
                room,
                nonce,
                identity.did,
                cleaned,
                None,
                detail,
            )


def public_receipt(result: SendResult) -> dict[str, Any]:
    """Return a receipt that is safe to publish; it never includes signatures or secrets."""

    return {
        "confirmed": result.confirmed,
        "room": result.room,
        "did": result.did,
        "nonce": result.nonce,
        "text": result.text,
        "posted": result.posted,
        "detail": result.detail,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
