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
  type TclkRoomMessage,
} from "../app/lib/tclk-deal";

const PAYER = "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf";
const PAYEE = "did:key:z6MkhiCydpsituD2tUvk7R5Ce3gnpmecZCyGFyeDeEviXxve";
const NOW = 1788372000000;

function preparedDeal() {
  const offer = createPaperOffer(PAYER, {
    amount: "100",
    taskId: "task-001",
    taskContext: "Verify a useful result",
    offerMinutes: 15,
    claimMinutes: 60,
    refundMinutes: 120,
  }, NOW);
  const prepared = preparePaperAccept(offer, PAYEE, NOW + 1_000);
  const boardMessages: TclkRoomMessage[] = [
    { seq: 1, ts: new Date(NOW).toISOString(), from: PAYER, nonce: NOW, text: encodeFrame(offer) },
    { seq: 2, ts: new Date(NOW + 1_000).toISOString(), from: PAYEE, nonce: NOW + 1_000, text: encodeFrame(prepared.accept) },
  ];
  const board = scanTclkOfferBoard(boardMessages);
  assert.equal(board.deals.length, 1);
  return { offer, prepared, board, deal: board.deals[0] };
}

test("creates an official PaperRail payer offer with an A2A job binding", () => {
  const { offer } = preparedDeal();
  assert.equal(offer.type, "offer");
  assert.equal(offer.role, "payer");
  assert.equal(offer.asset, "PAPER");
  assert.deepEqual(offer.rails, ["paper"]);
  assert.equal(offer.job?.proto, "a2a");
  assert.equal(offer.job?.id, "task-001");
  assert.match(encodeFrame(offer), /^tclk1 \{/);
});

test("requires a private recovery before accept and verifies its hash lock", () => {
  const { prepared } = preparedDeal();
  const restored = parseTclkRecovery(prepared.recoveryText);
  assert.equal(restored.owner_did, PAYEE);
  assert.equal(restored.contract_id, prepared.accept.contract);
  assert.equal(restored.statement, prepared.accept.statement);
  assert.match(restored.preimage, /^0x[0-9a-f]{64}$/);
});

test("rejects a recovery file whose secret no longer opens the statement", () => {
  const { prepared } = preparedDeal();
  const changed = { ...prepared.recovery, preimage: `0x${"00".repeat(32)}` };
  assert.throws(() => parseTclkRecovery(JSON.stringify(changed)), /does not open/i);
});

test("offer board accepts only signed-lane frames whose sender matches the frame", () => {
  const { offer } = preparedDeal();
  const scan = scanTclkOfferBoard([
    { seq: 1, from: PAYEE, text: encodeFrame(offer) },
    { seq: 2, from: PAYER, text: "tclk1 {broken" },
    { seq: 3, text: encodeFrame(offer) },
  ]);
  assert.equal(scan.offers.length, 0);
  assert.equal(scan.rejected.length, 3);
});

test("folds lock and reveal through the official fail-closed state machine", () => {
  const { prepared, deal } = preparedDeal();
  const lock = validateFrame({ type: "lock", from: PAYER, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const reveal = validateFrame({ type: "reveal", from: PAYEE, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  const audit = auditTclkDeal(deal, [
    { seq: 1, ts: new Date(NOW + 2_000).toISOString(), from: PAYER, text: encodeFrame(lock) },
    { seq: 2, ts: new Date(NOW + 3_000).toISOString(), from: PAYEE, text: encodeFrame(reveal) },
  ], NOW + 3_000);
  assert.equal(audit.state.status, "claimed");
  assert.equal(audit.accepted.length, 4);
  assert.equal(audit.rejected.length, 0);
  assert.equal(audit.room, dealRoom(prepared.accept.contract));
});

test("independently rejects a receipt that conflicts with terminal state", () => {
  const { prepared, deal } = preparedDeal();
  const lock = validateFrame({ type: "lock", from: PAYER, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const reveal = validateFrame({ type: "reveal", from: PAYEE, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  const falseReceipt = validateFrame({ type: "receipt", from: PAYER, contract: prepared.accept.contract, outcome: "refunded", rail: "paper", ref: prepared.accept.contract });
  const audit = auditTclkDeal(deal, [
    { seq: 1, ts: new Date(NOW + 2_000).toISOString(), from: PAYER, text: encodeFrame(lock) },
    { seq: 2, ts: new Date(NOW + 3_000).toISOString(), from: PAYEE, text: encodeFrame(reveal) },
    { seq: 3, ts: new Date(NOW + 4_000).toISOString(), from: PAYER, text: encodeFrame(falseReceipt) },
  ], NOW + 4_000);
  assert.equal(audit.state.status, "claimed");
  assert.equal(audit.rejected.length, 1);
  assert.match(audit.rejected[0].reason, /claims refunded.*state is claimed/i);
});

test("creates receipts only when their outcome matches the verified terminal state", () => {
  const { prepared, deal } = preparedDeal();
  const lock = validateFrame({ type: "lock", from: PAYER, contract: prepared.accept.contract, rail: "paper", ref: prepared.accept.contract });
  const reveal = validateFrame({ type: "reveal", from: PAYEE, contract: prepared.accept.contract, secret: prepared.recovery.preimage });
  const audit = auditTclkDeal(deal, [
    { seq: 1, ts: new Date(NOW + 2_000).toISOString(), from: PAYER, text: encodeFrame(lock) },
    { seq: 2, ts: new Date(NOW + 3_000).toISOString(), from: PAYEE, text: encodeFrame(reveal) },
  ], NOW + 3_000);
  assert.equal(receiptForVerifiedState(audit.state, PAYER).outcome, "claimed");
  assert.throws(() => receiptForVerifiedState({ ...audit.state, status: "locked" }, PAYER), /terminal state/i);
  assert.throws(() => receiptForVerifiedState(audit.state, "did:key:z6Mkwrong"), /contract party/i);
});

test("exports only the public transcript and labels PaperRail truthfully", () => {
  const { prepared, deal } = preparedDeal();
  const audit = auditTclkDeal(deal, [], NOW + 2_000);
  const exported = tclkPublicExport(deal, audit);
  assert.match(exported, new RegExp(TCLK_OFFER_ROOM));
  assert.match(exported, /PaperRail settles nothing/);
  assert.doesNotMatch(exported, new RegExp(prepared.recovery.preimage));
});

test("paper note authorization binds every mutation field and condition", () => {
  const text = paperNoteAuthorizationText({
    did: PAYER,
    nonce: NOW,
    ns: "tclk-paper-ab",
    key: "0123456789cdef",
    value: `tclkpaper1 locked hash 0x${"11".repeat(32)} ${NOW + 120_000}`,
    condition: { ifAbsent: true },
  });
  assert.match(text, new RegExp(`^neoncore-tclk-paper\\|${PAYER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|${NOW}\\|tclk-paper-ab\\|0123456789cdef\\|`));
  assert.match(text, /\|if_absent$/);
});

