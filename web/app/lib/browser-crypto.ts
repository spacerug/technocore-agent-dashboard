export const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export type BrowserIdentity = {
  did: string;
  privateKey: CryptoKey;
  publicKey: Uint8Array;
  seed: Uint8Array;
  sourceName: string;
};

export type SignedProof = {
  type: "Ed25519";
  verification_method: string;
  canonicalization: string;
  signature_base64url: string;
};

const PKCS8_ED25519_PREFIX = hexToBytes("302e020100300506032b657004220420");

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error("The private-key hex is not valid.");
  }
  return new Uint8Array(normalized.match(/.{2}/g)!.map((item) => Number.parseInt(item, 16)));
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64urlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("The file contains unreadable base64 data.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let output = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    output = B58[remainder] + output;
    value /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return "1".repeat(leading) + (output || "1");
}

export function base58Decode(value: string): Uint8Array {
  if (!value) throw new Error("The DID is empty.");
  let number = 0n;
  for (const character of value) {
    const index = B58.indexOf(character);
    if (index < 0) throw new Error("The DID contains invalid base58 characters.");
    number = number * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 0xffn));
    number >>= 8n;
  }
  let leading = 0;
  while (leading < value.length && value[leading] === "1") leading += 1;
  return new Uint8Array([...new Array(leading).fill(0), ...bytes]);
}

export function didForPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("An Ed25519 public key must be 32 bytes.");
  return `did:key:z${base58Encode(concatBytes(ED25519_MULTICODEC, publicKey))}`;
}

export function publicKeyForDid(did: string): Uint8Array {
  if (!did.startsWith("did:key:z")) throw new Error("Only Ed25519 did:key identities are supported.");
  const decoded = base58Decode(did.slice("did:key:z".length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("Only Ed25519 did:key identities are supported.");
  }
  return decoded.slice(2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sortJson(value)));
}

export function prettyJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256File(file: File): Promise<string> {
  return sha256Bytes(new Uint8Array(await file.arrayBuffer()));
}

async function importPrivateSeed(seed: Uint8Array): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  if (seed.length !== 32) throw new Error("The Ed25519 private key must contain 32 bytes.");
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      concatBytes(PKCS8_ED25519_PREFIX, seed) as BufferSource,
      { name: "Ed25519" },
      true,
      ["sign"],
    );
  } catch {
    throw new Error("This browser does not support the Ed25519 security feature this app needs.");
  }
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  if (!jwk.x) throw new Error("The browser could not derive the identity's public key.");
  return { privateKey, publicKey: base64urlDecode(jwk.x) };
}

function collectDids(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string" && value.startsWith("did:key:z")) output.push(value.trim());
  else if (Array.isArray(value)) value.forEach((child) => collectDids(child, output));
  else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((child) => collectDids(child, output));
  }
  return [...new Set(output)];
}

function decodeSecret(value: unknown): Uint8Array | null {
  if (typeof value === "string") {
    const text = value.trim();
    const hex = text.replace(/^0x/i, "");
    if ((hex.length === 64 || hex.length === 128) && /^[0-9a-f]+$/i.test(hex)) {
      return hexToBytes(hex).slice(0, 32);
    }
    try {
      const raw = base64urlDecode(text);
      if (raw.length === 32 || raw.length === 64) return raw.slice(0, 32);
    } catch {
      // Continue looking for another supported key representation.
    }
  }
  if (
    Array.isArray(value) &&
    (value.length === 32 || value.length === 64) &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  ) {
    return new Uint8Array(value as number[]).slice(0, 32);
  }
  if (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).kty === "OKP" &&
    (value as Record<string, unknown>).crv === "Ed25519"
  ) {
    return decodeSecret((value as Record<string, unknown>).d);
  }
  return null;
}

function collectSecrets(
  value: unknown,
  output: Uint8Array[] = [],
  parentIsJwk = false,
): Uint8Array[] {
  if (value === null || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((child) => collectSecrets(child, output, false));
    return output;
  }
  const record = value as Record<string, unknown>;
  const isJwk = record.kty === "OKP" && record.crv === "Ed25519";
  for (const [key, child] of Object.entries(record)) {
    const normalized = key.toLowerCase().replace(/-/g, "_");
    const looksPrivate = ["private", "secret", "seed"].some((token) => normalized.includes(token));
    const isJwkPrivate = normalized === "d" && (isJwk || parentIsJwk);
    if (looksPrivate || isJwkPrivate) {
      const decoded = decodeSecret(child);
      if (decoded) output.push(decoded);
    }
    if (child !== null && typeof child === "object") collectSecrets(child, output, isJwk);
  }
  return output;
}

