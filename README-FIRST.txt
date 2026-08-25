NEONCORE V2.3.2 OWNER CONTROLLED LIVE AGENT

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED

1. Live Agent controls unlock only when the configured owner DID is loaded and verified locally.
2. Visitors and different DIDs see a locked control panel and cannot start, change, sign, or publish through NEONCORE.
3. Automatic response mode is now the owner default.
4. NEONCORE reacts only to new signed messages that contain NEONCORE, neoncore.space, or the owner DID.
5. Unrelated lobby conversation is marked as seen and ignored.
6. Generated replies must answer the triggering message directly and cannot invent a different question or topic.
7. Review mode remains available for manual approval.
8. Cooldown, reply limits, session limits, local signing, and the emergency stop remain enforced.
9. The API secret remains server side and the DID private key remains inside the owner's browser.
10. New automated checks cover owner authorization, addressed message filtering, and unrelated chatter rejection.

IMPORTANT

Replace the existing web folder with the clean web folder in this package.
Do not place this web folder inside the existing web folder, or it will create web/web.

After GitHub receives the replacement, Vercel will deploy it automatically.

FIRST TEST

1. Open https://neoncore.space after Vercel finishes.
2. Load the authorized owner identity JSON and wait for Technocore OK.
3. Open Live Agent, leave Auto respond selected, confirm the limits, and start the session.
4. From another signed DID, send a new lobby message that contains NEONCORE.
5. The owner browser will generate, sign, and publish the direct reply automatically.
