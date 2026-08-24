"""Safe weekly activity runner and Windows Task Scheduler integration.

The dashboard enables this explicitly.  The scheduled runner never creates an
identity: it only loads the exact existing identity path saved in its config.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from technocore_core import (
    DashboardError,
    TechnocoreClient,
    clean_text,
    load_identity,
    public_receipt,
    validate_room,
)


CONFIG_NAME = "weekly_activity_config.json"
STATE_NAME = "weekly_activity_state.json"
LOG_NAME = "weekly_activity.log"
TASK_DAILY = "Technocore Agent Dashboard - Daily Due Check"
TASK_LOGIN = "Technocore Agent Dashboard - Login Due Check"
DEFAULT_ROOM = "lobby"
DEFAULT_MESSAGE = (
    "Weekly Technocore activity check for my existing agent identity. "
    "Identity and signing verified on {date}."
)
INTERVAL_DAYS = 7
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class SchedulerError(DashboardError):
    """Windows could not create or remove the scheduled tasks."""


def app_directory() -> Path:
    return Path(__file__).resolve().parent


def config_path(root: str | Path | None = None) -> Path:
    return Path(root).resolve() / CONFIG_NAME if root else app_directory() / CONFIG_NAME


def state_path(root: str | Path | None = None) -> Path:
    return Path(root).resolve() / STATE_NAME if root else app_directory() / STATE_NAME


def log_path(root: str | Path | None = None) -> Path:
    return Path(root).resolve() / LOG_NAME if root else app_directory() / LOG_NAME


def utc_iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_object(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def load_automation_config(root: str | Path | None = None) -> dict[str, Any]:
    return _read_object(config_path(root))


def load_automation_state(root: str | Path | None = None) -> dict[str, Any]:
    return _read_object(state_path(root))


def _append_log(root: Path, text: str, now: float | None = None) -> None:
    timestamp = utc_iso(time.time() if now is None else now)
    with log_path(root).open("a", encoding="utf-8") as handle:
        handle.write(f"{timestamp}  {text}\n")


def validate_check_time(value: str) -> str:
    normalized = value.strip()
    if not TIME_RE.fullmatch(normalized):
        raise SchedulerError("Choose a time from 00:00 through 23:59, such as 09:00.")
    return normalized


def arm_automation(
    identity_path: str | Path,
    identity_did: str,
    room: str,
    message: str,
    check_time: str,
    *,
    root: str | Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Enable automation without sending immediately; first send is seven days later."""

    target_root = Path(root).resolve() if root else app_directory()
    identity_file = Path(identity_path).expanduser().resolve()
    if identity_file.suffix.lower() != ".json":
        raise SchedulerError(
            "Weekly automation uses the original JSON identity. An encrypted PEM needs a "
            "password and cannot unlock itself unattended."
        )
    identity = load_identity(identity_file)
    if identity.did != identity_did:
        raise SchedulerError("The selected identity changed. Weekly automation was not enabled.")

    normalized_room = validate_room(room)
    normalized_message = clean_text(message)
    normalized_time = validate_check_time(check_time)
    current = time.time() if now is None else float(now)
    config = {
        "enabled": True,
        "identity_path": str(identity_file),
        "identity_did": identity.did,
        "room": normalized_room,
        "message": normalized_message,
        "check_time": normalized_time,
        "interval_days": INTERVAL_DAYS,
        "enabled_at": current,
    }
    old_state = load_automation_state(target_root)
    same_identity = old_state.get("identity_did") == identity.did
    state = {
        "identity_did": identity.did,
        "armed_at": current,
        "last_confirmed_at": old_state.get("last_confirmed_at") if same_identity else None,
        "last_room_sequence": old_state.get("last_room_sequence") if same_identity else None,
        "last_attempt_at": None,
        "last_status": "armed",
        "last_detail": "Automation enabled. No message was sent during setup.",
        "pending_cycle_id": None,
        "pending_cycle_at": None,
    }
    _write_object(config_path(target_root), config)
    _write_object(state_path(target_root), state)
    _append_log(target_root, "Weekly automation enabled; first check-in waits seven days.", current)
    return state


def disable_automation(*, root: str | Path | None = None) -> None:
    target_root = Path(root).resolve() if root else app_directory()
    config = load_automation_config(target_root)
    if config:
        config["enabled"] = False
        config["disabled_at"] = time.time()
        _write_object(config_path(target_root), config)
    _append_log(target_root, "Weekly automation disabled.")


