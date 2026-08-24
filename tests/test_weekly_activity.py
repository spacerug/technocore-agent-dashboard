from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from technocore_core import SendResult, did_for_key, load_identity
from weekly_activity import (
    DEFAULT_MESSAGE,
    INTERVAL_DAYS,
    arm_automation,
    load_automation_config,
    load_automation_state,
    next_due_at,
    run_if_due,
    scheduled_task_commands,
    _weekly_text,
)


SEED = bytes(range(32))


class FakeWeeklyClient:
    def __init__(self, identity, existing=None) -> None:
        self.identity = identity
        self.existing = existing
        self.send_count = 0

    def check_health(self) -> str:
        return "ok"

    def read_room(self, room: str, limit: int = 200):
        messages = [self.existing] if self.existing else []
        return {"room": room, "messages": messages, "first_seq": 0, "last_seq": 0}

    def send_signed(self, identity, room: str, text: str) -> SendResult:
        self.send_count += 1
        posted = {
            "seq": 321,
            "ts": "2026-08-31T12:00:00Z",
            "from": identity.did,
            "nonce": 123456,
            "text": text,
        }
        return SendResult(True, room, 123456, identity.did, text, posted, "confirmed")


class WeeklyActivityTests(unittest.TestCase):
    def _identity(self, root: Path):
        key = Ed25519PrivateKey.from_private_bytes(SEED)
        did = did_for_key(key)
        path = root / "flop_agent_identity.json"
        path.write_text(
            json.dumps({"did": did, "private_key_hex": SEED.hex()}), encoding="utf-8"
        )
        return path, load_identity(path)

    def test_arming_waits_seven_days_and_keeps_same_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, identity = self._identity(root)
            state = arm_automation(
                path,
                identity.did,
                "lobby",
                DEFAULT_MESSAGE,
                "09:00",
                root=root,
                now=1_000_000,
            )
            config = load_automation_config(root)
            self.assertEqual(config["identity_path"], str(path.resolve()))
            self.assertEqual(config["identity_did"], identity.did)
            self.assertIsNone(state["last_confirmed_at"])
            self.assertEqual(
                next_due_at(config, state), 1_000_000 + INTERVAL_DAYS * 24 * 60 * 60
            )

    def test_due_check_does_not_post_early(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, identity = self._identity(root)
            arm_automation(
                path,
                identity.did,
                "lobby",
                DEFAULT_MESSAGE,
                "09:00",
                root=root,
                now=1_000_000,
            )
            client = FakeWeeklyClient(identity)
            result = run_if_due(root=root, now=1_000_001, client=client)
            self.assertEqual(result["status"], "not_due")
            self.assertEqual(client.send_count, 0)

    def test_due_check_posts_once_and_saves_public_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, identity = self._identity(root)
            start = 1_000_000
            arm_automation(
                path,
                identity.did,
                "lobby",
                DEFAULT_MESSAGE,
                "09:00",
                root=root,
                now=start,
            )
            client = FakeWeeklyClient(identity)
            due = start + INTERVAL_DAYS * 24 * 60 * 60 + 1
            result = run_if_due(root=root, now=due, client=client)
            self.assertEqual(result["status"], "confirmed")
            self.assertEqual(client.send_count, 1)
            state = load_automation_state(root)
            self.assertEqual(state["last_room_sequence"], 321)
            self.assertIsNone(state["pending_cycle_id"])
            receipt = json.loads(Path(result["receipt"]).read_text(encoding="utf-8"))
            self.assertEqual(receipt["did"], identity.did)
            self.assertNotIn("private", json.dumps(receipt).lower())

    def test_retry_finds_existing_weekly_marker_without_posting_twice(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, identity = self._identity(root)
            start = 1_000_000
            arm_automation(
                path,
                identity.did,
                "lobby",
                DEFAULT_MESSAGE,
                "09:00",
                root=root,
                now=start,
            )
            due = start + INTERVAL_DAYS * 24 * 60 * 60 + 1
            existing = {
                "seq": 320,
                "ts": "2026-08-31T12:00:00Z",
                "from": identity.did,
                "nonce": 123455,
                "text": _weekly_text(DEFAULT_MESSAGE, due),
            }
            client = FakeWeeklyClient(identity, existing=existing)
            result = run_if_due(root=root, now=due, client=client)
            self.assertEqual(result["status"], "confirmed_existing")
            self.assertEqual(client.send_count, 0)

    def test_windows_commands_create_daily_and_login_checks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commands = scheduled_task_commands("09:00", root=temporary)
        self.assertEqual(len(commands), 2)
        self.assertIn("DAILY", commands[0])
        self.assertIn("ONLOGON", commands[1])
        self.assertTrue(all("weekly_activity.py" in " ".join(command) for command in commands))


if __name__ == "__main__":
    unittest.main()
