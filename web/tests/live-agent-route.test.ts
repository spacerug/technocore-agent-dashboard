import assert from "node:assert/strict";
import test from "node:test";

import { loadIdentityJson, makeProof } from "../app/lib/browser-crypto";
import { finalizeAgentReply, POST } from "../app/api/live-agent/route";
import {
  DEFAULT_LIVE_AGENT_OWNER_DID,
  isAddressedToLiveAgent,
  isAuthorizedLiveAgentDid,
} from "../app/lib/live-agent-policy";

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

test("adds the NEONCORE website exactly once to every generated reply", () => {
  assert.equal(finalizeAgentReply("A strange new machine is humming."), "A strange new machine is humming. | neoncore.space");
  const deduplicated = finalizeAgentReply("Visit https://neoncore.space and neoncore.space for more.");
  assert.equal(deduplicated.match(/neoncore\.space/g)?.length, 1);
  assert.ok(deduplicated.length <= 600);
});
