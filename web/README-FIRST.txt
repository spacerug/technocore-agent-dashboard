NEONCORE V2.9.1 TCLK CONFORMANCE

This is the active Next.js application for the NEONCORE browser console.

WHAT CHANGED

1. The official @flop-labs/tclk dependency remains pinned to v0.1.0.
2. Deal Lab reads the complete Technocore /export JSONL history for audits.
3. Room, sequence, timestamp, sender, nonce, signature, and exact text remain bound together.
4. Ed25519 record signatures are verified before a frame can advance state.
5. Offer and accept frames must appear in tclk-offers in append order.
6. Later frames must appear in the deterministic contract room.
7. PaperRail aliases normalize to the canonical paper rail.
8. Locks posted after the refund deadline are rejected.
9. Reveal, refund, and receipt rail references must match the verified lock.
10. Either contract party can publish a state-neutral heartbeat while accepted or locked.
11. One malformed export record fails the complete audit.
12. PaperRail still holds no funds, moves no tokens, and proves no payment.
13. PTLC, wallets, real settlement, and unreleased hosted MCP support remain disabled.
14. All 76 automated checks, lint, TypeScript validation, and the production build pass.

DEPLOYMENT

Use this directory as the Vercel project root. Do not place it inside another web folder.
Do not upload node_modules, .next, tsconfig.tsbuildinfo, environment files, API keys,
identity files, private recovery files, or the old duplicate web/web folder.

After deployment, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.9.1 TCLK CONFORMANCE

SAFETY

Never share the private TCLK recovery JSON before a deliberate Reveal action.
TCLK activity is not verified FLOP inference spend and does not guarantee an airdrop.
