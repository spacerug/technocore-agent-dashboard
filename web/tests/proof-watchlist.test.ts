import assert from "node:assert/strict";
import test from "node:test";

import { ProofExperiment } from "../app/lib/proof-lab";
import {
  parseWatchedProofs,
  removeWatchedProof,
  serializeWatchedProofs,
  upsertWatchedProof,
  watchedProofChanged,
  watchedProofFromExperiment,
} from "../app/lib/proof-watchlist";

function experiment(status: ProofExperiment["status"] = "open"): ProofExperiment {
  const room = "poui-dae2ce422869";
  const base = {
    seq: 1,
    ts: "2026-08-25T01:00:00Z",
    did: "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf",
    nonce: "1",
    contentId: `ncevt-${"1".repeat(64)}`,
    event: {
      action: "challenge" as const,
      challenge_id: room,
      task_hash: "2".repeat(64),
      created_at_utc: "2026-08-25T01:00:00Z",
      definition: {
        title: "Room Reset Paradox 001",
        task: "Test a permanent proof.",
        acceptance_criteria: "The verifier must reject mutations.",
        requested_model: "Any model",
        time_limit_minutes: 1440,
        max_compute_gflop: 1000,
        validators_required: 1,
        experiment_nonce: "3".repeat(24),
      },
    },
  };
  const claim = status === "open" || status === "empty" ? null : {
    ...base,
    seq: 2,
    did: "did:key:z6MkuVbNjTiAp7uC7RywMDkBAvXsZ57FXK8tzXvyRrv4BYpM",
    contentId: `ncevt-${"4".repeat(64)}`,
    event: { ...base.event, action: "claim" as const, worker_did: "did:key:z6MkuVbNjTiAp7uC7RywMDkBAvXsZ57FXK8tzXvyRrv4BYpM" },
  };
  return {
    room,
    challenge: base,
    claim,
    commit: null,
    reveal: null,
    validations: [],
    ignoredMessages: 0,
    status,
    passCount: 0,
    failCount: 0,
    requiredValidators: 1,
  };
}

test("creates a public watch entry and detects a new worker claim", () => {
  const opened = watchedProofFromExperiment(experiment("open"), undefined, "2026-08-25T01:05:00Z");
  const claimed = watchedProofFromExperiment(experiment("claimed"), opened, "2026-08-25T01:06:00Z");
  assert.equal(opened.title, "Room Reset Paradox 001");
  assert.equal(opened.eventCount, 1);
  assert.equal(opened.deadlineAt, "2026-08-26T01:00:00.000Z");
  assert.equal(claimed.eventCount, 2);
  assert.equal(claimed.latestSequence, 2);
  assert.equal(claimed.firstSeenAt, opened.firstSeenAt);
  assert.equal(watchedProofChanged(opened, claimed), true);
});

test("safely parses, updates, and removes watched rooms", () => {
  const opened = watchedProofFromExperiment(experiment("open"), undefined, "2026-08-25T01:05:00Z");
  const parsed = parseWatchedProofs(serializeWatchedProofs([opened]));
  assert.deepEqual(parsed, [opened]);
  assert.deepEqual(parseWatchedProofs("not json"), []);
  assert.equal(upsertWatchedProof(parsed, { ...opened, status: "claimed" }).length, 1);
  assert.deepEqual(removeWatchedProof(parsed, opened.room), []);
});