def next_due_at(config: dict[str, Any], state: dict[str, Any]) -> float | None:
    try:
        days = max(1, int(config.get("interval_days", INTERVAL_DAYS)))
        anchor = state.get("last_confirmed_at") or state.get("armed_at") or config.get("enabled_at")
        return float(anchor) + (days * 24 * 60 * 60) if anchor is not None else None
    except (TypeError, ValueError):
        return None


def _weekly_text(template: str, cycle_timestamp: float) -> str:
    moment = datetime.fromtimestamp(cycle_timestamp, timezone.utc)
    date = moment.strftime("%Y-%m-%d")
    timestamp = moment.strftime("%Y-%m-%dT%H:%M:%SZ")
    rendered = template.replace("{date}", date).replace("{timestamp}", timestamp)
    marker = f"[weekly-check:{date}]"
    if marker not in rendered:
        rendered = f"{rendered} {marker}"
    return clean_text(rendered)


@contextmanager
def _single_runner(root: Path) -> Iterator[bool]:
    lock = root / ".weekly_activity.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            stale = time.time() - lock.stat().st_mtime > 60 * 60
        except OSError:
            stale = False
        if stale:
            try:
                lock.unlink()
            except OSError:
                pass
            with _single_runner(root) as acquired:
                yield acquired
            return
        yield False
        return
    try:
        os.close(descriptor)
        yield True
    finally:
        try:
            lock.unlink()
        except OSError:
            pass


def _save_weekly_receipt(root: Path, result) -> Path:
    receipts = root / "receipts"
    receipts.mkdir(exist_ok=True)
    sequence = result.posted.get("seq", "unknown") if result.posted else "unknown"
    path = receipts / f"technocore-{result.room}-seq-{sequence}.json"
    _write_object(path, public_receipt(result))
    return path


def run_if_due(
    *,
    root: str | Path | None = None,
    now: float | None = None,
    client: TechnocoreClient | None = None,
) -> dict[str, Any]:
    """Run one quiet due check. Returns a public, UI-safe status dictionary."""

    target_root = Path(root).resolve() if root else app_directory()
    current = time.time() if now is None else float(now)
    config = load_automation_config(target_root)
    if not config.get("enabled"):
        return {"status": "disabled", "detail": "Weekly automation is turned off."}

    with _single_runner(target_root) as acquired:
        if not acquired:
            return {"status": "already_running", "detail": "A weekly check is already running."}

        state = load_automation_state(target_root)
        due_at = next_due_at(config, state)
        if due_at is not None and current < due_at:
            state.update(
                {
                    "last_attempt_at": current,
                    "last_status": "not_due",
                    "last_detail": f"Nothing sent. Next check-in is due {utc_iso(due_at)}.",
                }
            )
            _write_object(state_path(target_root), state)
            _append_log(target_root, state["last_detail"], current)
            return {"status": "not_due", "detail": state["last_detail"], "next_due_at": due_at}

        cycle_at = state.get("pending_cycle_at")
        if not isinstance(cycle_at, (int, float)):
            cycle_at = current
            state["pending_cycle_at"] = cycle_at
            state["pending_cycle_id"] = datetime.fromtimestamp(
                cycle_at, timezone.utc
            ).strftime("%Y-%m-%d")
            _write_object(state_path(target_root), state)

        try:
            identity = load_identity(config["identity_path"])
            if identity.did != config.get("identity_did"):
                raise SchedulerError("The identity no longer matches the DID saved in automation.")
            room = validate_room(str(config["room"]))
            text = _weekly_text(str(config["message"]), float(cycle_at))
            service = client or TechnocoreClient()
            service.check_health()

            # If a previous attempt reached Technocore but the computer stopped before
            # saving state, detect the exact weekly marker instead of posting twice.
            recent = service.read_room(room, limit=200)
            existing = next(
                (
                    item
                    for item in recent.get("messages", [])
                    if item.get("from") == identity.did and item.get("text") == text
                ),
                None,
            )
            if existing is not None:
                confirmed_at = current
                state.update(
                    {
                        "last_confirmed_at": confirmed_at,
                        "last_room_sequence": existing.get("seq"),
                        "last_attempt_at": current,
                        "last_status": "confirmed_existing",
                        "last_detail": "The weekly message was already present; nothing was posted twice.",
                        "pending_cycle_id": None,
                        "pending_cycle_at": None,
                    }
                )
                _write_object(state_path(target_root), state)
                _append_log(target_root, state["last_detail"], current)
                return {
                    "status": "confirmed_existing",
                    "detail": state["last_detail"],
                    "sequence": existing.get("seq"),
                }

            result = service.send_signed(identity, room, text)
            if not result.confirmed:
                raise SchedulerError(f"Technocore did not confirm the message: {result.detail}")
            receipt = _save_weekly_receipt(target_root, result)
            confirmed_at = current
            sequence = result.posted.get("seq") if result.posted else None
            state.update(
                {
                    "last_confirmed_at": confirmed_at,
                    "last_room_sequence": sequence,
                    "last_attempt_at": current,
                    "last_status": "confirmed",
                    "last_detail": f"Weekly message confirmed in room {room}, sequence {sequence}.",
                    "last_receipt": str(receipt),
                    "pending_cycle_id": None,
                    "pending_cycle_at": None,
                }
            )
            _write_object(state_path(target_root), state)
            _append_log(target_root, state["last_detail"], current)
            return {
                "status": "confirmed",
                "detail": state["last_detail"],
                "sequence": sequence,
                "receipt": str(receipt),
            }
        except Exception as exc:
            detail = str(exc) or exc.__class__.__name__
            state.update(
                {
                    "last_attempt_at": current,
                    "last_status": "failed",
                    "last_detail": detail,
                }
            )
            _write_object(state_path(target_root), state)
            _append_log(target_root, f"Weekly check failed: {detail}", current)
            return {"status": "failed", "detail": detail}


