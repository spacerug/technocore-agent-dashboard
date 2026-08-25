import assert from "node:assert/strict";
import test from "node:test";

import { loadIdentityJson } from "../app/lib/browser-crypto";
import {
  createClaimEvent,
  createCommitEvent,
  createProofChallenge,
  createProofReceipt,
  createRevealEvent,
  createValidationEvent,
  encodeProofEvent,
  reconstructProofExperiment,
  verifyProofReceipt,
} from "../app/lib/proof-lab";
import { proofCertificateFilename } from "../app/lib/proof-certificate";

function seedHex(offset: number): string {
  return Array.from({ length: 32 }, (_, index) => ((index + offset) % 256).toString(16).padStart(2, "0")).join("");
}

test("reconstructs a complete independently validated useful inference experiment", async () => {
  const requester = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(0) }), "requester.json");
  const worker = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(40) }), "worker.json");
  const validator = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(80) }), "validator.json");
  const challenge = await createProofChallenge({
    title: "Check one technical claim",
    task: "Find the official source for one technical claim and summarize it.",
    acceptanceCriteria: "Include one primary source URL and a direct answer.",
    requestedModel: "Any capable language model",
    timeLimitMinutes: 30,
    maxComputeGflop: 1000,
    validatorsRequired: 1,
  });
  const messages = [{ seq: 1, from: requester.did, nonce: 1, ts: "2026-08-25T00:00:00Z", text: encodeProofEvent(challenge.event) }];
  let experiment = await reconstructProofExperiment(challenge.room, messages);
  const claim = createClaimEvent(experiment, worker.did);
  messages.push({ seq: 2, from: worker.did, nonce: 2, ts: "2026-08-25T00:01:00Z", text: encodeProofEvent(claim) });
  experiment = await reconstructProofExperiment(challenge.room, messages);

  const committed = await createCommitEvent({
    experiment,
    workerDid: worker.did,
    result: "The claim is supported by the official protocol documentation at https://example.com/spec.",
    declaredModel: "Test Model",
    declaredComputeGflop: 425.5,
    runtimeSeconds: 18,
  });
  messages.push({ seq: 3, from: worker.did, nonce: 3, ts: "2026-08-25T00:02:00Z", text: encodeProofEvent(committed.event) });
  experiment = await reconstructProofExperiment(challenge.room, messages);
  const reveal = await createRevealEvent(experiment, committed.privateReveal, worker.did);
  messages.push({ seq: 4, from: worker.did, nonce: 4, ts: "2026-08-25T00:03:00Z", text: encodeProofEvent(reveal) });
  experiment = await reconstructProofExperiment(challenge.room, messages);
  const validation = createValidationEvent({
    experiment,
    validatorDid: validator.did,
    verdict: "pass",
    note: "I checked the answer against the public criteria.",
  });
  messages.push({ seq: 5, from: validator.did, nonce: 5, ts: "2026-08-25T00:04:00Z", text: encodeProofEvent(validation) });
  experiment = await reconstructProofExperiment(challenge.room, messages);

  assert.equal(experiment.status, "validated");
  assert.equal(experiment.passCount, 1);
  assert.equal(experiment.claim?.did, worker.did);
  assert.equal(experiment.reveal?.event.result_sha256, committed.privateReveal.result_sha256);

  const receipt = await createProofReceipt(requester, experiment);
  const verified = await verifyProofReceipt(receipt.receiptText);
  assert.equal(verified.challenge_id, challenge.room);
  assert.equal(verified.worker_did, worker.did);
  assert.equal(verified.proof_id, receipt.proofId);
  assert.match(receipt.proofId, /^ncwork-[0-9a-f]{64}$/);
  assert.match(String((verified.technocore_evidence as Array<Record<string, unknown>>)[0].event_content_id), /^ncevt-[0-9a-f]{64}$/);
  assert.equal(proofCertificateFilename({
    challengeId: challenge.room,
    title: "Check one technical claim",
    status: "validated",
    requesterDid: requester.did,
    workerDid: worker.did,
    validatorCount: 1,
    model: "Test Model",
    computeGflop: 425.5,
    runtimeSeconds: 18,
    resultSha256: committed.privateReveal.result_sha256,
    receiptSha256: receipt.receiptSha256,
    proofId: receipt.proofId,
    room: challenge.room,
  }), `${challenge.room}-public-work-certificate.png`);

  const changed = JSON.parse(receipt.receiptText);
  changed.result.text = "Changed after signing";
  await assert.rejects(() => verifyProofReceipt(JSON.stringify(changed)), /signature is invalid/i);
});

test("rejects self dealing between requester, worker, and validator roles", async () => {
  const requester = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex(3) }), "requester.json");
  const challenge = await createProofChallenge({
    title: "Independent role test",
    task: "Complete one useful task.",
    acceptanceCriteria: "A different DID must validate it.",
    requestedModel: "Any model",
    timeLimitMinutes: 10,
    maxComputeGflop: 10,
    validatorsRequired: 1,
  });
  const experiment = await reconstructProofExperiment(challenge.room, [{ seq: 1, from: requester.did, text: encodeProofEvent(challenge.event) }]);
  assert.throws(() => createClaimEvent(experiment, requester.did), /cannot claim its own challenge/i);
});