export async function loadIdentityJson(text: string, sourceName: string): Promise<BrowserIdentity> {
  let document: unknown;
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The selected identity file is not readable JSON.");
  }
  const expectedDids = collectDids(document);
  const candidates = collectSecrets(document);
  const unique = new Map(candidates.map((seed) => [bytesToHex(seed), seed]));
  const matches: BrowserIdentity[] = [];
  for (const seed of unique.values()) {
    const imported = await importPrivateSeed(seed);
    const did = didForPublicKey(imported.publicKey);
    if (expectedDids.length === 0 || expectedDids.includes(did)) {
      matches.push({ did, privateKey: imported.privateKey, publicKey: imported.publicKey, seed, sourceName });
    }
  }
  if (matches.length === 0) {
    throw new Error("No matching Ed25519 private key was found. Choose flop_agent_identity.json.");
  }
  if (matches.length > 1) throw new Error("This JSON contains more than one possible private key.");
  return matches[0];
}

export async function generateIdentity(): Promise<BrowserIdentity> {
  let keyPair: CryptoKeyPair;
  try {
    keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  } catch {
    throw new Error("This browser cannot generate Ed25519 identities. Use current Chrome or Edge.");
  }
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  if (!privateJwk.d) throw new Error("The browser did not return a usable private identity.");
  return {
    did: didForPublicKey(publicRaw),
    privateKey: keyPair.privateKey,
    publicKey: publicRaw,
    seed: base64urlDecode(privateJwk.d),
    sourceName: "new browser identity",
  };
}

export function identityJson(identity: BrowserIdentity): string {
  return prettyJson({ did: identity.did, private_key_hex: bytesToHex(identity.seed) });
}

export async function signBytes(identity: BrowserIdentity, bytes: Uint8Array): Promise<string> {
  const signature = await crypto.subtle.sign("Ed25519", identity.privateKey, bytes as BufferSource);
  return base64urlEncode(new Uint8Array(signature));
}

export async function verifyBytes(did: string, signature: string, bytes: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyForDid(did) as BufferSource,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    base64urlDecode(signature) as BufferSource,
    bytes as BufferSource,
  );
}

export async function makeProof(
  identity: BrowserIdentity,
  unsigned: Record<string, unknown>,
): Promise<SignedProof> {
  return {
    type: "Ed25519",
    verification_method: identity.did,
    canonicalization: "UTF-8 JSON; sorted keys; compact separators; proof omitted",
    signature_base64url: await signBytes(identity, canonicalJson(unsigned)),
  };
}

export async function verifySignedDocument(
  document: Record<string, unknown>,
  expectedSchema: string,
): Promise<void> {
  if (document.schema !== expectedSchema) throw new Error("This file uses an unsupported schema.");
  const ownerDid = document.owner_did ?? document.creator_did;
  const proof = document.proof as Record<string, unknown> | undefined;
  if (typeof ownerDid !== "string" || !proof || proof.verification_method !== ownerDid) {
    throw new Error("The file is missing its owner DID or signature proof.");
  }
  if (typeof proof.signature_base64url !== "string") throw new Error("The signature is unreadable.");
  const unsigned = { ...document };
  delete unsigned.proof;
  if (!(await verifyBytes(ownerDid, proof.signature_base64url, canonicalJson(unsigned)))) {
    throw new Error("The DID signature is invalid or the file was changed.");
  }
}

export function cleanText(value: string, maximum = 4096): string {
  const cleaned = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").trim();
  if (!cleaned) throw new Error("Enter at least one visible character.");
  if (cleaned.length > maximum) throw new Error(`Keep the message under ${maximum.toLocaleString()} characters.`);
  return cleaned;
}

export function validateRoom(value: string): string {
  const room = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) {
    throw new Error("Room names use lowercase letters, numbers, _ or - and must be 1–48 characters.");
  }
  return room;
}

export async function signTechnocoreMessage(
  identity: BrowserIdentity,
  roomValue: string,
  nonce: number,
  textValue: string,
): Promise<{ room: string; nonce: number; text: string; did: string; sig: string }> {
  const room = validateRoom(roomValue);
  const text = cleanText(textValue);
  if (!Number.isSafeInteger(nonce) || nonce <= 0) throw new Error("The message nonce is invalid.");
  const canonical = new TextEncoder().encode(`${room}|${nonce}|${text}`);
  const sig = await signBytes(identity, canonical);
  if (!(await verifyBytes(identity.did, sig, canonical))) throw new Error("Local signature verification failed.");
  return { room, nonce, text, did: identity.did, sig };
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function shortDid(did: string): string {
  return did.length > 30 ? `${did.slice(0, 19)}…${did.slice(-10)}` : did;
}
