import assert from "node:assert/strict";
import test from "node:test";

import { loadIdentityJson, makeProof } from "../app/lib/browser-crypto";
import { extractDevelopmentUsage, finalizeAgentReply, POST } from "../app/api/live-agent/route";
import {
  DEFAULT_LIVE_AGENT_OWNER_DID,
  isAddressedToLiveAgent,
  isAuthorizedLiveAgentDid,
} from "../app/lib/live-agent-policy";
import {
  addLiveAgentTranscriptEntry,
  liveAgentTranscriptKey,
  parseLiveAgentTranscript,
} from "../app/lib/live-agent-transcript";

function seedHex(offset: number): string {
  return Array.from({ length: 32 }, (_, index) => ((index + offset) % 256).toString(16).padStart(2, "0")).join("");
}

async function signedRequest(triggerText = "NEONCORE, hello") {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(17) }), "agent-test.json");
  const created = new Date();
  const unsigned: Record<string, unknown> = {
    schema: "neoncore/live-agent-request/v1",
    owner_did: identity.did,
    created_at_utc: created.toISOString(),
    expires_at_utc: new Date(created.getTime() + 60_000).toISOString(),
    request_nonce: crypto.randomUUID(),
    room: "lobby",
    persona: "A concise test agent.",
    recent_messages: [{ from: identity.did, text: "Context" }],
    trigger_message: { from: "did:key:z6MkuVbNjTiAp7uC7RywMDkBAvXsZ57FXK8tzXvyRrv4BYpM", text: triggerText },
  };
  return { identity, body: { ...unsigned, proof: await makeProof(identity, unsigned) } };
}

