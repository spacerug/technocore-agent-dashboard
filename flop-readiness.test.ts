import assert from "node:assert/strict";
import test from "node:test";

import {
  addDevelopmentInference,
  calculateTestnetSpendPlan,
  createTestnetSessionDraft,
  DEFAULT_TESTNET_SPEND_PLAN,
  parseDevelopmentInference,
  parseTestnetSpendPlan,
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

test("plans ninety days of faucet-funded inference without calling it confirmed spend", () => {
  assert.deepEqual(calculateTestnetSpendPlan({
    faucetBalance: 900,
    plannedSpend: 600,
    averageSessionFee: 3,
    campaignDays: 90,
    lockedAllocation: 300,
  }), {
    dailySpendTarget: 600 / 90,
    estimatedSessions: 200,
    unusedFaucetBalance: 300,
    unfundedSpend: 0,
    unlockCapacity: 200,
    projectedUnlock: 200,
    additionalSpendToUnlockAllocation: 300,
  });
});

test("restores bounded testnet plans and rejects malformed local data", () => {
  assert.deepEqual(parseTestnetSpendPlan("not json"), DEFAULT_TESTNET_SPEND_PLAN);
  assert.deepEqual(parseTestnetSpendPlan(JSON.stringify({
    faucetBalance: -5,
    plannedSpend: 1200,
    averageSessionFee: 4,
    campaignDays: 900,
    lockedAllocation: 200,
  })), {
    faucetBalance: 0,
    plannedSpend: 1200,
    averageSessionFee: 4,
    campaignDays: 365,
    lockedAllocation: 200,
  });
});

test("builds an owner-bound draft containing the five announced session fields", () => {
  const ownerDid = "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf";
  const draft = createTestnetSessionDraft(ownerDid, {
    taskLabel: "Summarize a public dataset",
    modelWeightsIndex: "sha256:model-weights-index",
    maximumLatencyMs: 30000,
    computeFlops: "1000000000000",
    confidentiality: false,
    maximumFeeFlop: "3.5",
  }, "2026-08-29T20:00:00.000Z");
  assert.equal(draft.owner_did, ownerDid);
  assert.equal(draft.scope, "draft_only_not_submitted");
  assert.deepEqual(draft.request, {
    model_weights_index: "sha256:model-weights-index",
    maximum_latency_ms: 30000,
    compute_flops: "1000000000000",
    confidentiality: false,
    maximum_fee_flop: "3.5",
  });
  assert.throws(() => createTestnetSessionDraft(ownerDid, {
    taskLabel: "Bad draft",
    modelWeightsIndex: "",
    maximumLatencyMs: 0,
    computeFlops: "0",
    confidentiality: false,
    maximumFeeFlop: "0",
  }), /Maximum latency/);
});
