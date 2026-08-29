import assert from "node:assert/strict";
import test from "node:test";

import {
  addDevelopmentInference,
  parseDevelopmentInference,
  projectedAirdropUnlock,
  summarizeDevelopmentInference,
} from "../app/lib/flop-readiness";

const record = {
  id: "development-inference-1",
  generated_at_utc: "2026-08-29T20:00:00.000Z",
  model: "development-model",
  input_tokens: 120,
  output_tokens: 30,
  total_tokens: 150,
  scope: "off_network_development" as const,
};

test("stores and summarizes bounded off-network inference activity", () => {
  const entries = addDevelopmentInference([], record);
  assert.deepEqual(parseDevelopmentInference(JSON.stringify(entries)), entries);
  assert.deepEqual(summarizeDevelopmentInference(entries), {
    calls: 1,
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
});

test("rejects untrusted activity scopes and deduplicates record IDs", () => {
  assert.deepEqual(parseDevelopmentInference(JSON.stringify([{ ...record, scope: "flop_testnet" }])), []);
  const replacement = { ...record, total_tokens: 151 };
  assert.deepEqual(addDevelopmentInference([record], replacement), [replacement]);
});

test("calculates the draft three spent to one unlocked rule without exceeding the locked allocation", () => {
  assert.equal(projectedAirdropUnlock(300, 500), 100);
  assert.equal(projectedAirdropUnlock(3000, 500), 500);
  assert.equal(projectedAirdropUnlock(-1, 500), 0);
});
