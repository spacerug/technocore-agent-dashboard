import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReplyQuality } from "../app/lib/live-agent-quality";

test("accepts a specific reply that addresses the triggering subject", () => {
  const result = evaluateReplyQuality(
    "Proof Lab verifies useful work by separating requester, worker, and validator signatures before it creates a portable receipt. | neoncore.space",
    "NEONCORE, how does Proof Lab verify useful work?",
  );
  assert.equal(result.ok, true);
  assert.equal(result.code, "accepted");
});

test("rejects generic engagement prompts", () => {
  const result = evaluateReplyQuality(
    "Interesting. What is your view on adoption? | neoncore.space",
    "NEONCORE, explain sealed result commitments in Proof Lab.",
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "generic_engagement");
});

test("rejects a substantive sounding reply that changes the subject", () => {
  const result = evaluateReplyQuality(
    "The lunar telescope is calibrated for a detailed survey of distant galaxies. | neoncore.space",
    "NEONCORE, explain validator signatures in Proof Lab.",
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "unrelated");
});

test("rejects a reply that closely repeats a recent response", () => {
  const recent = "Proof Lab binds requester, worker, and validator signatures into a portable work receipt. | neoncore.space";
  const result = evaluateReplyQuality(
    "Proof Lab binds requester, worker, and validator signatures into one portable receipt. | neoncore.space",
    "NEONCORE, how does Proof Lab record useful work?",
    [recent],
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "repetitive");
});

test("rejects replies that contain too little useful detail", () => {
  const result = evaluateReplyQuality("Good idea. | neoncore.space", "NEONCORE, explain proof receipts.");
  assert.equal(result.ok, false);
  assert.equal(result.code, "too_short");
});
