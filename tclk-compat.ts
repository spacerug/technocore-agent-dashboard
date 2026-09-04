import {
  applyFrame,
  encodeFrame,
  validateFrame,
  type ContractState,
  type TclkFrame,
} from "@flop-labs/tclk";
import { bytesToHex, verifyBytes } from "./browser-crypto";

const TCLK_PREFIX = "tclk1 ";
const MAX_FRAME_CHARS = 4096;
const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const CONTRACT_RE = /^0x[0-9a-f]{64}$/;
const FRAME_NONCE_RE = /^[0-9a-f]{8,64}$/;
const DECIMAL_NONCE_RE = /^(?:0|[1-9][0-9]*)$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const TIMESTAMP_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const CANONICAL_RAILS = new Set([
  "btc-htlc",
  "evm-htlc",
  "flop-htlc",
  "memory",
  "near-htlc",
  "paper",
  "x402",
]);

type RevealFrame = Extract<TclkFrame, { type: "reveal" }> & { ref?: string };
type RefundFrame = Extract<TclkFrame, { type: "refund" }> & { ref?: string };
type OtherFrame = Exclude<TclkFrame, { type: "reveal" } | { type: "refund" }>;

export type TclkHeartbeatFrame = {
  type: "heartbeat";
  from: string;
  contract: string;
  nonce: string;
  note?: string;
};

export type TclkCompatibleFrame = OtherFrame | RevealFrame | RefundFrame | TclkHeartbeatFrame;

export type TclkRoomMessage = {
  room?: string;
  seq?: number;
  ts?: string;
  from?: string;
  nonce?: number | string;
  sig?: string;
  text?: string;
};

export type TclkAuthenticatedRecord = {
  room: string;
  seq: number;
  timestampMs: number;
  sender: string;
  nonce: string;
  signature: string;
  line: string;
};

export type TclkCompatibilityStep = {
  state: ContractState;
  ok: boolean;
  reason?: string;
};

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function asciiJson(value: unknown): string {
  return JSON.stringify(sortJson(value)).replace(/[\u007f-\uffff]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function legacyCompatibleFrame(value: Record<string, unknown>): TclkCompatibleFrame | null {
  if ((value.type === "reveal" || value.type === "refund") && typeof value.ref === "string" && value.ref.length > 0) {
    const { ref, ...legacyValue } = value;
    try {
      const legacy = validateFrame(legacyValue);
      if (legacy.type !== value.type) return null;
      return { ...legacy, ref } as RevealFrame | RefundFrame;
    } catch {
      return null;
    }
  }
  try {
    return validateFrame(value) as TclkCompatibleFrame;
  } catch {
    return null;
  }
}

function heartbeatFrame(value: Record<string, unknown>): TclkHeartbeatFrame | null {
  if (!exactKeys(value, ["type", "from", "contract", "nonce"], ["note"])) return null;
  if (value.type !== "heartbeat" || typeof value.from !== "string" || typeof value.contract !== "string" || typeof value.nonce !== "string") return null;
  if (!CONTRACT_RE.test(value.contract) || !FRAME_NONCE_RE.test(value.nonce)) return null;
  if (value.note !== undefined && (typeof value.note !== "string" || value.note.length === 0)) return null;
  try {
    // Reuse the package's strict Ed25519 did:key validation through a harmless frame field.
    validateFrame({
      type: "cancel",
      from: value.from,
      contract: value.contract,
      reason: "heartbeat identity validation",
    });
  } catch {
    return null;
  }
  return value as TclkHeartbeatFrame;
}

export function decodeTclkCompatibleFrame(line: string): TclkCompatibleFrame | null {
  if (typeof line !== "string" || !line.startsWith(TCLK_PREFIX) || line.length > MAX_FRAME_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(TCLK_PREFIX.length));
  } catch {
    return null;
  }
  const record = object(value);
  if (!record || `${TCLK_PREFIX}${asciiJson(record)}` !== line) return null;
  return record.type === "heartbeat" ? heartbeatFrame(record) : legacyCompatibleFrame(record);
}

export function encodeTclkCompatibleFrame(frame: TclkCompatibleFrame): string {
  if (frame.type !== "heartbeat" && !((frame.type === "reveal" || frame.type === "refund") && frame.ref !== undefined)) {
    return encodeFrame(frame as TclkFrame);
  }
  const line = `${TCLK_PREFIX}${asciiJson(frame)}`;
  if (line.length > MAX_FRAME_CHARS || decodeTclkCompatibleFrame(line) === null) {
    throw new Error("The TCLK compatibility frame is malformed or exceeds the Technocore message limit.");
  }
  return line;
}

export function normalizeTclkRailId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("TCLK rail ID is empty.");
  const spelling = value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spelling)) throw new Error(`Malformed TCLK rail ID: ${value}`);
  const canonical = spelling === "paperrail" || spelling === "paper-rail" ? "paper" : spelling;
  if (!CANONICAL_RAILS.has(canonical)) throw new Error(`Unknown TCLK rail ID: ${value}`);
  return canonical;
}

export function tclkOfferIncludesRail(rails: readonly string[], selected: string): boolean {
  let target: string;
  try {
    target = normalizeTclkRailId(selected);
  } catch {
    return false;
  }
  return rails.some((rail) => {
    try {
      return normalizeTclkRailId(rail) === target;
    } catch {
      return false;
    }
  });
}

