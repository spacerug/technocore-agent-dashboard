import { scryptAsync } from "@noble/hashes/scrypt";
import {
  base64urlDecode,
  base64urlEncode,
  BrowserIdentity,
  bytesToHex,
  canonicalJson,
  cleanText,
  makeProof,
  prettyJson,
  sha256Bytes,
  verifySignedDocument,
} from "./browser-crypto";

export const PASSPORT_SCHEMA = "technocore-agent-dashboard/memory-passport/v1";
export const PUBLIC_CARD_SCHEMA = "technocore-agent-dashboard/memory-passport-public-card/v1";
const PRIVATE_SCHEMA = "technocore-agent-dashboard/memory-passport-private-memory/v1";
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export type PublicProfile = {
  agent_name: string;
  purpose: string;
  capabilities: string[];
  public_summary: string;
};

export type OpenedPassport = {
  sourceName: string;
  passportId: string;
  version: number;
  ownerDid: string;
  createdAt: string;
  updatedAt: string;
  previousPassportSha256: string | null;
  passportSha256: string;
  profile: PublicProfile;
  privateMemory: string;
};

export type MemoryPackage = {
  passport: Record<string, unknown>;
  publicCard: Record<string, unknown>;
  passportText: string;
  publicCardText: string;
  passportFilename: string;
  publicCardFilename: string;
  passportSha256: string;
  publicCardSha256: string;
  announcement: string;
  opened: OpenedPassport;
};

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeLine(value: string, label: string, maximum: number, required = true): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && !normalized) throw new Error(`Enter the agent's ${label}.`);
  if (normalized.length > maximum) throw new Error(`Keep ${label} under ${maximum.toLocaleString()} characters.`);
  return normalized;
}

function normalizeCapabilities(value: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : value.split(/[,\n]/);
  const capabilities: string[] = [];
  for (const entry of raw) {
    const normalized = entry.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    if (normalized.length > 80) throw new Error("Keep each public capability under 80 characters.");
    if (!capabilities.includes(normalized)) capabilities.push(normalized);
  }
  if (capabilities.length === 0) throw new Error("Enter at least one public capability.");
  if (capabilities.length > 24) throw new Error("Use no more than 24 public capabilities.");
  return capabilities;
}

function validatePassword(password: string): void {
  if (password.length < 12) throw new Error("Use a passport password with at least 12 characters.");
  if (password.length > 1024) throw new Error("The passport password is unexpectedly long.");
}

