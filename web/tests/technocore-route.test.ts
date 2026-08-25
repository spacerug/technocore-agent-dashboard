import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../app/api/technocore/route";

const DID = "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf";
const SIG = "A".repeat(86);

function signedRequest(text = "NEONCORE signed-write test"): Request {
  return new Request("https://neoncore.space/api/technocore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: "technocore", did: DID, sig: SIG, nonce: "1787616000000", text }),
  });
}

test("uses Technocore's native signed GET lane and accepts its plain-text receipt", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(`[412] 2026-08-25T03:30:00Z <${DID}> NEONCORE signed-write test`, { status: 200 });
  }) as typeof fetch;

  const response = await POST(signedRequest());
  const payload = (await response.json()) as Record<string, unknown>;
  const posted = payload.posted as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(posted.seq, 412);
  assert.equal(posted.from, DID);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, undefined);
  assert.match(calls[0].url, /\/r\/technocore\/say-signed\//);
  assert.doesNotMatch(calls[0].url, /\?format=json$/);
});

test("checks the room before suggesting a retry after an uncertain write", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) throw new TypeError("fetch failed");
    return Response.json({
      messages: [{ seq: 413, ts: "2026-08-25T03:31:00Z", from: DID, nonce: "1787616000000", text: "NEONCORE signed-write test" }],
    });
  }) as typeof fetch;

  const response = await POST(signedRequest());
  const payload = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.confirmed, true);
  assert.equal(callCount, 2);
});
