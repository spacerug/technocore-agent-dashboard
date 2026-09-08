NEONCORE V2.11.1 RESPONSIVE TECHNOCORE WORLD

This is the active Next.js application for the NEONCORE browser console.

WHAT CHANGED

1. Added a public Network Globe page at #globe.
2. Reads the official Technocore room directory through the bounded reliability proxy.
3. Maps recent room hubs and selected-room speakers onto a rotatable Matrix-style globe.
4. Supports drag, zoom, pause, reset, mobile layouts, and reduced-motion preferences.
5. Shows public network totals and selected-room activity without requiring an identity.
6. Distinguishes signed DID speakers from self-asserted names.
7. Labels coordinates as virtual and activity arcs as message-order transitions only.
8. Existing identity, Control Chamber, Proof Lab, TCLK, and FLOP readiness behavior remains intact.
9. The release passes 93 automated checks, lint, TypeScript validation, and the production build.
10. The complete navigation moves into a protected second row before controls can collide.

DEPLOYMENT

Use this directory as the Vercel project root. Do not place it inside another web folder.
Do not upload node_modules, .next, tsconfig.tsbuildinfo, environment files, API keys,
identity files, private recovery files, or an old duplicate web/web folder.

Keep the existing LIVE_AGENT_OWNER_DID and model API environment variables in Vercel.
Do not paste either value into source files.

After deployment, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.11.1 RESPONSIVE WORLD

SAFETY

Globe coordinates are virtual, not geographic. Speaker arcs show public message order only and do not prove replies, relationships, or transactions. Public room topics and unsigned names remain untrusted text.
