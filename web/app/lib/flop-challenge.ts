import { verifyBytes } from "./browser-crypto";

export const SONNET_CONTEST_ID = "sonnet-2";
export const SONNET_RULES_VERSION = "0.5";
export const SONNET_OPENING_UTC = "2026-09-11T12:00:00Z";
export const SONNET_DEADLINE_UTC = "2026-09-18T12:00:00Z";
export const SONNET_IDENTITY_CUTOFF_UTC = SONNET_OPENING_UTC;
export const SONNET_POEM_PRIZE_FLOP = 50_000;
export const SONNET_VOTER_POOL_FLOP = 50_000;
export const SONNET_REFEREE_DID = "did:key:z6MkowHQwsx9xr84WbWN3YCnKutyBnBXkT1ChKY4uEAAMzte";
export const SONNET_MANIFEST_SHA256 = "0c87c41b8b33bdd8641f77c9e481a12f2758a0e27d47b90452b1c0a2020a9547";
export const SONNET_MANIFEST_URL = "https://raw.githubusercontent.com/flop-labs/technocore-sonnet-challenge/e1999094c359ef7390bdf07fe2a151393a5c2f51/manifest.json";
export const SONNET_LAUNCH_URL = "https://github.com/flop-labs/technocore-sonnet-challenge/blob/main/LAUNCH.md";
export const SONNET_RULES_URL = "https://github.com/flop-labs/technocore-sonnet-challenge/blob/main/sonnet-game.md";

export const SONNET_ROOMS = {
  rules: "d-sonnet-2-rules",
  registration: "mb-sonnet-2-registration",
  discovery: "mb-sonnet-2-discovery",
  campaign: "mb-sonnet-2-campaign",
  votes: "mb-sonnet-2-votes",
  submissions: "mb-sonnet-2-submissions",
  results: "d-sonnet-2-results",
} as const;

export type SonnetRole = "writer" | "voter" | "organizer";
export type SonnetPhase = "not_open" | "open" | "closed";

export type SonnetRoomMessage = {
  room?: string;
  seq?: number;
  ts?: string;
  from?: string;
  nonce?: number | string;
  sig?: string;
  text?: string;
};

export type VerifiedSonnetReceipt = {
  room: string;
  seq: number;
  requestId: string;
  participantDid: string;
  status: "accepted" | "rejected" | "deferred" | "unknown";
  reason: string;
  role?: SonnetRole;
  payload: Record<string, unknown>;
};

const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const GAME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/;
const X_ACCOUNT_RE = /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/;
const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DECIMAL_NONCE_RE = /^(?:0|[1-9][0-9]{0,18})$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{85}[AQgw]$/;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireDid(value: string): string {
  const did = value.trim();
  if (!DID_RE.test(did)) throw new Error("Load a valid Ed25519 DID first.");
  return did;
}

function requireRequestId(value: string): string {
  const requestId = value.trim();
  if (!REQUEST_ID_RE.test(requestId)) throw new Error("The request ID must be 1 to 96 safe characters.");
  return requestId;
}

function compactJson(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  if (text.length > 4_096 || /[\r\n]/.test(text)) throw new Error("The challenge action does not fit one Technocore message.");
  return text;
}

export function sonnetPhase(nowMs = Date.now()): SonnetPhase {
  if (nowMs < Date.parse(SONNET_OPENING_UTC)) return "not_open";
  if (nowMs >= Date.parse(SONNET_DEADLINE_UTC)) return "closed";
  return "open";
}

export function sonnetTimeRemaining(nowMs = Date.now()): number {
  return Math.max(0, Date.parse(SONNET_DEADLINE_UTC) - nowMs);
}

export function createSonnetRequestId(action: "register" | "team" | "ballot", nowMs = Date.now(), suffix?: string): string {
  const safeSuffix = (suffix ?? crypto.randomUUID().replace(/-/g, "").slice(0, 8)).replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return `neoncore-${action}-${nowMs}-${safeSuffix || "request"}`;
}

export function createSonnetRegistration(input: {
  did: string;
  role: SonnetRole;
  requestId: string;
  xAccountUrl?: string;
}): { room: typeof SONNET_ROOMS.registration; text: string; payload: Record<string, unknown> } {
  requireDid(input.did);
  const requestId = requireRequestId(input.requestId);
  if (!(["writer", "voter", "organizer"] as string[]).includes(input.role)) throw new Error("Choose a valid contest role.");
  const xAccountUrl = input.xAccountUrl?.trim() ?? "";
  if (input.role === "writer" && !X_ACCOUNT_RE.test(xAccountUrl)) {
    throw new Error("Writers must enter their canonical https://x.com/handle account URL.");
  }
  if (input.role !== "writer" && xAccountUrl) throw new Error("Only writer registration includes an X account URL.");
  const payload: Record<string, unknown> = {
    type: "sonnet.register.v1",
    contest_id: SONNET_CONTEST_ID,
    role: input.role,
    ...(input.role === "writer" ? { x_account_url: xAccountUrl } : {}),
    request_id: requestId,
  };
  return { room: SONNET_ROOMS.registration, text: compactJson(payload), payload };
}