test("rejects an unauthorized Live Agent DID before using the private relay", async () => {
  const { body } = await signedRequest();
  const response = await POST(new Request("https://neoncore.space/api/live-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 403);
});

test("verifies the owner DID signature before checking model configuration", async () => {
  const { identity, body } = await signedRequest();
  const previousOwner = process.env.LIVE_AGENT_OWNER_DID;
  const previousModelKey = process.env.MODEL_API_KEY;
  process.env.LIVE_AGENT_OWNER_DID = identity.did;
  delete process.env.MODEL_API_KEY;
  try {
    const response = await POST(new Request("https://neoncore.space/api/live-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 503);
  } finally {
    if (previousOwner === undefined) delete process.env.LIVE_AGENT_OWNER_DID;
    else process.env.LIVE_AGENT_OWNER_DID = previousOwner;
    if (previousModelKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = previousModelKey;
  }
});

test("rejects a Live Agent request changed after signing", async () => {
  const { identity, body } = await signedRequest();
  const previousOwner = process.env.LIVE_AGENT_OWNER_DID;
  process.env.LIVE_AGENT_OWNER_DID = identity.did;
  try {
    body.persona = "Changed after signing";
    const response = await POST(new Request("https://neoncore.space/api/live-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 401);
  } finally {
    if (previousOwner === undefined) delete process.env.LIVE_AGENT_OWNER_DID;
    else process.env.LIVE_AGENT_OWNER_DID = previousOwner;
  }
});

test("locks Live Agent control to the configured owner DID", () => {
  assert.equal(isAuthorizedLiveAgentDid(DEFAULT_LIVE_AGENT_OWNER_DID), true);
  assert.equal(isAuthorizedLiveAgentDid("did:key:z6MkuVbNjTiAp7uC7RywMDkBAvXsZ57FXK8tzXvyRrv4BYpM"), false);
});

test("triggers only when a message addresses NEONCORE or its owner DID", () => {
  assert.equal(isAddressedToLiveAgent("NEONCORE, what are you building?"), true);
  assert.equal(isAddressedToLiveAgent("Visit neoncore.space and report back"), true);
  assert.equal(isAddressedToLiveAgent(`Hello ${DEFAULT_LIVE_AGENT_OWNER_DID}`), true);
  assert.equal(isAddressedToLiveAgent("What is everyone doing today?"), false);
});

test("rejects unrelated signed room chatter before using the model relay", async () => {
  const { identity, body } = await signedRequest("What is everyone doing today?");
  const previousOwner = process.env.LIVE_AGENT_OWNER_DID;
  const previousModelKey = process.env.MODEL_API_KEY;
  process.env.LIVE_AGENT_OWNER_DID = identity.did;
  delete process.env.MODEL_API_KEY;
  try {
    const response = await POST(new Request("https://neoncore.space/api/live-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
  } finally {
    if (previousOwner === undefined) delete process.env.LIVE_AGENT_OWNER_DID;
    else process.env.LIVE_AGENT_OWNER_DID = previousOwner;
    if (previousModelKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = previousModelKey;
  }
});

test("stores a bounded public transcript with the question, response, and proof", () => {
  const entry = {
    id: "ncmsg-proof-one",
    room: "lobby",
    sender_did: "did:key:z6MkuVbNjTiAp7uC7RywMDkBAvXsZ57FXK8tzXvyRrv4BYpM",
    incoming_text: "NEONCORE, what are you building?",
    reply_text: "A machine for verifiable agent experiments. | neoncore.space",
    asked_at: "2026-08-25T17:30:00.000Z",
    responded_at: "2026-08-25T17:30:05.000Z",
    proof_id: "ncmsg-proof-one",
    room_sequence: 42,
  };
  const stored = addLiveAgentTranscriptEntry([], entry);
  const restored = parseLiveAgentTranscript(JSON.stringify(stored));
  assert.deepEqual(restored, [entry]);
  assert.match(liveAgentTranscriptKey(DEFAULT_LIVE_AGENT_OWNER_DID, "lobby"), /:lobby$/);
});

test("rejects malformed local transcript data and deduplicates proof IDs", () => {
  assert.deepEqual(parseLiveAgentTranscript("not json"), []);
  assert.deepEqual(parseLiveAgentTranscript(JSON.stringify([{ incoming_text: "missing proof" }])), []);
  const first = {
    id: "ncmsg-same",
    room: "lobby",
    sender_did: DEFAULT_LIVE_AGENT_OWNER_DID,
    incoming_text: "NEONCORE, first",
    reply_text: "First reply",
    asked_at: "2026-08-25T17:30:00.000Z",
    responded_at: "2026-08-25T17:30:05.000Z",
    proof_id: "ncmsg-same",
  };
  const replacement = { ...first, incoming_text: "NEONCORE, corrected" };
  assert.deepEqual(addLiveAgentTranscriptEntry([first], replacement), [replacement]);
});

test("adds the NEONCORE website exactly once to every generated reply", () => {
  assert.equal(finalizeAgentReply("A strange new machine is humming."), "A strange new machine is humming. | neoncore.space");
  const deduplicated = finalizeAgentReply("Visit https://neoncore.space and neoncore.space for more.");
  assert.equal(deduplicated.match(/neoncore\.space/g)?.length, 1);
  assert.ok(deduplicated.length <= 600);
});

test("extracts bounded provider usage as off-network development activity", () => {
  assert.deepEqual(extractDevelopmentUsage({
    model: "development-model",
    usage: { input_tokens: 125, output_tokens: 25, total_tokens: 150 },
  }, "fallback-model"), {
    model: "development-model",
    input_tokens: 125,
    output_tokens: 25,
    total_tokens: 150,
    scope: "off_network_development",
  });
  assert.equal(extractDevelopmentUsage({ usage: { input_tokens: -1 } }, "fallback-model").total_tokens, 0);
});

test("regenerates one generic draft and returns the specific replacement", async (t) => {
  const { identity, body } = await signedRequest("NEONCORE, how does Proof Lab verify useful work?");
  const previousOwner = process.env.LIVE_AGENT_OWNER_DID;
  const previousModelKey = process.env.MODEL_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.LIVE_AGENT_OWNER_DID = identity.did;
  process.env.MODEL_API_KEY = "test-only-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const generated = calls === 1
      ? "Interesting. What is your view on adoption?"
      : "Proof Lab verifies useful work by binding requester, worker, and validator signatures into one portable receipt.";
    return Response.json({
      model: "quality-test-model",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      output: [{ content: [{ text: generated }] }],
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousOwner === undefined) delete process.env.LIVE_AGENT_OWNER_DID;
    else process.env.LIVE_AGENT_OWNER_DID = previousOwner;
    if (previousModelKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = previousModelKey;
  });

  const response = await POST(new Request("https://neoncore.space/api/live-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  const payload = await response.json() as Record<string, unknown>;
  const usage = payload.usage as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(payload.attempts, 2);
  assert.match(String(payload.reply), /Proof Lab verifies useful work/);
  assert.equal(usage.total_tokens, 30);
  assert.equal(calls, 2);
});

test("withholds a reply when both bounded drafts fail the quality gate", async (t) => {
  const { identity, body } = await signedRequest("NEONCORE, explain validator signatures in Proof Lab.");
  const previousOwner = process.env.LIVE_AGENT_OWNER_DID;
  const previousModelKey = process.env.MODEL_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.LIVE_AGENT_OWNER_DID = identity.did;
  process.env.MODEL_API_KEY = "test-only-key";
  globalThis.fetch = (async () => Response.json({
    model: "quality-test-model",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    output: [{ content: [{ text: "Good perspective. How does this scale long term?" }] }],
  })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousOwner === undefined) delete process.env.LIVE_AGENT_OWNER_DID;
    else process.env.LIVE_AGENT_OWNER_DID = previousOwner;
    if (previousModelKey === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = previousModelKey;
  });

  const response = await POST(new Request("https://neoncore.space/api/live-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 422);
  assert.equal(payload.quality_rejected, true);
  assert.match(String(payload.error), /withheld/i);
});
