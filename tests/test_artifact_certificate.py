from __future__ import annotations

import base64
import copy
import json
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from artifact_certificate import (
    create_artifact_package,
    detect_image_type,
    save_artifact_launch_receipt,
    sha256_file,
    verify_artifact_certificate,
)
from technocore_core import DashboardError, Identity, SendResult, did_for_key


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class ArtifactCertificateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
        self.did = did_for_key(self.key)

    def _identity(self, root: Path) -> Identity:
        identity_path = root / "flop_agent_identity.json"
        identity_path.write_text("{}", encoding="utf-8")
        return Identity(identity_path, self.did, self.key, "test")

    def test_creates_copy_and_verifiable_certificate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "original.png"
            original.write_bytes(PNG_1X1)
            package = create_artifact_package(
                self._identity(root),
                original,
                "Neon Operator #001",
                "https://github.com/example/artifacts",
                root / "packages",
                created_at="2026-08-24T20:30:00Z",
            )

            verify_artifact_certificate(package.manifest)
            self.assertEqual(sha256_file(package.artwork_path), sha256_file(original))
            self.assertEqual(package.manifest["creator_did"], self.did)
            self.assertEqual(package.manifest["artwork"]["media_type"], "image/png")
            self.assertIn("not an on-chain NFT", package.announcement_text)
            self.assertNotIn("private", package.certificate_path.read_text(encoding="utf-8").lower())

    def test_tampered_certificate_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "original.png"
            original.write_bytes(PNG_1X1)
            package = create_artifact_package(
                self._identity(root), original, "Original", "", root / "packages"
            )
            changed = copy.deepcopy(package.manifest)
            changed["title"] = "Changed after signing"
            with self.assertRaises(DashboardError):
                verify_artifact_certificate(changed)

    def test_non_image_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "flop_agent_identity.json"
            path.write_text(json.dumps({"private_key_hex": "00" * 32}), encoding="utf-8")
            with self.assertRaises(DashboardError):
                detect_image_type(path)

    def test_public_launch_receipt_contains_no_signature_secret(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "original.png"
            original.write_bytes(PNG_1X1)
            package = create_artifact_package(
                self._identity(root), original, "Receipt Test", "", root / "packages"
            )
            result = SendResult(
                confirmed=True,
                room="technocore",
                nonce=123,
                did=self.did,
                text=package.announcement_text,
                posted={"seq": 55, "from": self.did, "nonce": 123},
                detail="confirmed",
            )
            receipt_path = save_artifact_launch_receipt(package, result)
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            self.assertEqual(receipt["artifact_id"], package.manifest["artifact_id"])
            self.assertNotIn("private_key", json.dumps(receipt))
            self.assertNotIn("signature_base64url", json.dumps(receipt))


if __name__ == "__main__":
    unittest.main()