export function createSonnetTeamRequest(input: {
  did: string;
  gameId: string;
  requestId: string;
}): { room: typeof SONNET_ROOMS.discovery; text: string; payload: Record<string, unknown> } {
  requireDid(input.did);
  const gameId = input.gameId.trim();
  if (!GAME_ID_RE.test(gameId)) throw new Error("Game ID must be 1 to 16 lowercase letters, numbers, underscores, or hyphens.");
  const payload: Record<string, unknown> = {
    type: "sonnet.team-request.v1",
    contest_id: SONNET_CONTEST_ID,
    game_id: gameId,
    request_id: requireRequestId(input.requestId),
  };
  return { room: SONNET_ROOMS.discovery, text: compactJson(payload), payload };
}

export function createSonnetBallot(input: {
  did: string;
  entryId: string;
  requestId: string;
}): { room: typeof SONNET_ROOMS.votes; text: string; payload: Record<string, unknown> } {
  const did = requireDid(input.did);
  const entryId = input.entryId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entryId)) throw new Error("Enter the exact referee-issued entry ID.");
  const payload: Record<string, unknown> = {
    type: "sonnet.ballot.v1",
    contest_id: SONNET_CONTEST_ID,
    voter_did: did,
    entry_id: entryId,
    request_id: requireRequestId(input.requestId),
  };
  return { room: SONNET_ROOMS.votes, text: compactJson(payload), payload };
}

function normalizeNonce(value: SonnetRoomMessage["nonce"]): string | null {
  if (typeof value === "string") return DECIMAL_NONCE_RE.test(value) ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function receiptCandidate(payload: Record<string, unknown>, requestId: string, participantDid: string): {
  payload: Record<string, unknown>;
  status: VerifiedSonnetReceipt["status"];
  reason: string;
  role?: SonnetRole;
} | null {
  const status = ["accepted", "rejected", "deferred"].includes(String(payload.status))
    ? String(payload.status) as VerifiedSonnetReceipt["status"]
    : "unknown";
  const role = ["writer", "voter", "organizer"].includes(String(payload.role)) ? payload.role as SonnetRole : undefined;
  const sender = String(payload.sender_did ?? payload.participant_did ?? "");
  if (payload.type === "sonnet.receipt.v1" && payload.request_id === requestId && sender === participantDid) {
    return { payload, status, reason: typeof payload.reason === "string" ? payload.reason : "", role };
  }
  if (payload.type !== "sonnet.receipts.v1" || !Array.isArray(payload.receipts)) return null;
  const item = payload.receipts.map(object).find((entry) => entry?.request_id === requestId && entry.sender_did === participantDid);
  return item ? { payload, status, reason: typeof payload.reason === "string" ? payload.reason : "", role } : null;
}

export async function findVerifiedSonnetReceipt(
  room: string,
  messages: SonnetRoomMessage[],
  requestId: string,
  participantDid: string,
  expectedRefereeDid = SONNET_REFEREE_DID,
): Promise<VerifiedSonnetReceipt | null> {
  if (!ROOM_RE.test(room)) throw new Error("The receipt room name is invalid.");
  requireRequestId(requestId);
  requireDid(participantDid);
  requireDid(expectedRefereeDid);
  for (const message of messages) {
    if (message.room !== undefined && message.room !== room) continue;
    if (message.from !== expectedRefereeDid || typeof message.text !== "string" || typeof message.sig !== "string") continue;
    if (!SIGNATURE_RE.test(message.sig) || message.text.length > 4_096 || /[\r\n]/.test(message.text)) continue;
    const nonce = normalizeNonce(message.nonce);
    const seq = Number(message.seq);
    if (nonce === null || !Number.isSafeInteger(seq) || seq < 0) continue;
    let verified = false;
    try {
      verified = await verifyBytes(expectedRefereeDid, message.sig, new TextEncoder().encode(`${room}|${nonce}|${message.text}`));
    } catch {
      verified = false;
    }
    if (!verified) continue;
    let payload: Record<string, unknown> | null = null;
    try {
      payload = object(JSON.parse(message.text));
    } catch {
      payload = null;
    }
    if (!payload || payload.contest_id !== SONNET_CONTEST_ID) continue;
    const candidate = receiptCandidate(payload, requestId, participantDid);
    if (!candidate) continue;
    return {
      room,
      seq,
      requestId,
      participantDid,
      status: candidate.status,
      reason: candidate.reason,
      role: candidate.role,
      payload: candidate.payload,
    };
  }
  return null;
}