function aad(passportId: string, ownerDid: string, version: number): Uint8Array {
  return canonicalJson({ schema: PASSPORT_SCHEMA, passport_id: passportId, owner_did: ownerDid, version });
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const bytes = await scryptAsync(new TextEncoder().encode(password), salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: 32,
    asyncTick: 8,
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error(`The ${label} is unexpectedly large.`);
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`The selected ${label} is not readable JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`The ${label} structure is invalid.`);
  return value as Record<string, unknown>;
}

function parseProfile(value: unknown): PublicProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The public profile is missing.");
  const profile = value as Record<string, unknown>;
  if (
    typeof profile.agent_name !== "string" ||
    typeof profile.purpose !== "string" ||
    typeof profile.public_summary !== "string" ||
    !Array.isArray(profile.capabilities) ||
    !profile.capabilities.every((item) => typeof item === "string")
  ) {
    throw new Error("The public profile is invalid.");
  }
  return {
    agent_name: profile.agent_name,
    purpose: profile.purpose,
    capabilities: profile.capabilities,
    public_summary: profile.public_summary,
  };
}

export async function createMemoryPassport(input: {
  identity: BrowserIdentity;
  agentName: string;
  purpose: string;
  capabilities: string | string[];
  publicSummary: string;
  privateMemory: string;
  password: string;
  previous?: OpenedPassport | null;
}): Promise<MemoryPackage> {
  validatePassword(input.password);
  const profile: PublicProfile = {
    agent_name: normalizeLine(input.agentName, "name", 80),
    purpose: normalizeLine(input.purpose, "public purpose", 500),
    capabilities: normalizeCapabilities(input.capabilities),
    public_summary: normalizeLine(input.publicSummary, "public summary", 1500, false),
  };
  const privateMemory = input.privateMemory.trim();
  if (!privateMemory) throw new Error("Enter private memory for the agent to carry forward.");
  if (privateMemory.length > 100_000) throw new Error("Keep private memory under 100,000 characters.");

  if (input.previous && input.previous.ownerDid !== input.identity.did) {
    throw new Error("The loaded identity does not own this passport.");
  }
  const passportId = input.previous?.passportId ?? `mp-${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
  const version = (input.previous?.version ?? 0) + 1;
  const now = timestamp();
  const createdAt = input.previous?.createdAt ?? now;
  const previousSha = input.previous?.passportSha256 ?? null;

  const privatePayload = {
    schema: PRIVATE_SCHEMA,
    passport_id: passportId,
    version,
    owner_did: input.identity.did,
    private_memory: privateMemory,
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(input.password, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad(passportId, input.identity.did, version) as BufferSource },
      key,
      canonicalJson(privatePayload) as BufferSource,
    ),
  );

  const unsignedPassport: Record<string, unknown> = {
    schema: PASSPORT_SCHEMA,
    passport_id: passportId,
    version,
    owner_did: input.identity.did,
    created_at_utc: createdAt,
    updated_at_utc: now,
    previous_passport_sha256: previousSha,
    public_profile: profile,
    encryption: {
      algorithm: "AES-256-GCM",
      nonce_base64url: base64urlEncode(nonce),
      kdf: {
        name: "scrypt",
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        salt_base64url: base64urlEncode(salt),
      },
      ciphertext_base64url: base64urlEncode(ciphertext),
    },
    privacy_notice:
      "The public profile is readable. Private memory is password-encrypted. Do not publish this full passport unless you intentionally accept offline password-guessing risk; publish the separate public card instead.",
  };
  const passport = { ...unsignedPassport, proof: await makeProof(input.identity, unsignedPassport) };
  const passportText = prettyJson(passport);
  const passportSha256 = await sha256Bytes(new TextEncoder().encode(passportText));
  const passportFilename = `memory-passport-v${version}.neonpass.json`;

  const unsignedCard: Record<string, unknown> = {
    schema: PUBLIC_CARD_SCHEMA,
    passport_id: passportId,
    version,
    owner_did: input.identity.did,
    created_at_utc: createdAt,
    updated_at_utc: now,
    previous_passport_sha256: previousSha,
    private_passport_filename: passportFilename,
    private_passport_sha256: passportSha256,
    public_profile: profile,
    declaration:
      "This public card identifies a locally encrypted, DID-signed agent-memory checkpoint. It contains no private memory, password, private key, or ciphertext.",
  };
  const publicCard = { ...unsignedCard, proof: await makeProof(input.identity, unsignedCard) };
  const publicCardText = prettyJson(publicCard);
  const publicCardSha256 = await sha256Bytes(new TextEncoder().encode(publicCardText));
  const publicCardFilename = `memory-passport-public-v${version}.json`;
  const announcement = cleanText(
    `TECHNOCORE AGENT MEMORY PASSPORT | Passport: ${passportId} | Version: ${version} | Agent: ${profile.agent_name} | Owner DID: ${input.identity.did} | Private passport SHA-256: ${passportSha256} | Public card SHA-256: ${publicCardSha256} | Declaration: A portable agent-memory checkpoint was encrypted locally and signed by this DID. Only the public profile and fingerprints are announced. This is an independent Technocore contribution, not an official FLOP protocol record, token, payment, or promise of rewards.`,
  );

  const opened = await openMemoryPassport(passportText, passportFilename, input.password);
  return {
    passport,
    publicCard,
    passportText,
    publicCardText,
    passportFilename,
    publicCardFilename,
    passportSha256,
    publicCardSha256,
    announcement,
    opened,
  };
}

export async function openMemoryPassport(text: string, sourceName: string, password: string): Promise<OpenedPassport> {
  validatePassword(password);
  const document = parseJsonObject(text, "memory passport");
  await verifySignedDocument(document, PASSPORT_SCHEMA);
  const passportId = document.passport_id;
  const version = document.version;
  const ownerDid = document.owner_did;
  if (
    typeof passportId !== "string" ||
    !/^mp-[0-9a-f]{16}$/.test(passportId) ||
    !Number.isInteger(version) ||
    (version as number) < 1 ||
    typeof ownerDid !== "string"
  ) {
    throw new Error("The passport identity or version is invalid.");
  }
  const encryption = document.encryption as Record<string, unknown> | undefined;
  const kdf = encryption?.kdf as Record<string, unknown> | undefined;
  if (
    encryption?.algorithm !== "AES-256-GCM" ||
    kdf?.name !== "scrypt" ||
    kdf.n !== SCRYPT_N ||
    kdf.r !== SCRYPT_R ||
    kdf.p !== SCRYPT_P ||
    typeof kdf.salt_base64url !== "string" ||
    typeof encryption.nonce_base64url !== "string" ||
    typeof encryption.ciphertext_base64url !== "string"
  ) {
    throw new Error("The passport uses unsupported encryption settings.");
  }
  const salt = base64urlDecode(kdf.salt_base64url);
  const nonce = base64urlDecode(encryption.nonce_base64url);
  const ciphertext = base64urlDecode(encryption.ciphertext_base64url);
  if (salt.length !== 16 || nonce.length !== 12) throw new Error("The passport encryption data has an invalid size.");
  const key = await deriveKey(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad(passportId, ownerDid, version as number) as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    throw new Error("The passport password is incorrect, or its encrypted memory is damaged.");
  }
  const privatePayload = parseJsonObject(new TextDecoder().decode(plaintext), "decrypted memory");
  if (
    privatePayload.passport_id !== passportId ||
    privatePayload.owner_did !== ownerDid ||
    privatePayload.version !== version ||
    typeof privatePayload.private_memory !== "string"
  ) {
    throw new Error("The decrypted memory does not belong to this passport envelope.");
  }
  return {
    sourceName,
    passportId,
    version: version as number,
    ownerDid,
    createdAt: String(document.created_at_utc ?? ""),
    updatedAt: String(document.updated_at_utc ?? ""),
    previousPassportSha256:
      typeof document.previous_passport_sha256 === "string" ? document.previous_passport_sha256 : null,
    passportSha256: await sha256Bytes(new TextEncoder().encode(text)),
    profile: parseProfile(document.public_profile),
    privateMemory: privatePayload.private_memory,
  };
}

export async function verifyPublicCard(text: string): Promise<{
  document: Record<string, unknown>;
  sha256: string;
  profile: PublicProfile;
}> {
  const document = parseJsonObject(text, "public memory card");
  await verifySignedDocument(document, PUBLIC_CARD_SCHEMA);
  return {
    document,
    sha256: await sha256Bytes(new TextEncoder().encode(text)),
    profile: parseProfile(document.public_profile),
  };
}

export function handoffText(opened: OpenedPassport): string {
  return [
    "VERIFIED AGENT MEMORY HANDOFF",
    `Passport: ${opened.passportId} version ${opened.version}`,
    `Owner DID: ${opened.ownerDid}`,
    `Agent name: ${opened.profile.agent_name}`,
    `Purpose: ${opened.profile.purpose}`,
    `Public summary: ${opened.profile.public_summary || "(none)"}`,
    "Capabilities:",
    ...opened.profile.capabilities.map((item) => `- ${item}`),
    "",
    "PRIVATE MEMORY PROVIDED BY THE PASSPORT OWNER:",
    opened.privateMemory,
    "",
    `Passport SHA-256: ${opened.passportSha256}`,
    "Integrity note: the passport signature and encryption were verified locally. The written memories are owner-provided context, not independently proven facts.",
  ].join("\n");
}
