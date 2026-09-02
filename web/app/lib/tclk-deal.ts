import {
  OFFER_ROOM,
  applyFrame,
  dealRoom,
  encodeFrame,
  generateHashLock,
  makeAccept,
  makeOffer,
  openContract,
  tryDecodeFrame,
  validateFrame,
  verifyHashPreimage,
  type AcceptFrame,
  type ContractState,
  type OfferFrame,
  type ReceiptFrame,
  type TclkFrame,
} from "@flop-labs/tclk";

export const TCLK_RELEASE = "0.1.0";
export const TCLK_OFFER_ROOM = OFFER_ROOM;
export const TCLK_SPEC_URL = "https://github.com/flop-labs/tclk/blob/main/SPEC.md";
export const TCLK_CHANGELOG_URL = "https://github.com/flop-labs/tclk/blob/main/CHANGELOG.md";
export const TCLK_RECOVERY_SCHEMA = "neoncore.tclk-recovery.v1";
export const TCLK_EXPORT_SCHEMA = "neoncore.tclk-public-transcript.v1";

export type TclkRoomMessage = {
  seq?: number;
  ts?: string;
  from?: string;
  nonce?: number | string;
  text?: string;
};

export type TclkPublicFrame = {
  frame: TclkFrame;
  message: TclkRoomMessage;
};

export type TclkBoardOffer = {
  frame: OfferFrame;
  message: TclkRoomMessage;
};

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

function messageTime(message: TclkRoomMessage, fallback: number): number {
  const parsed = typeof message.ts === "string" ? Date.parse(message.ts) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inspectSignedFrame(message: TclkRoomMessage):
  | { kind: "not-tclk" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; value: TclkPublicFrame } {
  if (typeof message.text !== "string" || !message.text.startsWith("tclk1 ")) return { kind: "not-tclk" };
  if (typeof message.from !== "string") return { kind: "invalid", reason: "TCLK frame is not from the signed DID lane." };
  const frame = tryDecodeFrame(message.text);
  if (!frame) return { kind: "invalid", reason: "Malformed or unsupported tclk/1 frame." };
  if (frame.from !== message.from) return { kind: "invalid", reason: "Frame sender does not match the transport-verified DID." };
  return { kind: "valid", value: { frame, message } };
}

export function scanTclkOfferBoard(messages: TclkRoomMessage[]): TclkBoardScan {
  const offers = new Map<string, TclkBoardOffer>();
  const accepts: Array<TclkPublicFrame & { frame: AcceptFrame }> = [];
  const rejected: TclkBoardScan["rejected"] = [];
  const ordered = [...messages].sort((left, right) => sequence(left) - sequence(right));

  for (const message of ordered) {
    const inspected = inspectSignedFrame(message);
    if (inspected.kind === "not-tclk") continue;
    if (inspected.kind === "invalid") {
      rejected.push({ seq: message.seq, reason: inspected.reason });
      continue;
    }
    if (inspected.value.frame.type === "offer") {
      offers.set(inspected.value.frame.id, { frame: inspected.value.frame, message });
    } else if (inspected.value.frame.type === "accept") {
      accepts.push(inspected.value as TclkPublicFrame & { frame: AcceptFrame });
    } else {
      rejected.push({ seq: message.seq, reason: `${inspected.value.frame.type} does not belong in the public offer room.` });
    }
  }

  const deals: TclkBoardDeal[] = [];
  for (const accept of accepts) {
    const offer = offers.get(accept.frame.ref);
    if (!offer) {
      rejected.push({ seq: accept.message.seq, reason: "Accept frame references an offer that is not available in this room window." });
      continue;
    }
    const step = applyFrame(openContract(offer.frame), accept.frame, messageTime(accept.message, Date.now()));
    if (!step.ok || !step.state.contract) {
      rejected.push({ seq: accept.message.seq, reason: step.reason ?? "Accept frame failed the TCLK state machine." });
      continue;
    }
    deals.push({ offer, accept, room: dealRoom(step.state.contract) });
  }

  return {
    offers: [...offers.values()].sort((left, right) => sequence(right.message) - sequence(left.message)),
    deals: deals.sort((left, right) => sequence(right.accept.message) - sequence(left.accept.message)),
    rejected,
  };
}

export function auditTclkDeal(deal: TclkBoardDeal, messages: TclkRoomMessage[], fallbackNow = Date.now()): TclkAudit {
  let state = openContract(deal.offer.frame);
  const accepted: TclkPublicFrame[] = [{ frame: deal.offer.frame, message: deal.offer.message }];
  const rejected: TclkAudit["rejected"] = [];
  const acceptStep = applyFrame(state, deal.accept.frame, messageTime(deal.accept.message, fallbackNow));
  if (!acceptStep.ok) throw new Error(acceptStep.reason ?? "The selected accept frame is invalid.");
  state = acceptStep.state;
  accepted.push(deal.accept);

  const ordered = [...messages].sort((left, right) => sequence(left) - sequence(right));
  for (const message of ordered) {
    const inspected = inspectSignedFrame(message);
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
    if (frame.contract !== state.contract) {
      rejected.push({ seq: message.seq, type: frame.type, reason: "Frame names a different contract." });
      continue;
    }
    if (frame.type === "receipt" && frame.outcome !== state.status) {
      rejected.push({
        seq: message.seq,
        type: frame.type,
        reason: `Receipt claims ${frame.outcome}, but the verified terminal state is ${state.status}.`,
      });
      continue;
    }
    const step = applyFrame(state, frame, messageTime(message, fallbackNow));
    if (!step.ok) {
      rejected.push({ seq: message.seq, type: frame.type, reason: step.reason ?? "Frame failed the TCLK state machine." });
      continue;
    }
    state = step.state;
    accepted.push(inspected.value);
  }

  return { state, accepted, rejected, room: deal.room };
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
  if (offer.lock !== "hash" || !offer.rails.includes("paper") || offer.asset !== "PAPER") {
    throw new Error("NEONCORE v2.9.0 accepts only TCLK PaperRail hash-lock simulations.");
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
    frames: audit.accepted.map(({ frame, message }) => ({
      room: frame.type === "offer" || frame.type === "accept" ? TCLK_OFFER_ROOM : deal.room,
      seq: message.seq,
      ts: message.ts,
      transport_from: message.from,
      nonce: message.nonce,
      text: encodeFrame(frame),
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

