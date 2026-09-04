import assert from "node:assert/strict";
import test from "node:test";

import { loadIdentityJson, signTechnocoreMessage } from "../app/lib/browser-crypto";
import {
  createTechnocoreReceipt,
  verifyTechnocoreReceipt,
} from "../app/lib/technocore-receipt";

const PRIVATE_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

test("creates a permanent signed message proof that does not depend on sequence", async () => {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const signed = await signTechnocoreMessage(identity, "technocore", 1787634000000, "Permanent proof test");
  const first = await createTechnocoreReceipt({
    signed,
    posted: { seq: 242, ts: "2026-08-25T05:07:22Z", from: identity.did, nonce: signed.nonce, text: signed.text },
    detail: "Confirmed",
    savedAt: "2026-08-25T05:07:23Z",
  });
  const recreatedRoom = await createTechnocoreReceipt({
    signed,
    posted: { seq: 1, ts: "2026-09-10T00:00:00Z", from: identity.did, nonce: signed.nonce, text: signed.text },
    detail: "Confirmed after room recreation",
    savedAt: "2026-09-10T00:00:01Z",
  });

  assert.equal(first.proof_id, recreatedRoom.proof_id);
  assert.equal(first.proof_sha256, recreatedRoom.proof_sha256);
  assert.notEqual(first.posted.seq, recreatedRoom.posted.seq);
  assert.match(first.proof_id, /^ncmsg-[0-9a-f]{64}$/);

  const verified = await verifyTechnocoreReceipt(JSON.stringify(first));
  assert.equal(verified.did, identity.did);
  assert.equal(verified.sequence_scope, "room_generation_only");
});

test("rejects a receipt whose signed text was changed", async () => {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: PRIVATE_KEY }), "identity.json");
  const signed = await signTechnocoreMessage(identity, "technocore", 1787634000001, "Original text");
  const receipt = await createTechnocoreReceipt({ signed, posted: { seq: 8 }, detail: "Confirmed" });
  const changed = { ...receipt, text: "Changed text" };

  await assert.rejects(() => verifyTechnocoreReceipt(JSON.stringify(changed)), /hash does not match|signature is invalid/i);
});
