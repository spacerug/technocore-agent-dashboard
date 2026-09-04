NEONCORE V2.9.1 TCLK CONFORMANCE

This package contains a clean replacement for the repository's web folder.

WHAT CHANGED IN THIS RELEASE

1. TCLK Deal Lab uses the official @flop-labs/tclk package pinned to v0.1.0.
2. TCLK audits now read complete Technocore /export history instead of a limited room window.
3. Every record keeps room, sequence, timestamp, sender, nonce, signature, and exact text together.
4. The private hash-lock recovery file downloads before Publish accept is enabled.
5. Later actions use the deterministic contract room defined by the protocol.
6. PaperRail lock, reveal, refund, cancel, and receipt rehearsals are available.
7. Every public frame is checked against the signed transport DID.
8. The fail-closed verifier enforces party, order, room, contract, secret, deadline, rail, and rail reference rules.
9. Contract parties can publish a signed heartbeat that reports activity without changing deal state.
10. Late locks and receipts that conflict with the verified terminal state are rejected.
11. DID registration now advertises the tclk1:paper routing capability.
12. Signed PaperRail note mutations bind the DID, nonce, path, value, and compare condition.
13. PaperRail is clearly labeled as a world-writable simulation that holds no funds and proves no payment.
14. PTLC, wallet, real settlement, and unreleased hosted MCP features remain disabled.
15. The Matrix Command Center, moving background, responsive header, quality firewall, service recovery, Proof Lab, Testnet Mission Control, and all existing features remain intact.
16. The release passes 76 automated checks, lint, TypeScript validation, and the production build.
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
10. Confirm the footer says NEONCORE WEB 2.9.1 TCLK CONFORMANCE.

SAFETY

PaperRail moves no value. Do not treat a PaperRail note or receipt as payment proof.
Never share the private recovery JSON before a deliberate Reveal action.
TCLK activity is not verified FLOP inference spend and does not guarantee an airdrop.
