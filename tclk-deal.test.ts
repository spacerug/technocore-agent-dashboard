import assert from "node:assert/strict";
import test from "node:test";

import { dealRoom, encodeFrame, validateFrame } from "@flop-labs/tclk";
import {
  TCLK_OFFER_ROOM,
  auditTclkDeal,
  createPaperOffer,
  paperNoteAuthorizationText,
  parseTclkRecovery,
  preparePaperAccept,
  receiptForVerifiedState,
  scanTclkOfferBoard,
  tclkPublicExport,
  type TclkBoardDeal,
  type TclkRoomMessage,
} from "../app/lib/tclk-deal";
import {
  encodeTclkCompatibleFrame,
  makeTclkHeartbeat,
  tclkOfferIncludesRail,
  withTclkRailRef,
} from "../app/lib/tclk-compat";
import {
  loadIdentityJson,
  signBytes,
  type BrowserIdentity,
} from "../app/lib/browser-crypto";

const PAYER_SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const PAYEE_SEED = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const OUTSIDER_SEED = "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f";
const NOW = 1788372000000;

async function identity(seed: string, name: string): Promise<BrowserIdentity> {
  return loadIdentityJson(JSON.stringify({ private_key_hex: seed }), `${name}.json`);
}

async function signedMessage(
  signer: BrowserIdentity,
  room: string,
  seq: number,
  timestampMs: number,
  text: string,
  nonce: number | string = timestampMs,
): Promise<TclkRoomMessage> {
  const nonceText = String(nonce);
  const sig = await signBytes(signer, new TextEncoder().encode(`${room}|${nonceText}|${text}`));
  return {
    room,
    seq,
    ts: new Date(timestampMs).toISOString(),
    from: signer.did,
    nonce,
    sig,
    text,
  };
}

async function preparedDeal(): Promise<{
  payer: BrowserIdentity;
  payee: BrowserIdentity;
  offer: ReturnType<typeof createPaperOffer>;
  prepared: ReturnType<typeof preparePaperAccept>;
  deal: TclkBoardDeal;
}> {
  const payer = await identity(PAYER_SEED, "payer");
  const payee = await identity(PAYEE_SEED, "payee");
  const offer = createPaperOffer(payer.did, {
    amount: "100",
    taskId: "task-001",
    taskContext: "Verify a useful result",
    offerMinutes: 15,
    claimMinutes: 60,
    refundMinutes: 120,
  }, NOW);
  const prepared = preparePaperAccept(offer, payee.did, NOW + 1_000);
  const board = await scanTclkOfferBoard([
    await signedMessage(payer, TCLK_OFFER_ROOM, 1, NOW, encodeFrame(offer)),
    await signedMessage(payee, TCLK_OFFER_ROOM, 2, NOW + 1_000, encodeFrame(prepared.accept)),
  ]);
  assert.equal(board.deals.length, 1);
  return { payer, payee, offer, prepared, deal: board.deals[0] };
}