def _pythonw_path() -> Path:
    current = Path(sys.executable).resolve()
    candidate = current.with_name("pythonw.exe")
    return candidate if candidate.is_file() else current


def scheduled_task_commands(
    check_time: str, *, root: str | Path | None = None
) -> list[list[str]]:
    target_root = Path(root).resolve() if root else app_directory()
    time_value = validate_check_time(check_time)
    action = f'"{_pythonw_path()}" "{target_root / "weekly_activity.py"}" --scheduled'
    common = ["schtasks.exe", "/Create", "/F", "/RL", "LIMITED", "/TR", action]
    return [
        [*common, "/TN", TASK_DAILY, "/SC", "DAILY", "/ST", time_value],
        [*common, "/TN", TASK_LOGIN, "/SC", "ONLOGON"],
    ]


def _task_error(completed: subprocess.CompletedProcess[str]) -> str:
    return (completed.stderr or completed.stdout or "Unknown Windows Task Scheduler error.").strip()


def install_scheduled_tasks(check_time: str, *, root: str | Path | None = None) -> None:
    if os.name != "nt":
        raise SchedulerError("Weekly scheduling can only be installed on Windows.")
    created: list[str] = []
    for command, name in zip(scheduled_task_commands(check_time, root=root), (TASK_DAILY, TASK_LOGIN)):
        completed = subprocess.run(command, capture_output=True, text=True, shell=False)
        if completed.returncode != 0:
            for task_name in created:
                subprocess.run(
                    ["schtasks.exe", "/Delete", "/F", "/TN", task_name],
                    capture_output=True,
                    text=True,
                    shell=False,
                )
            raise SchedulerError(f"Windows could not create the weekly checker: {_task_error(completed)}")
        created.append(name)


def uninstall_scheduled_tasks() -> None:
    if os.name != "nt":
        return
    failures: list[str] = []
    for name in (TASK_DAILY, TASK_LOGIN):
        completed = subprocess.run(
            ["schtasks.exe", "/Delete", "/F", "/TN", name],
            capture_output=True,
            text=True,
            shell=False,
        )
        detail = _task_error(completed).lower()
        if completed.returncode != 0 and "cannot find" not in detail and "does not exist" not in detail:
            failures.append(_task_error(completed))
    if failures:
        raise SchedulerError("Windows could not remove every scheduled check: " + " | ".join(failures))


def main() -> int:
    parser = argparse.ArgumentParser(description="Technocore weekly due checker")
    parser.add_argument("--scheduled", action="store_true", help="run quietly from Task Scheduler")
    parser.add_argument("--status-json", action="store_true", help="print the public result as JSON")
    args = parser.parse_args()
    result = run_if_due()
    if args.status_json or not args.scheduled:
        print(json.dumps(result, indent=2))
    return 0 if result.get("status") != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
