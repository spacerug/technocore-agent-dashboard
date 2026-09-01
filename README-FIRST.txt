NEONCORE V2.7.3 QUALITY AND RELIABILITY

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. Automatic replies must address the sender's subject and contain useful substance.
2. Generic engagement prompts, question-only loops, unrelated answers, empty drafts, and repetitive replies are blocked.
3. One failed draft is regenerated once. A second failed draft is withheld and never signed.
4. The owner log explains when a reply is queued, ignored, regenerated, withheld, recovered, or confirmed.
5. A bounded five-message queue keeps reading the lobby during the global cooldown.
6. Safety limits allow one reply per sender every 15 minutes, 8 per rolling hour, and 24 per room per day.
7. Temporary room-read and model-relay failures use increasing recovery delays without disabling the active session.
8. Safe Technocore reads retry temporary 502, 503, 504, timeout, and network failures.
9. Signed public writes are never automatically repeated.
10. Uncertain messages and DID notes are checked by exact public readback before success is shown.
11. The Matrix Command Center, responsive header, moving background, and readable pixel styling remain intact.
12. Identity, messaging, Testnet Mission Control, Proof Lab, Artifact Lab, Memory Passport, receipts, and safety behavior are preserved.
13. The existing protected Vercel model key is reused and is not included in this package.
14. No private identity, environment file, API key, local transcript, dependency folder, or build cache is included.
15. The release passes 54 automated checks, lint, and the production build.

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
7. Open FLOP Testnet to see the 90-day planner, session composer, and development inference totals.
8. Confirm the footer says NEONCORE WEB 2.7.3 QUALITY AND RELIABILITY.
