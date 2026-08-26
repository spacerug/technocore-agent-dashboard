import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { POST } from "../app/api/technocore/route";
import { loadIdentityJson, signBytes } from "../app/lib/browser-crypto";

const DID = "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf";
const SIG = "A".repeat(86);
const NONCE = "1787616000000";
const MESSAGE = "NEONCORE signed-write test";
const PRIVATE_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function signedRequest(text = MESSAGE): Request {
  return new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: "technocore", did: DID, sig: SIG, nonce: NONCE, text }),
  });
}

function roomPayload(messages: Array<Record<string, unknown>>, lastSeq?: number): Response {
  return Response.json({ messages, ...(lastSeq === undefined ? {} : { last_seq: lastSeq }) });
}

test("uses the native signed lane and confirms by exact official room readback", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (calls.length === 1) return roomPayload([], 411);
    if (calls.length === 2) return new Response(`[412] 2026-08-25T03:30:00Z <${DID}> ${MESSAGE}`, { status: 200 });
    return roomPayload([{ seq: 412, ts: "2026-08-25T03:30:00Z", from: DID, nonce: NONCE, text: MESSAGE }], 412);
  }) as typeof fetch;

  const response = await POST(signedRequest());
  const payload = (await response.json()) as Record<string, unknown>;
  const posted = payload.posted as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.confirmed, true);
  assert.equal(posted.seq, 412);
  assert.equal(posted.from, DID);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/r\/technocore\?format=json&limit=1/);
  assert.match(calls[1].url, /\/r\/technocore\/say-signed\//);
  assert.equal(calls[1].init?.method, undefined);
  assert.match(calls[2].url, /since=411/);
});

test("checks the room before suggesting a retry after an uncertain write", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) return roomPayload([], 412);
    if (callCount === 2) throw new TypeError("fetch failed");
    return roomPayload([{ seq: 413, ts: "2026-08-25T03:31:00Z", from: DID, nonce: NONCE, text: MESSAGE }], 413);
  }) as typeof fetch;

  const response = await POST(signedRequest());
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.confirmed, true);
  assert.equal(callCount, 3);
});

test("does not confirm an acknowledged write that is absent from the room", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) return roomPayload([], 500);
    if (callCount === 2) return new Response(`[501] 2026-08-25T03:32:00Z <${DID}> ${MESSAGE}`, { status: 200 });
    return roomPayload([], 501);
  }) as typeof fetch;

  const response = await POST(signedRequest());
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 502);
  assert.equal(payload.ok, false);
  assert.equal(payload.confirmed, false);
  assert.match(String(payload.error), /could not confirm exact room inclusion/i);
  assert.equal(callCount, 6);
});

test("requires exact text as well as DID and nonce during readback", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) return roomPayload([], 600);
    if (callCount === 2) return new Response("OK", { status: 200 });
    return roomPayload([{ seq: 601, from: DID, nonce: NONCE, text: "Different text" }], 601);
  }) as typeof fetch;

  const response = await POST(signedRequest());
  assert.equal(response.status, 502);
  assert.equal(callCount, 6);
});

test("registers a signed public DID note in the current sharded path and reads it back", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const nonce = Date.now();
  const proof = new TextEncoder().encode(`neoncore-did-note|${identity.did}|${nonce}`);
  const sig = await signBytes(identity, proof);
  const fingerprint = createHash("sha256").update(identity.did).digest("hex").slice(0, 16);
  const expectedPath = `/kv/did-${fingerprint.slice(0, 2)}/${fingerprint.slice(2)}`;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return calls.length === 1 ? new Response("OK") : new Response(identity.did);
  }) as typeof fetch;

  const request = new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register_did", did: identity.did, nonce, sig }),
  });
  const response = await POST(request);
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.registered, true);
  assert.equal(payload.path, expectedPath);
  assert.match(calls[0], new RegExp(`${expectedPath}/set/`));
  assert.equal(calls[1], `https://technocore.chat${expectedPath}`);
});
