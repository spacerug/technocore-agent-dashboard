import {
  OFFER_ROOM,
  dealRoom,
  generateHashLock,
  makeAccept,
  makeOffer,
  openContract,
  validateFrame,
  verifyHashPreimage,
  type AcceptFrame,
  type ContractState,
  type OfferFrame,
  type ReceiptFrame,
} from "@flop-labs/tclk";
import {
  applyTclkCompatibleFrame,
  authenticateTclkRecord,
  decodeTclkCompatibleFrame,
  tclkOfferIncludesRail,
  type TclkAuthenticatedRecord,
  type TclkCompatibleFrame,
  type TclkRoomMessage,
} from "./tclk-compat";

export type { TclkRoomMessage } from "./tclk-compat";

export const TCLK_RELEASE = "0.1.0";
export const TCLK_OFFER_ROOM = OFFER_ROOM;
export const TCLK_SPEC_URL = "https://github.com/flop-labs/tclk/blob/main/SPEC.md";
export const TCLK_CHANGELOG_URL = "https://github.com/flop-labs/tclk/blob/main/CHANGELOG.md";
export const TCLK_RECOVERY_SCHEMA = "neoncore.tclk-recovery.v1";
export const TCLK_EXPORT_SCHEMA = "neoncore.tclk-public-transcript.v1";

export type TclkPublicFrame = {
  frame: TclkCompatibleFrame;
  message: TclkRoomMessage;
  record: TclkAuthenticatedRecord;
};

export type TclkBoardOffer = TclkPublicFrame & { frame: OfferFrame };

export type TclkBoardDeal = {
  offer: TclkBoardOffer;
  accept: TclkPublicFrame & { frame: AcceptFrame };
  room: string;
};

export type TclkBoardScan = {
  offers: TclkBoardOffer[];
  deals: TclkBoardDeal[];
  rejected: Array<{ seq?: number; reason: string }>;
};

export type TclkAudit = {
  state: ContractState;
  accepted: TclkPublicFrame[];
  heartbeats: TclkPublicFrame[];
  rejected: Array<{ seq?: number; type?: string; reason: string }>;
  room: string;
};

export type TclkRecovery = {
  schema: typeof TCLK_RECOVERY_SCHEMA;
  warning: "PRIVATE RECOVERY FILE - DO NOT SHARE";
  protocol: "tclk/1";
  release: typeof TCLK_RELEASE;
  owner_did: string;
  offer_id: string;
  contract_id: string;
  statement: string;
  preimage: string;
  created_at_utc: string;
};

export type PaperOfferInput = {
  amount: string;
  taskId: string;
  taskContext?: string;
  offerMinutes: number;
  claimMinutes: number;
  refundMinutes: number;
};

export type PaperNoteCondition = { ifAbsent: true } | { if: string } | undefined;

function sequence(message: TclkRoomMessage): number {
  return Number.isSafeInteger(message.seq) ? Number(message.seq) : Number.MAX_SAFE_INTEGER;
}

async function inspectSignedFrame(room: string, message: TclkRoomMessage): Promise<
  | { kind: "not-tclk" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; value: TclkPublicFrame }
> {
  if (typeof message.text !== "string" || !message.text.startsWith("tclk1 ")) return { kind: "not-tclk" };
  let record: TclkAuthenticatedRecord;
  try {
    record = await authenticateTclkRecord(room, message);
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : "TCLK record authentication failed." };
  }
  const frame = decodeTclkCompatibleFrame(record.line);
  if (!frame) return { kind: "invalid", reason: "Malformed, non-canonical, oversized, or unsupported tclk/1 frame." };
  if (frame.from !== record.sender) return { kind: "invalid", reason: "Frame sender does not match the authenticated record sender." };
  return { kind: "valid", value: { frame, message, record } };
}

