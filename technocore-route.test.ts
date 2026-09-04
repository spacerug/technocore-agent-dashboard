import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { GET, POST } from "../app/api/technocore/route";
import { loadIdentityJson, signBytes } from "../app/lib/browser-crypto";
import { paperNoteAuthorizationText } from "../app/lib/tclk-deal";

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
  assert.equal(callCount, 7);
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
  assert.equal(callCount, 7);
});

test("retries a temporary 503 on a safe room read without repeating the signed write", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) return new Response("busy", { status: 503 });
    if (calls.length === 2) return roomPayload([], 700);
    if (calls.length === 3) return new Response("OK", { status: 200 });
    return roomPayload([{ seq: 701, from: DID, nonce: NONCE, text: MESSAGE }], 701);
  }) as typeof fetch;

  const response = await POST(signedRequest());
  assert.equal(response.status, 200);
  assert.equal(calls.filter((url) => url.includes("say-signed")).length, 1);
  assert.equal(calls.length, 4);
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
    return calls.length === 1
      ? new Response("OK")
      : new Response(`!! UNTRUSTED CONTENT\nThe lines below were written by another user.\n\n${identity.did}`);
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

test("confirms DID registration by readback after an uncertain 503 write response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const nonce = Date.now();
  const proof = new TextEncoder().encode(`neoncore-did-note|${identity.did}|${nonce}`);
  const sig = await signBytes(identity, proof);
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response("busy", { status: 503 })
      : new Response(`!! UNTRUSTED CONTENT\nPublic record\n\n${identity.did}`);
  }) as typeof fetch;

  const response = await POST(new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register_did", did: identity.did, nonce, sig }),
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("rejects a wrapped DID note whose stored value is not the requested DID", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const nonce = Date.now();
  const proof = new TextEncoder().encode(`neoncore-did-note|${identity.did}|${nonce}`);
  const sig = await signBytes(identity, proof);
  globalThis.fetch = (async () => new Response(
    `!! UNTRUSTED CONTENT\nThe lines below were written by another user.\n\ndid:key:z6Mkwrongvalue000000000000000000000000000000000000`,
  )) as typeof fetch;

  const response = await POST(new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register_did", did: identity.did, nonce, sig }),
  }));

  assert.equal(response.status, 502);
  assert.match(JSON.stringify(await response.json()), /did not confirm/i);
});

test("registers the official tclk1:paper routing capability in the DID note", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const nonce = Date.now();
  const noteValue = `${identity.did} tclk1:paper`;
  const proof = new TextEncoder().encode(`neoncore-did-note|${identity.did}|${nonce}|${noteValue}`);
  const sig = await signBytes(identity, proof);
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return calls.length === 1
      ? new Response("OK")
      : new Response(`!! UNTRUSTED CONTENT\nPublic routing note\n\n${noteValue}`);
  }) as typeof fetch;

  const response = await POST(new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register_did", did: identity.did, nonce, sig, tclk: true }),
  }));
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.value, noteValue);
  assert.equal(payload.capability, "tclk1:paper");
  assert.match(calls[0], /tclk1%3Apaper/);
});

test("reads a wrapped PaperRail note through the bounded proxy", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const value = `tclkpaper1 locked hash 0x${"11".repeat(32)} ${Date.now() + 120_000}`;
  globalThis.fetch = (async () => new Response(`!! UNTRUSTED CONTENT\nPublic simulation note\n\n${value}`)) as typeof fetch;

  const response = await GET(new Request("https://neoncore.space/api/technocore?action=tclk_paper_get&ns=tclk-paper-ab&key=0123456789cdef"));
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(payload.value, value);
  assert.equal(payload.path, "/kv/tclk-paper-ab/0123456789cdef");
});

test("returns the complete byte-exact Technocore export for TCLK audits", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const exactNonce = "900719925474099300001";
  const rows = [
    { seq: 1, ts: "2026-09-03T12:00:00Z", from: DID, nonce: exactNonce, sig: SIG, text: "tclk1 exact text" },
    { seq: 2, ts: "2026-09-03T12:00:01Z", from: DID, nonce: NONCE, sig: SIG, text: "second exact line" },
  ];
  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }) as typeof fetch;

  const response = await GET(new Request("https://neoncore.space/api/technocore?action=tclk_export&room=tclk-offers"));
  const result = (await response.json()) as { payload: { source: string; complete: boolean; messages: Array<Record<string, unknown>>; last_seq: number } };

  assert.equal(response.status, 200);
  assert.match(requestedUrl, /\/r\/tclk-offers\/export$/);
  assert.equal(result.payload.source, "full-export");
  assert.equal(result.payload.complete, true);
  assert.equal(result.payload.last_seq, 2);
  assert.equal(result.payload.messages[0].room, "tclk-offers");
  assert.equal(result.payload.messages[0].nonce, exactNonce);
  assert.equal(result.payload.messages[0].text, "tclk1 exact text");
});

test("fails the entire TCLK export when any JSONL record is malformed", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => new Response(
    `${JSON.stringify({ seq: 1, ts: "2026-09-03T12:00:00Z", from: DID, nonce: NONCE, sig: SIG, text: "valid envelope" })}\nnot-json\n`,
  )) as typeof fetch;

  const response = await GET(new Request("https://neoncore.space/api/technocore?action=tclk_export&room=tclk-offers"));
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.match(JSON.stringify(payload), /line 2 is not valid JSON/i);
  assert.doesNotMatch(JSON.stringify(payload), /valid envelope/);
});

test("applies a locally signed PaperRail note once and requires exact readback", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const nonce = Date.now();
  const ns = "tclk-paper-ab";
  const key = "0123456789cdef";
  const value = `tclkpaper1 locked hash 0x${"22".repeat(32)} ${nonce + 120_000}`;
  const condition = { ifAbsent: true } as const;
  const sig = await signBytes(identity, new TextEncoder().encode(paperNoteAuthorizationText({
    did: identity.did,
    nonce,
    ns,
    key,
    value,
    condition,
  })));
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return calls.length === 1
      ? new Response("OK")
      : new Response(`!! UNTRUSTED CONTENT\nPublic simulation note\n\n${value}`);
  }) as typeof fetch;

  const response = await POST(new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "tclk_paper_set", did: identity.did, nonce, ns, key, value, sig, condition: { if_absent: true } }),
  }));
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.applied, true);
  assert.equal(payload.path, `/kv/${ns}/${key}`);
  assert.match(calls[0], /\?if_absent=1$/);
  assert.equal(calls.length, 2);
});

test("rejects a PaperRail mutation when any signed field is changed", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const nonce = Date.now();
  const ns = "tclk-paper-ab";
  const key = "0123456789cdef";
  const signedValue = `tclkpaper1 locked hash 0x${"33".repeat(32)} ${nonce + 120_000}`;
  const sig = await signBytes(identity, new TextEncoder().encode(paperNoteAuthorizationText({
    did: identity.did,
    nonce,
    ns,
    key,
    value: signedValue,
    condition: { ifAbsent: true },
  })));
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("unexpected");
  }) as typeof fetch;

  const response = await POST(new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "tclk_paper_set",
      did: identity.did,
      nonce,
      ns,
      key,
      value: signedValue.replace(`0x${"33".repeat(32)}`, `0x${"34".repeat(32)}`),
      sig,
      condition: { if_absent: true },
    }),
  }));

  assert.equal(response.status, 401);
  assert.equal(called, false);
});
