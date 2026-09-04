import {
  canonicalJson,
  cleanText,
  prettyJson,
  sha256Bytes,
  validateRoom,
  verifyBytes,
} from "./browser-crypto";

export const TECHNOCORE_RECEIPT_SCHEMA = "neoncore/technocore-signed-message-receipt/v2";
export const TECHNOCORE_PROOF_MATERIAL_SCHEMA = "neoncore/technocore-signed-message-proof/v1";

export type SignedTechnocoreMessage = {
  room: string;
  nonce: number | string;
  text: string;
  did: string;
  sig: string;
};

export type TechnocoreObservation = {
  seq?: number;
  ts?: string;
  from?: string;
  nonce?: number | string;
  text?: string;
};

export type TechnocoreReceipt = {
  schema: typeof TECHNOCORE_RECEIPT_SCHEMA;
  confirmed: true;
  proof_id: string;
  proof_sha256: string;
  canonical_message_sha256: string;
  room: string;
  did: string;
  nonce: string;
  text: string;
  signature_base64url: string;
  posted: TechnocoreObservation;
  sequence_scope: "room_generation_only";
  sequence_note: string;
  detail: string;
  saved_at: string;
};

function isDid(value: unknown): value is string {
  return typeof value === "string" && /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isSignature(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{80,100}$/.test(value);
}

function normalizeNonce(value: number | string): string {
  const nonce = String(value);
  if (!/^\d{1,19}$/.test(nonce)) throw new Error("The signed message nonce is invalid.");
  return nonce;
}

function canonicalMessage(room: string, nonce: string, text: string): Uint8Array {
  return new TextEncoder().encode(`${room}|${nonce}|${text}`);
}

function proofMaterial(input: {
  room: string;
  did: string;
  nonce: string;
  text: string;
  signatureBase64url: string;
}): Record<string, unknown> {
  return {
    schema: TECHNOCORE_PROOF_MATERIAL_SCHEMA,
    room: input.room,
    did: input.did,
    nonce: input.nonce,
    text: input.text,
    signature_base64url: input.signatureBase64url,
  };
}

export async function createTechnocoreReceipt(input: {
  signed: SignedTechnocoreMessage;
  posted: TechnocoreObservation;
  detail: string;
  savedAt?: string;
}): Promise<TechnocoreReceipt> {
  const room = validateRoom(input.signed.room);
  const nonce = normalizeNonce(input.signed.nonce);
  const text = cleanText(input.signed.text);
  const did = input.signed.did.trim();
  const signature = input.signed.sig.trim();
  if (!isDid(did) || !isSignature(signature)) throw new Error("The signed message proof fields are invalid.");

  const messageBytes = canonicalMessage(room, nonce, text);
  if (!(await verifyBytes(did, signature, messageBytes))) {
    throw new Error("The signed message could not be verified before its receipt was created.");
  }

  const permanentHash = await sha256Bytes(canonicalJson(proofMaterial({
    room,
    did,
    nonce,
    text,
    signatureBase64url: signature,
  })));

  return {
    schema: TECHNOCORE_RECEIPT_SCHEMA,
    confirmed: true,
    proof_id: `ncmsg-${permanentHash}`,
    proof_sha256: permanentHash,
    canonical_message_sha256: await sha256Bytes(messageBytes),
    room,
    did,
    nonce,
    text,
    signature_base64url: signature,
    posted: {
      seq: input.posted.seq,
      ts: input.posted.ts,
      from: input.posted.from,
      nonce: input.posted.nonce,
      text: input.posted.text,
    },
    sequence_scope: "room_generation_only",
    sequence_note:
      "The sequence is only a location hint inside the current room generation. A reaped and recreated room can reuse the same sequence. Use proof_id and the signature for durable verification.",
    detail: input.detail,
    saved_at: input.savedAt ?? new Date().toISOString(),
  };
}

export async function verifyTechnocoreReceipt(text: string): Promise<TechnocoreReceipt> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The signed message receipt is not readable JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The signed message receipt is invalid.");
  }

  const receipt = parsed as Partial<TechnocoreReceipt>;
  if (receipt.schema !== TECHNOCORE_RECEIPT_SCHEMA) throw new Error("This receipt uses an unsupported schema.");
  const room = validateRoom(String(receipt.room ?? ""));
  const nonce = normalizeNonce(String(receipt.nonce ?? ""));
  const messageText = cleanText(String(receipt.text ?? ""));
  const did = String(receipt.did ?? "");
  const signature = String(receipt.signature_base64url ?? "");
  if (!isDid(did) || !isSignature(signature) || !isHash(receipt.proof_sha256) || !isHash(receipt.canonical_message_sha256)) {
    throw new Error("The signed message receipt proof fields are invalid.");
  }

  const messageBytes = canonicalMessage(room, nonce, messageText);
  const messageHash = await sha256Bytes(messageBytes);
  if (messageHash !== receipt.canonical_message_sha256) throw new Error("The signed message content hash does not match.");
  if (!(await verifyBytes(did, signature, messageBytes))) throw new Error("The signed message DID signature is invalid.");
  if (receipt.posted && typeof receipt.posted === "object") {
    if (receipt.posted.from !== undefined && receipt.posted.from !== did) throw new Error("The observed signer does not match the signed DID.");
    if (receipt.posted.nonce !== undefined && String(receipt.posted.nonce) !== nonce) throw new Error("The observed nonce does not match the signed message.");
    if (receipt.posted.text !== undefined && receipt.posted.text !== messageText) throw new Error("The observed text does not match the signed message.");
  }

  const permanentHash = await sha256Bytes(canonicalJson(proofMaterial({
    room,
    did,
    nonce,
    text: messageText,
    signatureBase64url: signature,
  })));
  if (receipt.proof_sha256 !== permanentHash || receipt.proof_id !== `ncmsg-${permanentHash}`) {
    throw new Error("The permanent proof ID does not match the signed payload.");
  }
  return receipt as TechnocoreReceipt;
}

export function technocoreReceiptText(receipt: TechnocoreReceipt): string {
  return prettyJson(receipt);
}

export function technocoreReceiptFilename(receipt: TechnocoreReceipt): string {
  return `technocore-proof-${receipt.proof_sha256.slice(0, 20)}.json`;
}
