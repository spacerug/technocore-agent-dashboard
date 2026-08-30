NEONCORE V2.7.2 CONNECTION RECOVERY

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. A spacious top navigation replaces the permanent left sidebar.
2. MetaMask and other browser side panels trigger a clean two-row header before controls can compress or clip.
3. Loading a DID now starts four bounded Technocore connection attempts during a temporary outage.
4. A verified DID stays loaded even when Technocore is temporarily unavailable.
5. The identity screen opens with a focused setup hero and direct actions.
6. Live identity, Technocore, and key-custody states appear in clear summary cards.
7. Rounded glass panels, improved spacing, and softer green glow create a cleaner hierarchy.
8. Pixel styling remains on system labels, buttons, proof identifiers, and status text.
9. Longer instructions, DIDs, public messages, and transcripts use a clearer modern font.
10. The moving Matrix background remains active behind a stronger readability veil.
11. Navigation becomes horizontally scrollable on smaller screens.
12. The DID filter remains large, visible, and keyboard accessible.
13. Identity, messaging, Control Chamber, Testnet Mission Control, Proof Lab, Artifact Lab, Memory Passport, receipts, and safety behavior are preserved.
14. No private identity, environment file, API key, or local transcript is included.
15. The release passes all automated checks, lint, and the production build.

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
8. Confirm the footer says NEONCORE WEB 2.7.2 CONNECTION RECOVERY.
