import { BrowserIdentity, signBytes, verifyBytes } from "./browser-crypto";

export const DELEGATION_TOKEN = "delegate:";
export const DELEGATION_SCOPE_RE = /^(?:\*|r:[a-z0-9][a-z0-9_-]{0,47}|kv:[a-z0-9][a-z0-9_-]{0,47})$/;

const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;
const NONCE_RE = /^\d{1,19}$/;
const SIG_RE = /^[A-Za-z0-9_-]{80,100}$/;

export type DelegationRecord = {
  agentDid: string;
  scope: string;
  expires: string;
  nonce: string;
  sig: string;
};

export type DelegationAssessment = {
  authorized: boolean;
  reason: "active" | "missing" | "invalid" | "expired" | "scope" | "conflict";
  record?: DelegationRecord;
};

export function delegationCanonicalText(
  rootDid: string,
  agentDid: string,
  scope: string,
  expires: string,
  nonce: string,
): string {
  return `delegate|${rootDid}|${agentDid}|${scope}|${expires}|${nonce}`;
}

function recordShapeValid(record: DelegationRecord): boolean {
  return DID_RE.test(record.agentDid)
    && DELEGATION_SCOPE_RE.test(record.scope)
    && NONCE_RE.test(record.expires)
    && NONCE_RE.test(record.nonce)
    && SIG_RE.test(record.sig);
}

export function encodeDelegation(record: DelegationRecord): string {
  if (!recordShapeValid(record)) throw new Error("The delegation record is invalid.");
  return `${DELEGATION_TOKEN} ${record.agentDid} ${record.scope} ${record.expires} ${record.nonce} ${record.sig}`;
}

export function parseDelegations(note: string | null | undefined): DelegationRecord[] {
  if (!note) return [];
  const tokens = note.trim().split(/\s+/);
  const records: DelegationRecord[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== DELEGATION_TOKEN || index + 5 >= tokens.length) continue;
    const record: DelegationRecord = {
      agentDid: tokens[index + 1],
      scope: tokens[index + 2],
      expires: tokens[index + 3],
      nonce: tokens[index + 4],
      sig: tokens[index + 5],
    };
    if (recordShapeValid(record)) records.push(record);
    index += 5;
  }
  return records;
}

export function withoutAgentDelegations(note: string | null | undefined, agentDid: string): string {
  if (!note) return "";
  const tokens = note.trim().split(/\s+/);
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === DELEGATION_TOKEN && index + 5 < tokens.length) {
      const candidateAgent = tokens[index + 1];
      if (candidateAgent === agentDid) {
        index += 5;
        continue;
      }
    }
    kept.push(tokens[index]);
  }
  return kept.join(" ").trim();
}

export async function createDelegation(
  rootIdentity: BrowserIdentity,
  agentDid: string,
  scope: string,
  expires: string,
  nonce: string,
): Promise<DelegationRecord> {
  const unsigned = { agentDid: agentDid.trim(), scope: scope.trim(), expires, nonce };
  const draft: DelegationRecord = { ...unsigned, sig: "A".repeat(86) };
  if (!recordShapeValid(draft)) throw new Error("Use a valid agent DID, scope, expiration, and 1 to 19 digit nonce.");
  if (unsigned.agentDid === rootIdentity.did) throw new Error("The owner DID cannot delegate to itself.");
  const canonical = delegationCanonicalText(rootIdentity.did, unsigned.agentDid, unsigned.scope, unsigned.expires, unsigned.nonce);
  return { ...unsigned, sig: await signBytes(rootIdentity, new TextEncoder().encode(canonical)) };
}

async function signatureValid(rootDid: string, record: DelegationRecord): Promise<boolean> {
  if (!DID_RE.test(rootDid) || !recordShapeValid(record)) return false;
  try {
    return await verifyBytes(
      rootDid,
      record.sig,
      new TextEncoder().encode(delegationCanonicalText(rootDid, record.agentDid, record.scope, record.expires, record.nonce)),
    );
  } catch {
    return false;
  }
}

export async function assessDelegation(
  rootDid: string,
  agentDid: string,
  requiredScope: string,
  note: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<DelegationAssessment> {
  const candidates = parseDelegations(note).filter((record) => record.agentDid === agentDid);
  if (candidates.length === 0) return { authorized: false, reason: "missing" };

  const valid: DelegationRecord[] = [];
  for (const record of candidates) if (await signatureValid(rootDid, record)) valid.push(record);
  if (valid.length === 0) return { authorized: false, reason: "invalid" };

  const highestNonce = valid.reduce((highest, record) => BigInt(record.nonce) > highest ? BigInt(record.nonce) : highest, -1n);
  const latest = valid.filter((record) => BigInt(record.nonce) === highestNonce);
  const uniqueLatest = new Map(latest.map((record) => [encodeDelegation(record), record]));
  if (uniqueLatest.size !== 1) return { authorized: false, reason: "conflict" };
  const record = [...uniqueLatest.values()][0];
  if (BigInt(record.expires) <= BigInt(nowSeconds)) return { authorized: false, reason: "expired", record };
  if (record.scope !== "*" && record.scope !== requiredScope) return { authorized: false, reason: "scope", record };
  return { authorized: true, reason: "active", record };
}

export async function didNotePath(did: string): Promise<string> {
  if (!DID_RE.test(did)) throw new Error("The DID is invalid.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(did));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `/kv/did-${fingerprint.slice(0, 2)}/${fingerprint.slice(2)}`;
}