export async function scanTclkOfferBoard(messages: TclkRoomMessage[]): Promise<TclkBoardScan> {
  const offers = new Map<string, TclkBoardOffer>();
  const deals: TclkBoardDeal[] = [];
  const rejected: TclkBoardScan["rejected"] = [];
  const ordered = [...messages].sort((left, right) => sequence(left) - sequence(right));

  for (const message of ordered) {
    const inspected = await inspectSignedFrame(TCLK_OFFER_ROOM, message);
    if (inspected.kind === "not-tclk") continue;
    if (inspected.kind === "invalid") {
      rejected.push({ seq: message.seq, reason: inspected.reason });
      continue;
    }
    if (inspected.value.frame.type === "offer") {
      if (!offers.has(inspected.value.frame.id)) {
        offers.set(inspected.value.frame.id, { frame: inspected.value.frame, message, record: inspected.value.record });
      }
    } else if (inspected.value.frame.type === "accept") {
      const accept = inspected.value as TclkPublicFrame & { frame: AcceptFrame };
      const offer = offers.get(accept.frame.ref);
      if (!offer) {
        rejected.push({ seq: message.seq, reason: "Accept frame has no preceding authenticated offer in the complete board history." });
        continue;
      }
      const step = applyTclkCompatibleFrame(openContract(offer.frame), accept.frame, accept.record.timestampMs);
      if (!step.ok || !step.state.contract) {
        rejected.push({ seq: message.seq, reason: step.reason ?? "Accept frame failed the TCLK state machine." });
        continue;
      }
      deals.push({ offer, accept, room: dealRoom(step.state.contract) });
    } else {
      rejected.push({ seq: message.seq, reason: `${inspected.value.frame.type} does not belong in the public offer room.` });
    }
  }

  return {
    offers: [...offers.values()].sort((left, right) => sequence(right.message) - sequence(left.message)),
    deals: deals.sort((left, right) => sequence(right.accept.message) - sequence(left.accept.message)),
    rejected,
  };
}

export async function auditTclkDeal(deal: TclkBoardDeal, messages: TclkRoomMessage[]): Promise<TclkAudit> {
  let state = openContract(deal.offer.frame);
  const accepted: TclkPublicFrame[] = [deal.offer];
  const heartbeats: TclkPublicFrame[] = [];
  const rejected: TclkAudit["rejected"] = [];
  const acceptStep = applyTclkCompatibleFrame(state, deal.accept.frame, deal.accept.record.timestampMs);
  if (!acceptStep.ok) throw new Error(acceptStep.reason ?? "The selected accept frame is invalid.");
  state = acceptStep.state;
  accepted.push(deal.accept);

  const ordered = [...messages].sort((left, right) => sequence(left) - sequence(right));
  for (const message of ordered) {
    const inspected = await inspectSignedFrame(deal.room, message);
    if (inspected.kind === "not-tclk") continue;
    if (inspected.kind === "invalid") {
      rejected.push({ seq: message.seq, reason: inspected.reason });
      continue;
    }
    const frame = inspected.value.frame;
    if (frame.type === "offer" || frame.type === "accept") {
      rejected.push({ seq: message.seq, type: frame.type, reason: `${frame.type} belongs in ${TCLK_OFFER_ROOM}.` });
      continue;
    }
    if ("contract" in frame && frame.contract !== state.contract) {
      rejected.push({ seq: message.seq, type: frame.type, reason: "Frame names a different contract." });
      continue;
    }
    const step = applyTclkCompatibleFrame(state, frame, inspected.value.record.timestampMs);
    if (!step.ok) {
      rejected.push({ seq: message.seq, type: frame.type, reason: step.reason ?? "Frame failed the TCLK state machine." });
      continue;
    }
    state = step.state;
    accepted.push(inspected.value);
    if (frame.type === "heartbeat") heartbeats.push(inspected.value);
  }

  return { state, accepted, heartbeats, rejected, room: deal.room };
}

