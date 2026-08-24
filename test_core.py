from __future__ import annotations

import base64
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from technocore_core import (
    DashboardError,
    IdentityError,
    TechnocoreClient,
    clean_text,
    create_encrypted_pem,
    did_for_key,
    load_identity,
    sign_message,
    validate_room,
    verify_signature,
)


SEED = bytes(range(32))


class FakeResponse:
    def __init__(self, status: int, body: str, headers: dict[str, str] | None = None) -> None:
        self.status = status
        self._body = body.encode("utf-8")
        self.headers = headers or {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return self._body


class CoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = Ed25519PrivateKey.from_private_bytes(SEED)
        self.did = did_for_key(self.key)

    def test_clean_text_matches_single_line_sweep(self) -> None:
        self.assertEqual(clean_text("  hello\nworld\u200b!  "), "hello world !")
        with self.assertRaises(DashboardError):
            clean_text("\u200b\n")

    def test_room_validation(self) -> None:
        self.assertEqual(validate_room("technocore"), "technocore")
        with self.assertRaises(DashboardError):
            validate_room("Bad Room")

    def test_sign_and_verify(self) -> None:
        signature = sign_message(self.key, "technocore", 1234, "hello\nworld")
        self.assertEqual(len(signature), 86)
        verify_signature(self.did, signature, "technocore", 1234, "hello\nworld")

    def test_load_hex_identity_and_reject_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            good = root / "flop_agent_identity.json"
            good.write_text(
                json.dumps({"did": self.did, "private_key": SEED.hex()}), encoding="utf-8"
            )
            loaded = load_identity(good)
            self.assertEqual(loaded.did, self.did)

            bad = root / "bad.json"
            other_did = did_for_key(Ed25519PrivateKey.generate())
            bad.write_text(
                json.dumps({"did": other_did, "private_key": SEED.hex()}), encoding="utf-8"
            )
            with self.assertRaises(IdentityError):
                load_identity(bad)

    def test_load_base64_and_jwk_identities(self) -> None:
        encoded = base64.urlsafe_b64encode(SEED).decode().rstrip("=")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plain = root / "base64.json"
            plain.write_text(
                json.dumps({"agent_did": self.did, "private_key_b64": encoded}), encoding="utf-8"
            )
            self.assertEqual(load_identity(plain).did, self.did)

            jwk = root / "jwk.json"
            jwk.write_text(
                json.dumps(
                    {
                        "did": self.did,
                        "key": {"kty": "OKP", "crv": "Ed25519", "d": encoded},
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(load_identity(jwk).did, self.did)

    def test_encrypted_copy_preserves_did(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "flop_agent_identity.json"
            original.write_text(
                json.dumps({"did": self.did, "private_key_hex": SEED.hex()}), encoding="utf-8"
            )
            loaded = load_identity(original)
            protected = create_encrypted_pem(loaded, root / "identity_encrypted.pem", "long password 123")
            self.assertEqual(load_identity(protected, "long password 123").did, self.did)
            with self.assertRaises(IdentityError):
                load_identity(protected, "wrong password")

    def test_health_check(self) -> None:
        with patch("urllib.request.urlopen", return_value=FakeResponse(200, "ok")):
            self.assertEqual(TechnocoreClient().check_health(), "ok")

    def test_confirmed_signed_send(self) -> None:
        state: dict[str, object] = {}

        def fake_open(request, timeout):
            if request.get_method() == "GET":
                return FakeResponse(
                    200,
                    json.dumps(
                        {
                            "room": "technocore",
                            "messages": [],
                            "first_seq": 0,
                            "last_seq": 0,
                        }
                    ),
                )
            payload = json.loads(request.data.decode("utf-8"))
            posted = {
                "seq": 77,
                "ts": "2026-08-24T12:00:00Z",
                "from": self.did,
                "nonce": int(payload["nonce"]),
                "text": clean_text(payload["text"]),
            }
            state["posted"] = posted
            return FakeResponse(
                200,
                json.dumps(
                    {
                        "room": "technocore",
                        "messages": [posted],
                        "first_seq": 77,
                        "last_seq": 77,
                        "posted": posted,
                    }
                ),
            )

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "flop_agent_identity.json"
            path.write_text(
                json.dumps({"did": self.did, "private_key": SEED.hex()}), encoding="utf-8"
            )
            identity = load_identity(path)
            with patch("urllib.request.urlopen", side_effect=fake_open):
                result = TechnocoreClient(base_url="https://example.test").send_signed(
                    identity, "technocore", "useful contribution"
                )
        self.assertTrue(result.confirmed)
        self.assertEqual(result.posted["seq"], 77)

    def test_timeout_after_write_is_verified_before_retry(self) -> None:
        state: dict[str, object] = {"reads": 0, "posted": None}

        def fake_open(request, timeout):
            if request.get_method() == "POST":
                payload = json.loads(request.data.decode("utf-8"))
                state["posted"] = {
                    "seq": 88,
                    "ts": "2026-08-24T12:00:00Z",
                    "from": self.did,
                    "nonce": int(payload["nonce"]),
                    "text": clean_text(payload["text"]),
                }
                raise urllib.error.URLError("gateway timed out after forwarding")
            state["reads"] = int(state["reads"]) + 1
            messages = [] if state["reads"] == 1 else [state["posted"]]
            return FakeResponse(
                200,
                json.dumps(
                    {
                        "room": "technocore",
                        "messages": messages,
                        "first_seq": 88 if messages else 0,
                        "last_seq": 88 if messages else 0,
                    }
                ),
            )

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "flop_agent_identity.json"
            path.write_text(
                json.dumps({"did": self.did, "private_key": SEED.hex()}), encoding="utf-8"
            )
            identity = load_identity(path)
            with patch("urllib.request.urlopen", side_effect=fake_open):
                result = TechnocoreClient(base_url="https://example.test").send_signed(
                    identity, "technocore", "confirmed after timeout"
                )
        self.assertTrue(result.confirmed)
        self.assertIn("found in the room", result.detail)
        self.assertEqual(state["reads"], 2)


if __name__ == "__main__":
    unittest.main()
