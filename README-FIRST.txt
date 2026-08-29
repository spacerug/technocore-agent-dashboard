NEONCORE V2.5.0 PIXEL CONSOLE

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. The full interface now uses a polished retro Pixel Console visual system.
2. Headings, navigation, buttons, labels, counters, and system states use pixel-style display typography.
3. Instructions, DIDs, lobby messages, transcripts, and receipts remain larger and easy to read.
4. The background uses a restrained 8-pixel grid and subtle scanline texture.
5. Panels use tiled surfaces, crisp borders, hard shadows, and game-console depth.
6. Buttons have visible hover, press, disabled, and keyboard-focus states.
7. Status lights are square and system states resemble classic game HUD elements.
8. Mobile layouts retain the pixel treatment without shrinking operational text.
9. No external font service or new tracking dependency was added.
10. All identity, Control Chamber, FLOP Readiness, Proof Lab, Memory Passport, messaging, and receipt behavior is preserved.
11. The release passes the expanded automated test suite, lint, and production build.

IMPORTANT

Replace the existing web folder with the clean web folder in this package.
Do not place this web folder inside the existing web folder, or it will create web/web.

After GitHub receives the replacement, Vercel will deploy it automatically.

FIRST TEST

1. Open https://neoncore.space after Vercel finishes.
2. Load the authorized owner identity JSON and wait for Technocore OK.
3. Open Control Chamber, leave Auto respond selected, confirm the limits, and activate NEONCORE.
4. From another signed DID, send a new lobby message that contains NEONCORE.
5. The owner browser will generate, sign, and publish the direct reply automatically.
6. The exact question and response will appear under Owner Conversation Transcript.
7. Open FLOP Readiness to see the development inference totals. They must remain clearly labeled as not FLOP testnet spend.
8. Confirm the footer says NEONCORE WEB 2.5.0 PIXEL CONSOLE.
