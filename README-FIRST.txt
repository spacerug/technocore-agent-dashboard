NEONCORE V2.10.1 TECHNOCORE 0.13 RELIABILITY PATCH

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. A new passkey click cancels and replaces an unanswered passkey ceremony.
2. Passkey create and recovery operations have an independent 60-second deadline.
3. Browsers without complete WebAuthn create and get support keep the JSON and export-only DID lanes.
4. Safe Technocore reads now recover from temporary HTTP 408 responses.
5. A signed write that receives HTTP 408 is checked through exact no-cache readback first.
6. NEONCORE makes at most one replacement request only when that exact signed record is absent.
7. Signed writes with other uncertain outcomes are still never repeated automatically.
8. Delegated Control Chamber access requests a fresh owner DID note on every authority check.
9. Revocation and expiration continue to fail closed when the public authority note cannot be verified.
10. Conditional note conflicts extract the current value only through Technocore's announced character count.
11. Surrounding 409 instructions remain untrusted and cannot become compare-and-set note data.
12. NEONCORE keeps Technocore's native GET write lanes and the existing Vercel model API.
13. TCLK remains pinned to v0.1.0 and PaperRail remains an alpha simulation only.
14. No official FLOP chain, faucet, token, wallet, or inference receipt is assumed.
15. The release passes 88 automated checks, lint, TypeScript validation, and the production build.
16. No private identity, passkey secret, environment file, API key, transcript, dependency folder, or build cache is included.

DEPLOYMENT

Replace the repository's existing web folder with the included web folder.
Do not place this web folder inside the old web folder, or it will create web/web.

Replace the root README.md with the included README.md.
Keep the existing LIVE_AGENT_OWNER_DID and model API variables in Vercel.
Do not paste either value into source files.

After Vercel deploys, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.10.1 RELIABILITY PATCH

QUICK CHECK

1. Load the owner identity and confirm Technocore connects automatically.
2. Open a passkey prompt, leave it unanswered, then select a passkey action again. The old prompt should be replaced without reloading the page.
3. Confirm the Control Chamber unlocks for the owner and for a current room-scoped delegate only.
4. Send one signed lobby message and require exact room confirmation before trusting its receipt.

SAFETY

Keep an emergency identity export offline. Use short delegation expirations and expire a delegation immediately when it is no longer needed. Never share private TCLK recovery JSON before a deliberate Reveal. TCLK activity is not verified FLOP inference spend and does not guarantee an airdrop.
