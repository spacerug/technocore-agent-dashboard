NEONCORE V2.10.0 PASSKEY AUTHORITY

This is the active Next.js application for the NEONCORE browser console.

WHAT CHANGED

1. Passkey DID creation uses required device verification and WebAuthn PRF.
2. A separate Recover with passkey action restores the same DID on neoncore.space.
3. Existing identity JSON loading and export-only DID creation remain available.
4. Emergency private identity export remains available for passkey DIDs.
5. Owners can publish room-scoped, expiring delegated-agent authority.
6. Delegations use the official delegate canonical string and 1 to 19 digit nonce rules.
7. Control Chamber authorization is checked on the server for every model request.
8. A newer expired delegation record revokes an agent without reactivating older records.
9. Owner DID-note updates preserve TCLK capability and use compare-and-set readback.
10. Control Chamber room reads use since cursors and ten-second live wait.
11. Room generation changes and retention gaps create a safe fresh baseline.
12. Hidden tabs abort the browser wait; temporary failures keep bounded recovery delays.
13. The existing private model API remains the only model provider path.
14. TCLK remains pinned to v0.1.0 and PaperRail remains an alpha simulation only.
15. No official FLOP chain, faucet, token, wallet, or inference receipt is assumed.
16. All automated checks, lint, TypeScript validation, and the production build must pass before deployment.

DEPLOYMENT

Use this directory as the Vercel project root. Do not place it inside another web folder.
Do not upload node_modules, .next, tsconfig.tsbuildinfo, environment files, API keys,
identity files, private recovery files, or the old duplicate web/web folder.

Keep the existing LIVE_AGENT_OWNER_DID and model API environment variables in Vercel.
Do not paste either value into source files.

After deployment, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.10.0 PASSKEY AUTHORITY

SAFETY

Passkey recovery is tied to the neoncore.space relying-party domain and requires a
provider that supports WebAuthn PRF. Keep an emergency identity export offline.
Use short delegation expirations and expire a delegation immediately when it is no
longer needed. Never share private TCLK recovery JSON before a deliberate Reveal.
TCLK activity is not verified FLOP inference spend and does not guarantee an airdrop.
