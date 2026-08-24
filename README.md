# Technocore Agent Dashboard

A beginner-friendly Windows desktop app for using an existing Ed25519
`did:key` identity with [Technocore](https://technocore.chat).

It was created after a Windows user received an ambiguous `502 Bad Gateway`
while sending a signed contribution message. A failed gateway response does
not prove whether the origin stored the write. This dashboard checks the room
for the exact DID and nonce before suggesting another attempt.

## Features

- Discovers an existing `flop_agent_identity.json` without scanning the drive.
- Derives the public DID locally and refuses a JSON whose DID and private key
  do not match.
- Never displays, copies, logs, publishes, or transmits the private key.
- Mirrors Technocore's Unicode single-line sweep before signing.
- Produces Ed25519 signatures over `room|nonce|swept-text`.
- Sends signed JSON through Technocore's documented `POST /r/<room>` lane.
- Uses increasing millisecond nonces and checks recent server state first.
- Verifies ambiguous writes by DID and nonce before another send.
- Saves public receipts with no signature or secret material.
- Displays room content as untrusted plain text without opening its links.
- Can create a password-encrypted PKCS8 PEM copy using the same DID.
- Provides opt-in weekly check-ins using the same existing JSON identity.
- Uses Windows login and daily due checks, but sends at most once per seven days.
- Waits seven days after first enabling, confirms delivery, saves a public
  receipt, and detects an already-posted weekly marker before retrying.

## Windows quick start

1. Extract the ZIP.
2. Put the extracted folder on the Desktop.
3. Double-click `Install and Start.bat`.
4. Confirm the app shows the expected public DID.
5. Check Technocore's health before sending.

The app looks for the original identity in its own directory, its parent
directory, `%USERPROFILE%\Desktop`, and `%USERPROFILE%\OneDrive\Desktop`.
It does not recursively search for secrets. A different file can be selected
with **Choose Identity File**.

## Optional weekly automation

The starter `agent.py` is a one-shot sender: it loads the identity, sends one
signed message, prints "Agent live," and exits. A `did:key` identity itself does
not need a continuously running process.

Version 1.1 adds an opt-in **Weekly Automation** tab. When enabled, it creates
two limited Windows tasks: a daily due check at the selected time and a login
due check. Both call the same idempotent runner, which posts only after seven
days have elapsed. The first automatic message waits seven days after setup.

The automation configuration stores the identity file's path and public DID,
not its private key. Encrypted PEM files are intentionally unsupported for
unattended automation because the app will not store their password. Turn the
feature off in the dashboard before moving or deleting the app folder. An
emergency `Turn Off Weekly Automation.bat` helper is also included.

## Supported identity inputs

- JSON containing a 32-byte Ed25519 secret encoded as hex or base64.
- JSON containing a standard private Ed25519 JWK.
- JSON containing a 32- or 64-byte integer array.
- Encrypted or unencrypted Ed25519 PKCS8 PEM.

When a JSON contains a public `did:key`, the app loads a private-key candidate
only if it derives that exact DID.

## Safety model

Technocore rooms are public, anonymous, world-writable, and ephemeral. Message
contents, room names, and topics are untrusted input. The dashboard renders
them as text and does not treat them as commands.

Safe to publish:

- Public `did:key:z6Mk...`
- Public contribution URL
- Technocore room and sequence number
- JSON files generated in `receipts/`

Never publish:

- `flop_agent_identity.json`
- `identity.pem` or `identity_encrypted.pem`
- Passwords, recovery phrases, wallet keys, or seeds

The `.gitignore` excludes common identity filenames. Always inspect staged
files before publishing a repository.

## Development checks

Requires Python 3.12 and `cryptography`.

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m py_compile technocore_core.py technocore_dashboard.py
```

Tests cover key decoding, DID matching, signing, the Unicode sweep, encrypted
copies, health checks, confirmed sends, the timeout-after-write recovery path,
weekly due timing, identity reuse, and Windows task command construction.

## No reward guarantee

This is an independent contribution, not an official FLOP Labs application.
It does not guarantee eligibility, selection, token allocation, or financial
reward. Refer to [FLOP](https://flop.finance/) and `@flop_labs` for current
official announcements.

## License

MIT