test("creates an official PaperRail payer offer with an A2A job binding", async () => {
  const { offer } = await preparedDeal();
  assert.equal(offer.type, "offer");
  assert.equal(offer.role, "payer");
  assert.equal(offer.asset, "PAPER");
  assert.deepEqual(offer.rails, ["paper"]);
  assert.equal(offer.job?.proto, "a2a");
  assert.equal(offer.job?.id, "task-001");
  assert.match(encodeFrame(offer), /^tclk1 \{/);
});

test("requires a private recovery before accept and verifies its hash lock", async () => {
  const { payee, prepared } = await preparedDeal();
  const restored = parseTclkRecovery(prepared.recoveryText);
  assert.equal(restored.owner_did, payee.did);
  assert.equal(restored.contract_id, prepared.accept.contract);
  assert.equal(restored.statement, prepared.accept.statement);
  assert.match(restored.preimage, /^0x[0-9a-f]{64}$/);
});

test("rejects a recovery file whose secret no longer opens the statement", async () => {
  const { prepared } = await preparedDeal();
  const changed = { ...prepared.recovery, preimage: `0x${"00".repeat(32)}` };
  assert.throws(() => parseTclkRecovery(JSON.stringify(changed)), /does not open/i);
});

test("offer board authenticates full signed records and rejects forged senders", async () => {
  const { payer, payee, offer } = await preparedDeal();
  const validText = encodeFrame(offer);
  const forged = await signedMessage(payee, TCLK_OFFER_ROOM, 3, NOW + 3_000, validText);
  forged.from = payer.did;
  const scan = await scanTclkOfferBoard([
    forged,
    { ...(await signedMessage(payer, "wrong-room", 4, NOW + 4_000, validText)), room: "wrong-room" },
    { seq: 5, room: TCLK_OFFER_ROOM, from: payer.did, text: "tclk1 {broken" },
  ]);
  assert.equal(scan.offers.length, 0);
  assert.equal(scan.rejected.length, 3);
  assert.match(scan.rejected[0].reason, /signature does not verify/i);
  assert.match(scan.rejected[1].reason, /belongs to wrong-room/i);
});

test("offer board rejects an accept that precedes its authenticated offer", async () => {
  const { payer, payee, offer, prepared } = await preparedDeal();
  const scan = await scanTclkOfferBoard([
    await signedMessage(payee, TCLK_OFFER_ROOM, 1, NOW + 1_000, encodeFrame(prepared.accept)),
    await signedMessage(payer, TCLK_OFFER_ROOM, 2, NOW + 2_000, encodeFrame(offer)),
  ]);
  assert.equal(scan.deals.length, 0);
  assert.equal(scan.offers.length, 1);
  assert.match(scan.rejected[0].reason, /no preceding authenticated offer/i);
});

test("preserves and verifies decimal string nonces beyond JavaScript safe integers", async () => {
  const { payer, offer } = await preparedDeal();
  const message = await signedMessage(
    payer,
    TCLK_OFFER_ROOM,
    99,
    NOW + 5_000,
    encodeFrame(offer),
    "900719925474099300001",
  );
  const scan = await scanTclkOfferBoard([message]);
  assert.equal(scan.offers.length, 1);
  assert.equal(scan.offers[0].record.nonce, "900719925474099300001");
});

test("folds lock, heartbeat, and reveal through the compatibility state machine", async () => {
  const { payer, payee, prepared, deal } = await preparedDeal();
  const lock = validateFrame({ type: "lock", from: payer.did, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const heartbeat = makeTclkHeartbeat(payee.did, prepared.accept.contract, "Still processing useful work");
  const revealLegacy = validateFrame({ type: "reveal", from: payee.did, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  if (revealLegacy.type !== "reveal") throw new Error("Test reveal frame was not created.");
  const reveal = withTclkRailRef(revealLegacy, prepared.accept.contract);
  const audit = await auditTclkDeal(deal, [
    await signedMessage(payer, deal.room, 1, NOW + 2_000, encodeTclkCompatibleFrame(lock)),
    await signedMessage(payee, deal.room, 2, NOW + 3_000, encodeTclkCompatibleFrame(heartbeat)),
    await signedMessage(payee, deal.room, 3, NOW + 4_000, encodeTclkCompatibleFrame(reveal)),
  ]);
  assert.equal(audit.state.status, "claimed");
  assert.equal(audit.accepted.length, 5);
  assert.equal(audit.heartbeats.length, 1);
  assert.equal(audit.rejected.length, 0);
  assert.equal(audit.room, dealRoom(prepared.accept.contract));
});

test("rejects a heartbeat from a DID that is not a contract party", async () => {
  const { deal, prepared } = await preparedDeal();
  const outsider = await identity(OUTSIDER_SEED, "outsider");
  const heartbeat = makeTclkHeartbeat(outsider.did, prepared.accept.contract);
  const audit = await auditTclkDeal(deal, [
    await signedMessage(outsider, deal.room, 1, NOW + 2_000, encodeTclkCompatibleFrame(heartbeat)),
  ]);
  assert.equal(audit.state.status, "accepted");
  assert.equal(audit.heartbeats.length, 0);
  assert.match(audit.rejected[0].reason, /not from a contract party/i);
});

test("rejects a lock posted after the refund deadline", async () => {
  const { payer, offer, prepared, deal } = await preparedDeal();
  const lock = validateFrame({ type: "lock", from: payer.did, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const late = offer.refundAfterMs + 1;
  const audit = await auditTclkDeal(deal, [
    await signedMessage(payer, deal.room, 1, late, encodeTclkCompatibleFrame(lock)),
  ]);
  assert.equal(audit.state.status, "accepted");
  assert.match(audit.rejected[0].reason, /refund window is already open/i);
});

test("rejects a reveal whose rail reference conflicts with the verified lock", async () => {
  const { payer, payee, prepared, deal } = await preparedDeal();
  const lock = validateFrame({ type: "lock", from: payer.did, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const revealLegacy = validateFrame({ type: "reveal", from: payee.did, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  if (revealLegacy.type !== "reveal") throw new Error("Test reveal frame was not created.");
  const reveal = withTclkRailRef(revealLegacy, `0x${"ff".repeat(32)}`);
  const audit = await auditTclkDeal(deal, [
    await signedMessage(payer, deal.room, 1, NOW + 2_000, encodeTclkCompatibleFrame(lock)),
    await signedMessage(payee, deal.room, 2, NOW + 3_000, encodeTclkCompatibleFrame(reveal)),
  ]);
  assert.equal(audit.state.status, "locked");
  assert.match(audit.rejected[0].reason, /different rail reference/i);
});

test("independently rejects a receipt that conflicts with terminal state", async () => {
  const { payer, payee, prepared, deal } = await preparedDeal();
  const lock = validateFrame({ type: "lock", from: payer.did, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const revealLegacy = validateFrame({ type: "reveal", from: payee.did, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  if (revealLegacy.type !== "reveal") throw new Error("Test reveal frame was not created.");
  const reveal = withTclkRailRef(revealLegacy, prepared.accept.contract);
  const falseReceipt = validateFrame({ type: "receipt", from: payer.did, contract: prepared.accept.contract, outcome: "refunded", rail: "paper", ref: prepared.accept.contract });
  const audit = await auditTclkDeal(deal, [
    await signedMessage(payer, deal.room, 1, NOW + 2_000, encodeTclkCompatibleFrame(lock)),
    await signedMessage(payee, deal.room, 2, NOW + 3_000, encodeTclkCompatibleFrame(reveal)),
    await signedMessage(payer, deal.room, 3, NOW + 4_000, encodeTclkCompatibleFrame(falseReceipt)),
  ]);
  assert.equal(audit.state.status, "claimed");
  assert.equal(audit.rejected.length, 1);
  assert.match(audit.rejected[0].reason, /claims refunded.*state is claimed/i);
});

test("creates receipts only when their outcome matches the verified terminal state", async () => {
  const { payer, payee, prepared, deal } = await preparedDeal();
  const lock = validateFrame({ type: "lock", from: payer.did, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const revealLegacy = validateFrame({ type: "reveal", from: payee.did, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  if (revealLegacy.type !== "reveal") throw new Error("Test reveal frame was not created.");
  const reveal = withTclkRailRef(revealLegacy, prepared.accept.contract);
  const audit = await auditTclkDeal(deal, [
    await signedMessage(payer, deal.room, 1, NOW + 2_000, encodeTclkCompatibleFrame(lock)),
    await signedMessage(payee, deal.room, 2, NOW + 3_000, encodeTclkCompatibleFrame(reveal)),
  ]);
  assert.equal(receiptForVerifiedState(audit.state, payer.did).outcome, "claimed");
  assert.throws(() => receiptForVerifiedState({ ...audit.state, status: "locked" }, payer.did), /terminal state/i);
  assert.throws(() => receiptForVerifiedState(audit.state, "did:key:z6Mkwrong"), /contract party/i);
});

test("normalizes current PaperRail aliases without accepting unknown rails", () => {
  assert.equal(tclkOfferIncludesRail(["PaperRail"], "paper"), true);
  assert.equal(tclkOfferIncludesRail(["paper-rail"], "paper"), true);
  assert.equal(tclkOfferIncludesRail(["unknown-rail"], "paper"), false);
});

test("exports authenticated public records and never includes the private recovery secret", async () => {
  const { prepared, deal } = await preparedDeal();
  const audit = await auditTclkDeal(deal, []);
  const exported = tclkPublicExport(deal, audit);
  assert.match(exported, new RegExp(TCLK_OFFER_ROOM));
  assert.match(exported, /"signature":/);
  assert.match(exported, /PaperRail settles nothing/);
  assert.doesNotMatch(exported, new RegExp(prepared.recovery.preimage));
});

test("paper note authorization binds every mutation field and condition", async () => {
  const payer = await identity(PAYER_SEED, "payer");
  const text = paperNoteAuthorizationText({
    did: payer.did,
    nonce: NOW,
    ns: "tclk-paper-ab",
    key: "0123456789cdef",
    value: `tclkpaper1 locked hash 0x${"11".repeat(32)} ${NOW + 120_000}`,
    condition: { ifAbsent: true },
  });
  assert.match(text, new RegExp(`^neoncore-tclk-paper\\|${payer.did.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|${NOW}\\|tclk-paper-ab\\|0123456789cdef\\|`));
  assert.match(text, /\|if_absent$/);
});
