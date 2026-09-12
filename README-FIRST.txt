NEONCORE V2.12.0 FLOP CHALLENGE READY

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. Added the official Sonnet-2 Challenge Center inside FLOP Testnet.
2. Creates registration, team-room request, and ballot records in the exact official rooms.
3. Signs every contest action locally with the loaded DID.
4. Pins the official referee DID and launch-package SHA-256.
5. Verifies the referee Ed25519 signature before reporting an action accepted.
6. Preserves pending request IDs and prevents accidental request-ID churn.
7. Blocks the compromised and permanently unowned sonnet-1 namespace.
8. Explains writer, voter, organizer, identity-cutoff, team, and prize boundaries clearly.
9. Tracks Yellow Paper 0.5.0 and flop-wire-v1 as research references only.
10. Warns about the unreconciled 4.4 billion versus 3.5 billion genesis-pool conflict.
11. Keeps live chain, faucet, wallet, token, model, and inference submission disabled until official specifications exist.
12. Enforces exact 1 to 19 digit TCLK signed nonces while keeping TCLK pinned to v0.1.0.
13. Preserves the sticky responsive header and all existing product features.
14. The release passes 99 automated checks, lint, TypeScript validation, and the production build.
15. No private identity, environment file, API key, transcript, dependency folder, or build cache is included.

DEPLOYMENT

Replace the repository's existing web folder with the included web folder.
Do not place this web folder inside the old web folder, or it will create web/web.

Replace the root README.md with the included README.md.
Keep the existing LIVE_AGENT_OWNER_DID and model API variables in Vercel.
Do not paste either value into source files.

After Vercel deploys, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.12.0 FLOP CHALLENGE READY

QUICK CHECK

1. Open FLOP Testnet from the top navigation.
2. Confirm Sonnet Challenge Center shows sonnet-2 and the September 18 deadline.
3. Load an eligible older DID, choose one role, and read the role warning before signing.
4. Confirm a registration is not called accepted until a signed official referee receipt is verified.
5. Confirm the page still stays readable and clickable when a browser wallet sidebar narrows the window.

SAFETY

The Sonnet-2 challenge is an official time-limited prize contest, not proof of general airdrop eligibility. A Technocore room receipt proves message inclusion; only the pinned referee's verified receipt proves contest acceptance. Yellow Paper values remain research-draft inputs until FLOP Labs publishes live network parameters.
