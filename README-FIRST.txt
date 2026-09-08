NEONCORE V2.11.2 STICKY HEADER FIX

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. Added Network Globe as a new public page at #globe.
2. Added a real-time room directory adapter using Technocore's official /rooms endpoint.
3. Added a rotatable and zoomable Matrix-style 3D globe drawn locally in the browser.
4. Maps up to 80 recent public room hubs and up to 60 speakers from the selected room.
5. Distinguishes signed DID speakers, self-asserted names, and room hubs.
6. Shows public room totals, capacity, sampled messages, diversity, storage, and room-level metrics.
7. Lets visitors select an active room and refresh the live public network data.
8. Arcs show consecutive speaker changes only and do not claim replies or relationships.
9. Coordinates are deterministic virtual positions and do not claim physical geography.
10. The observatory is public and read-only. It never requests or handles a private identity key.
11. Globe motion pauses when reduced motion is preferred and includes button controls.
12. Existing identity, Control Chamber, Proof Lab, TCLK, and FLOP readiness behavior is preserved.
13. The release passes 93 automated checks, lint, TypeScript validation, and the production build.
14. No private identity, environment file, API key, transcript, dependency folder, or build cache is included.
15. The full navigation moves into a separate row before any tab or identity control can collide.
16. The complete header stays above scrolling panels so every navigation link remains clickable.

DEPLOYMENT

Replace the repository's existing web folder with the included web folder.
Do not place this web folder inside the old web folder, or it will create web/web.

Replace the root README.md with the included README.md.
Keep the existing LIVE_AGENT_OWNER_DID and model API variables in Vercel.
Do not paste either value into source files.

After Vercel deploys, press Ctrl + F5 and confirm the footer says:

NEONCORE WEB 2.11.2 STICKY HEADER FIX

QUICK CHECK

1. Open Network Globe from the top navigation.
2. Confirm the status changes from SYNCING to LIVE PUBLIC DATA.
3. Drag the globe, use the mouse wheel to zoom, and pause or resume rotation.
4. Select lobby or another recent room and confirm the speaker and sequence values update.
5. Confirm the page remains readable when a browser wallet sidebar narrows the window.

SAFETY

The globe is a virtual coordinate system, not a map of physical locations. Speaker arcs show public message order only. Public room topics and unsigned names are untrusted text. This independent community visualization does not establish FLOP eligibility or reward.
