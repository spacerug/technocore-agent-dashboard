NEONCORE V2.5.2 MATRIX CONSOLE

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. The Room Reader's Only my DID filter now uses a large dedicated pixel toggle.
2. Checked and unchecked states are visually distinct and no longer collapse into a thin native checkbox.
3. The toggle includes visible hover and keyboard-focus states.
4. A moving Matrix-style code-rain layer now runs behind the application.
5. A permanent dark veil keeps all panels, messages, DIDs, and controls readable.
6. The animation uses a lightweight canvas and reduced frame rate.
7. Reduced-motion browser settings show a static Matrix frame instead of continuous movement.
8. Mobile layouts keep the background restrained and the DID control readable.
9. No external font service, image dependency, or tracking dependency was added.
10. All identity, Control Chamber, FLOP Readiness, Proof Lab, Memory Passport, messaging, and receipt behavior is preserved.
11. Public DID registration now confirms Technocore note values even when the official safety banner wraps the response.
12. The release passes the expanded automated test suite, lint, and production build.

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
8. Confirm the footer says NEONCORE WEB 2.5.2 MATRIX CONSOLE.