export function createPaperOffer(from: string, input: PaperOfferInput, now = Date.now()): OfferFrame {
  if (!/^[1-9][0-9]*$/.test(input.amount)) throw new Error("Simulation amount must be a positive whole-number string.");
  if (!input.taskId.trim()) throw new Error("Enter a useful task ID before creating the offer.");
  for (const [label, value] of [
    ["offer duration", input.offerMinutes],
    ["claim window", input.claimMinutes],
    ["refund window", input.refundMinutes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive whole number of minutes.`);
  }
  if (input.claimMinutes >= input.refundMinutes) throw new Error("The claim deadline must be before the refund deadline.");
  return makeOffer({
    from,
    role: "payer",
    amount: input.amount,
    asset: "PAPER",
    lock: "hash",
    rails: ["paper"],
    expiresMs: now + input.offerMinutes * 60_000,
    claimByMs: now + input.claimMinutes * 60_000,
    refundAfterMs: now + input.refundMinutes * 60_000,
    job: {
      proto: "a2a",
      id: input.taskId.trim(),
      ...(input.taskContext?.trim() ? { context: input.taskContext.trim() } : {}),
    },
  });
}

export function preparePaperAccept(offer: OfferFrame, ownerDid: string, now = Date.now()): {
  accept: AcceptFrame;
  recovery: TclkRecovery;
  recoveryText: string;
} {
  if (offer.lock !== "hash" || !tclkOfferIncludesRail(offer.rails, "paper") || offer.asset !== "PAPER") {
    throw new Error("NEONCORE v2.9.1 accepts only TCLK PaperRail hash-lock simulations.");
  }
  if (offer.from === ownerDid) throw new Error("A second DID must accept this offer.");
  if (now >= offer.expiresMs) throw new Error("This offer has expired.");
  const { preimage, hash } = generateHashLock();
  const accept = makeAccept(offer, { from: ownerDid, statement: hash });
  const recovery: TclkRecovery = {
    schema: TCLK_RECOVERY_SCHEMA,
    warning: "PRIVATE RECOVERY FILE - DO NOT SHARE",
    protocol: "tclk/1",
    release: TCLK_RELEASE,
    owner_did: ownerDid,
    offer_id: offer.id,
    contract_id: accept.contract,
    statement: hash,
    preimage,
    created_at_utc: new Date(now).toISOString(),
  };
  return { accept, recovery, recoveryText: `${JSON.stringify(recovery, null, 2)}\n` };
}

export function parseTclkRecovery(text: string): TclkRecovery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The selected TCLK recovery file is not readable JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The TCLK recovery file is malformed.");
  const value = parsed as Record<string, unknown>;
  if (value.schema !== TCLK_RECOVERY_SCHEMA || value.warning !== "PRIVATE RECOVERY FILE - DO NOT SHARE" || value.protocol !== "tclk/1" || value.release !== TCLK_RELEASE) {
    throw new Error("The file is not a supported NEONCORE TCLK recovery backup.");
  }
  for (const key of ["owner_did", "offer_id", "contract_id", "statement", "preimage", "created_at_utc"] as const) {
    if (typeof value[key] !== "string" || !value[key]) throw new Error(`The recovery file is missing ${key}.`);
  }
  if (!verifyHashPreimage(String(value.statement), String(value.preimage))) {
    throw new Error("The private preimage does not open the saved statement.");
  }
  return value as TclkRecovery;
}

export function receiptForVerifiedState(state: ContractState, from: string): ReceiptFrame {
  if (state.status !== "claimed" && state.status !== "refunded" && state.status !== "cancelled") {
    throw new Error("A receipt can be created only after a verified terminal state.");
  }
  if (!state.contract) throw new Error("The verified state has no contract ID.");
  if (from !== state.payerDid && from !== state.payeeDid) throw new Error("Only a contract party can publish its receipt.");
  return validateFrame({
    type: "receipt",
    from,
    contract: state.contract,
    outcome: state.status,
    ...(state.rail ? { rail: state.rail } : {}),
    ...(state.railRef ? { ref: state.railRef } : {}),
  }) as ReceiptFrame;
}

export function tclkPublicExport(deal: TclkBoardDeal, audit: TclkAudit): string {
  return `${JSON.stringify({
    schema: TCLK_EXPORT_SCHEMA,
    protocol: "tclk/1",
    release: TCLK_RELEASE,
    exported_at_utc: new Date().toISOString(),
    offer_room: TCLK_OFFER_ROOM,
    deal_room: deal.room,
    contract_id: audit.state.contract,
    verified_status: audit.state.status,
    frames: audit.accepted.map(({ record }) => ({
      room: record.room,
      seq: record.seq,
      ts: new Date(record.timestampMs).toISOString(),
      transport_from: record.sender,
      nonce: record.nonce,
      signature: record.signature,
      text: record.line,
    })),
    rejected: audit.rejected,
    warning: "Public transcript only. PaperRail settles nothing and proves no payment.",
  }, null, 2)}\n`;
}

export function paperNoteAuthorizationText(input: {
  did: string;
  nonce: number;
  ns: string;
  key: string;
  value: string;
  condition?: PaperNoteCondition;
}): string {
  const condition = input.condition === undefined
    ? "none"
    : "ifAbsent" in input.condition
      ? "if_absent"
      : `if:${input.condition.if}`;
  return `neoncore-tclk-paper|${input.did}|${input.nonce}|${input.ns}|${input.key}|${input.value}|${condition}`;
}
