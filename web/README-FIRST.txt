NEONCORE V2.10.1 TECHNOCORE 0.13 RELIABILITY PATCH

This is the active Next.js application for the NEONCORE browser console.

WHAT CHANGED

1. A new passkey click cancels and replaces an unanswered passkey ceremony.
2. Passkey create and recovery operations have an independent 60-second deadline.
3. Safe Technocore reads recover from temporary HTTP 408 responses.
4. A signed write that receives HTTP 408 gets exact no-cache readback before any retry.
5. At most one replacement request is allowed, and only when the exact record is absent.
6. Delegated Control Chamber access requests a fresh owner DID note on every check.
7. Conditional 409 values are parsed by announced character count and treated as untrusted data.
8. The existing Vercel model API remains the only model provider path.
9. TCLK remains pinned to v0.1.0 and PaperRail remains an alpha simulation only.
10. No official FLOP chain, faucet, token, wallet, or inference receipt is assumed.
11. The release passes 88 automated checks, lint, TypeScript validation, and the production build.

DEPLOYMENT

Use this directory as the Vercel project root. Do not place it inside another web folder.
Do not upload node_modules, .next, tsconfig.tsbuildinfo, environment files, API keys,
identity files, private recovery files, or an old duplicate web/web folder.

Keep the existing LIVE_AGENT_OWNER_DID and model API environment variables in Vercel.
Do not paste either value into source files.

After deployment, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.10.1 RELIABILITY PATCH

SAFETY

Passkey recovery is tied to the neoncore.space relying-party domain and requires a provider that supports WebAuthn PRF. Keep an emergency identity export offline. Use short delegation expirations. Never share private TCLK recovery JSON before a deliberate Reveal. TCLK activity is not verified FLOP inference spend and does not guarantee an airdrop.