function decimalNonce(value: TclkRoomMessage["nonce"]): string | null {
  if (typeof value === "string") return DECIMAL_NONCE_RE.test(value) ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

export async function authenticateTclkRecord(room: string, message: TclkRoomMessage): Promise<TclkAuthenticatedRecord> {
  if (!ROOM_RE.test(room)) throw new Error("Record has an invalid room name.");
  if (message.room !== undefined && message.room !== room) throw new Error(`Record belongs to ${message.room}, not ${room}.`);
  if (!Number.isSafeInteger(message.seq) || Number(message.seq) < 0) throw new Error("Record sequence must be a non-negative safe integer.");
  if (typeof message.ts !== "string" || !TIMESTAMP_RE.test(message.ts)) throw new Error("Record timestamp must be timezone-qualified RFC 3339.");
  const timestampMs = Date.parse(message.ts);
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) throw new Error("Record timestamp is invalid.");
  if (typeof message.from !== "string") throw new Error("Record has no signed sender DID.");
  if (typeof message.text !== "string") throw new Error("Record has no exact message text.");
  const nonce = decimalNonce(message.nonce);
  if (nonce === null) throw new Error("Record nonce is missing or is not canonical decimal text.");
  if (typeof message.sig !== "string" || !SIGNATURE_RE.test(message.sig)) throw new Error("Record signature is missing or not canonical base64url.");
  const canonical = new TextEncoder().encode(`${room}|${nonce}|${message.text}`);
  let verified = false;
  try {
    verified = await verifyBytes(message.from, message.sig, canonical);
  } catch {
    verified = false;
  }
  if (!verified) throw new Error("Record DID signature does not verify.");
  return {
    room,
    seq: Number(message.seq),
    timestampMs,
    sender: message.from,
    nonce,
    signature: message.sig,
    line: message.text,
  };
}

export function makeTclkHeartbeat(from: string, contract: string, note?: string): TclkHeartbeatFrame {
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
  const frame: TclkHeartbeatFrame = {
    type: "heartbeat",
    from,
    contract,
    nonce,
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
  if (decodeTclkCompatibleFrame(encodeTclkCompatibleFrame(frame)) === null) throw new Error("Could not create a valid TCLK heartbeat.");
  return frame;
}

export function withTclkRailRef<T extends RevealFrame | RefundFrame>(frame: Omit<T, "ref">, ref: string): T {
  if (!ref) throw new Error("The verified TCLK lock has no rail reference.");
  return { ...frame, ref } as T;
}

function isParty(state: ContractState, did: string): boolean {
  return did === state.offer.from || did === state.payerDid || did === state.payeeDid;
}

function reject(state: ContractState, reason: string): TclkCompatibilityStep {
  return { state, ok: false, reason };
}

export function applyTclkCompatibleFrame(state: ContractState, frame: TclkCompatibleFrame, nowMs: number): TclkCompatibilityStep {
  if (!Number.isFinite(nowMs) || nowMs < 0) return reject(state, "TCLK record time must be finite and non-negative.");
  if (frame.type === "heartbeat") {
    if (state.status !== "accepted" && state.status !== "locked") return reject(state, `Heartbeat is not allowed in ${state.status} state.`);
    if (frame.contract !== state.contract) return reject(state, "Heartbeat names a different contract.");
    if (!isParty(state, frame.from)) return reject(state, "Heartbeat is not from a contract party.");
    return { state, ok: true };
  }
  if (frame.type === "lock") {
    if (nowMs >= state.offer.refundAfterMs) return reject(state, "Refund window is already open; a new lock is forbidden.");
    if (!tclkOfferIncludesRail(state.offer.rails, frame.rail)) return reject(state, `Rail ${frame.rail} was not offered.`);
  }
  if ((frame.type === "reveal" || frame.type === "refund") && frame.ref !== undefined && frame.ref !== state.railRef) {
    return reject(state, `${frame.type === "reveal" ? "Reveal" : "Refund"} names a different rail reference.`);
  }
  if (frame.type === "receipt") {
    if (frame.outcome !== state.status) return reject(state, `Receipt claims ${frame.outcome}, but the verified terminal state is ${state.status}.`);
    if (frame.rail !== undefined && state.rail !== undefined) {
      try {
        if (normalizeTclkRailId(frame.rail) !== normalizeTclkRailId(state.rail)) {
          return reject(state, `Receipt rail ${frame.rail} does not match contract rail ${state.rail}.`);
        }
      } catch {
        return reject(state, "Receipt contains an invalid or unsupported rail ID.");
      }
    }
    if (frame.ref !== undefined && state.railRef !== undefined && frame.ref !== state.railRef) return reject(state, "Receipt reference does not match the contract rail reference.");
    if (state.status === "cancelled" && (frame.rail !== undefined || frame.ref !== undefined)) return reject(state, "A cancelled contract receipt cannot name a settlement rail.");
  }

  let legacyFrame: TclkFrame = frame as TclkFrame;
  if ((frame.type === "reveal" || frame.type === "refund") && frame.ref !== undefined) {
    const withoutRef = { ...frame } as RevealFrame | RefundFrame;
    delete withoutRef.ref;
    legacyFrame = withoutRef as TclkFrame;
  }

  if (frame.type === "lock" && !state.offer.rails.includes(frame.rail)) {
    const patchedState = { ...state, offer: { ...state.offer, rails: [...state.offer.rails, frame.rail] } };
    const result = applyFrame(patchedState, legacyFrame, nowMs);
    return result.ok ? { ...result, state: { ...result.state, offer: state.offer } } : result;
  }
  return applyFrame(state, legacyFrame, nowMs);
}
