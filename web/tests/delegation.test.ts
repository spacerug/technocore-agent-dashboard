import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { loadIdentityJson } from "../app/lib/browser-crypto";
import {
  assessDelegation,
  createDelegation,
  didNotePath,
  encodeDelegation,
  parseDelegations,
  withoutAgentDelegations,
} from "../app/lib/delegation";

function seedHex(offset: number): string {
  return Array.from({ length: 32 }, (_, index) => ((index + offset) % 256).toString(16).padStart(2, "0")).join("");
}

async function identities() {
  const root = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(11) }), "root.json");
  const agent = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(77) }), "agent.json");
  return { root, agent };
}

test("creates and verifies an exact room-scoped delegation with a 19 digit nonce", async () => {
  const { root, agent } = await identities();
  const now = 2_000_000_000;
  const record = await createDelegation(root, agent.did, "r:lobby", String(now + 3_600), "9999999999999999999");
  const note = `${root.did} tclk1:paper ${encodeDelegation(record)}`;
  assert.deepEqual(parseDelegations(note), [record]);
  const result = await assessDelegation(root.did, agent.did, "r:lobby", note, now);
  assert.equal(result.authorized, true);
  assert.equal(result.reason, "active");
});

test("fails closed on scope mismatch and on the latest expired record", async () => {
  const { root, agent } = await identities();
  const now = 2_000_000_000;
  const active = await createDelegation(root, agent.did, "r:lobby", String(now + 3_600), "100");
  const expired = await createDelegation(root, agent.did, "r:lobby", String(now - 1), "101");
  assert.equal((await assessDelegation(root.did, agent.did, "r:other", encodeDelegation(active), now)).reason, "scope");
  const latestExpired = await assessDelegation(root.did, agent.did, "r:lobby", `${encodeDelegation(active)} ${encodeDelegation(expired)}`, now);
  assert.equal(latestExpired.authorized, false);
  assert.equal(latestExpired.reason, "expired");
});

test("ignores a forged higher nonce but rejects conflicting valid latest records", async () => {
  const { root, agent } = await identities();
  const now = 2_000_000_000;
  const active = await createDelegation(root, agent.did, "r:lobby", String(now + 3_600), "200");
  const forged = { ...active, nonce: "999", sig: active.sig };
  assert.equal((await assessDelegation(root.did, agent.did, "r:lobby", `${encodeDelegation(active)} ${encodeDelegation(forged)}`, now)).authorized, true);

  const sameNonceOtherScope = await createDelegation(root, agent.did, "r:other", String(now + 3_600), "200");
  const conflict = await assessDelegation(root.did, agent.did, "r:lobby", `${encodeDelegation(active)} ${encodeDelegation(sameNonceOtherScope)}`, now);
  assert.equal(conflict.authorized, false);
  assert.equal(conflict.reason, "conflict");
});

test("replaces only the selected agent record and derives the sharded note path", async () => {
  const { root, agent } = await identities();
  const other = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(119) }), "other.json");
  const first = await createDelegation(root, agent.did, "r:lobby", "2000003600", "1");
  const second = await createDelegation(root, other.did, "r:lobby", "2000003600", "2");
  const note = `${root.did} tclk1:paper ${encodeDelegation(first)} ${encodeDelegation(second)}`;
  const cleaned = withoutAgentDelegations(note, agent.did);
  assert.equal(parseDelegations(cleaned).length, 1);
  assert.equal(parseDelegations(cleaned)[0].agentDid, other.did);

  const fingerprint = createHash("sha256").update(root.did).digest("hex").slice(0, 16);
  assert.equal(await didNotePath(root.did), `/kv/did-${fingerprint.slice(0, 2)}/${fingerprint.slice(2)}`);
});
