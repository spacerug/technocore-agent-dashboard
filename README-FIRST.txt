NEONCORE V2.9.0 TCLK DEAL LAB

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. TCLK Deal Lab uses the official @flop-labs/tclk package pinned to v0.1.0.
2. A payer DID can create a useful A2A offer in the public tclk-offers room.
3. A different payee DID can prepare and publish the matching accept frame.
4. The private hash-lock recovery file downloads before Publish accept is enabled.
5. Later actions use the deterministic contract room defined by the protocol.
6. PaperRail lock, reveal, refund, cancel, and receipt rehearsals are available.
7. Every public frame is checked against the signed transport DID.
8. The official fail-closed state machine verifies party, order, contract, secret, and deadline rules.
9. An independent guard rejects receipt outcomes that conflict with the verified terminal state.
10. Public transcript exports never include an unrevealed recovery secret.
11. DID registration now advertises the tclk1:paper routing capability.
12. Signed PaperRail note mutations bind the DID, nonce, path, value, and compare condition.
13. PaperRail is clearly labeled as a world-writable simulation that holds no funds and proves no payment.
14. PTLC, wallet, real settlement, and unreleased hosted MCP features remain disabled.
15. The Matrix Command Center, moving background, responsive header, quality firewall, service recovery, Proof Lab, Testnet Mission Control, and all existing features remain intact.
16. The release passes 68 automated checks, lint, TypeScript validation, and the production build.
17. No private identity, recovery file, environment file, API key, local transcript, dependency folder, or build cache is included.

IMPORTANT

Replace the existing web folder with the clean web folder in this package.
Do not place this web folder inside the existing web folder, or it will create web/web.

Replace the repository's root README.md with the included README.md.
After GitHub receives the replacement, Vercel will deploy it automatically.

TCLK FIRST TEST

1. Open https://neoncore.space after Vercel finishes and press Ctrl + F5.
2. Load DID A, wait for Technocore OK, and optionally register its DID + TCLK capability.
3. Open TCLK Deal Lab and publish a PAPER offer.
4. In an Incognito window, load a different DID B and refresh the offer board.
5. Select Prepare accept. Save the private recovery JSON before checking the confirmation box.
6. Publish the accept from DID B.
7. Return to DID A, refresh the board, verify the deal, and record the paper lock.
8. Return to DID B, load the private recovery JSON, verify the deal, then reveal and claim.
9. Publish a matching receipt and export the public transcript.
10. Confirm the footer says NEONCORE WEB 2.9.0 TCLK DEAL LAB.

SAFETY

PaperRail moves no value. Do not treat a PaperRail note or receipt as payment proof.
Never share the private recovery JSON before a deliberate Reveal action.
TCLK activity is not verified FLOP inference spend and does not guarantee an airdrop.
