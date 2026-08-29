import {
  base64urlEncode,
  BrowserIdentity,
  bytesToHex,
  canonicalJson,
  cleanText,
  makeProof,
  prettyJson,
  sha256Bytes,
  verifySignedDocument,
} from "./browser-crypto";

export const PROOF_EVENT_PREFIX = "NCPOUI1:";
export const PROOF_RECEIPT_SCHEMA_V1 = "technocore-agent-dashboard/proof-of-useful-inference-receipt/v1";
export const PROOF_RECEIPT_SCHEMA = "neoncore/proof-of-useful-inference-receipt/v2";
export const PROOF_EVENT_CONTENT_SCHEMA = "neoncore/proof-lab-event-content/v1";

export type ProofAction = "challenge" | "checkpoint" | "claim" | "commit" | "reveal" | "validate";
export type ValidatorVerdict = "pass" | "fail" | "uncertain";

export type ChallengeDefinition = {
  title: string;
  task: string;
  acceptance_criteria: string;
  requested_model: string;
  time_limit_minutes: number;
  max_compute_gflop: number;
  validators_required: number;
  experiment_nonce: string;
};

export type ProofEvent = {
  action: ProofAction;
  challenge_id: string;
  task_hash: string;
  created_at_utc: string;
  definition?: ChallengeDefinition;
  worker_did?: string;
  result_sha256?: string;
  declared_model?: string;
  declared_compute_gflop?: number;
  runtime_seconds?: number;
  result?: string;
  reveal_salt?: string;
  verdict?: ValidatorVerdict;
  validator_note?: string;
};

export type ProofMessage = {
  seq?: number;
  ts?: string;
  from?: string;
  nonce?: number | string;
  text?: string;
};

export type AcceptedProofEvent = {
  seq: number | null;
  ts: string;
  did: string;
  nonce: string;
  contentId: string;
  event: ProofEvent;
};

export type ProofValidation = AcceptedProofEvent & {
  verdict: ValidatorVerdict;
  note: string;
};

export type ProofExperiment = {
  room: string;
  challenge: AcceptedProofEvent | null;
  checkpoint: AcceptedProofEvent | null;
  claim: AcceptedProofEvent | null;
  commit: AcceptedProofEvent | null;
  reveal: AcceptedProofEvent | null;
  validations: ProofValidation[];
  ignoredMessages: number;
  status: "empty" | "open" | "claimed" | "committed" | "revealed" | "validated" | "contested";
  passCount: number;
  failCount: number;
  requiredValidators: number;
};

export type PrivateReveal = {
  schema: "neoncore-proof-lab/private-reveal/v1";
  challenge_id: string;
  task_hash: string;
  worker_did: string;
  result: string;
  reveal_salt: string;
  result_sha256: string;
  declared_model: string;
  declared_compute_gflop: number;
  runtime_seconds: number;
};

export type ProofReceiptPackage = {
  receipt: Record<string, unknown>;
  receiptText: string;
  receiptSha256: string;
  proofId: string;
  filename: string;
  announcement: string;
};

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalize(value: string, label: string, maximum: number): string {
  const output = value.trim().replace(/\s+/g, " ");
  if (!output) throw new Error(`Enter ${label}.`);
  if (output.length > maximum) throw new Error(`Keep ${label} under ${maximum.toLocaleString()} characters.`);
  return output;
}

function positiveNumber(value: number, label: string, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be greater than zero and no more than ${maximum.toLocaleString()}.`);
  }
  return Math.round(value * 1000) / 1000;
}

function isDid(value: unknown): value is string {
  return typeof value === "string" && /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isProofLabRoom(value: unknown): value is string {
  return typeof value === "string" && /^(?:proof|poui)-[0-9a-f]{12}$/.test(value);
}

function eventBase(challengeId: string, taskHash: string, action: ProofAction): ProofEvent {
  if (!isProofLabRoom(challengeId) || !isHash(taskHash)) throw new Error("The Proof Lab challenge identity is invalid.");
  return { action, challenge_id: challengeId, task_hash: taskHash, created_at_utc: now() };
}

export async function createProofChallenge(input: {
  title: string;
  task: string;
  acceptanceCriteria: string;
  requestedModel: string;
  timeLimitMinutes: number;
  maxComputeGflop: number;
  validatorsRequired: number;
}): Promise<{ room: string; event: ProofEvent }> {
  if (!Number.isInteger(input.validatorsRequired) || input.validatorsRequired < 1 || input.validatorsRequired > 5) {
    throw new Error("Required validators must be a whole number from 1 to 5.");
  }
  const definition: ChallengeDefinition = {
    title: normalize(input.title, "a short challenge title", 100),
    task: normalize(input.task, "the useful inference task", 1200),
    acceptance_criteria: normalize(input.acceptanceCriteria, "clear acceptance criteria", 800),
    requested_model: normalize(input.requestedModel, "the requested model or model class", 120),
    time_limit_minutes: positiveNumber(input.timeLimitMinutes, "Time limit", 10080),
    max_compute_gflop: positiveNumber(input.maxComputeGflop, "Maximum compute", 1_000_000_000),
    validators_required: input.validatorsRequired,
    experiment_nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(12))),
  };
  const taskHash = await sha256Bytes(canonicalJson(definition as unknown as Record<string, unknown>));
  const challengeId = `proof-${taskHash.slice(0, 12)}`;
  return {
    room: challengeId,
    event: { ...eventBase(challengeId, taskHash, "challenge"), definition },
  };
}

export function encodeProofEvent(event: ProofEvent): string {
  const text = `${PROOF_EVENT_PREFIX}${JSON.stringify(event)}`;
  return cleanText(text);
}

export function parseProofEvent(text: unknown): ProofEvent | null {
  if (typeof text !== "string" || !text.startsWith(PROOF_EVENT_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(PROOF_EVENT_PREFIX.length));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as ProofEvent;
  if (!["challenge", "checkpoint", "claim", "commit", "reveal", "validate"].includes(event.action)) return null;
  if (!isProofLabRoom(event.challenge_id) || !isHash(event.task_hash) || typeof event.created_at_utc !== "string") return null;
  return event;
}

export function createCheckpointEvent(challenge: ProofEvent): ProofEvent {
  if (challenge.action !== "challenge" || !isProofLabRoom(challenge.challenge_id) || !isHash(challenge.task_hash)) {
    throw new Error("A valid challenge is required before creating its checkpoint.");
  }
  return eventBase(challenge.challenge_id, challenge.task_hash, "checkpoint");
}

export function createClaimEvent(experiment: ProofExperiment, workerDid: string): ProofEvent {
  if (!experiment.challenge) throw new Error("Load a valid Proof Lab challenge first.");
  if (experiment.claim) throw new Error("This challenge already has a worker.");
  if (!isDid(workerDid)) throw new Error("Load a valid worker DID.");
  if (workerDid === experiment.challenge.did) throw new Error("The requester cannot claim its own challenge. Use a different agent DID.");
  const source = experiment.challenge.event;
  return { ...eventBase(source.challenge_id, source.task_hash, "claim"), worker_did: workerDid };
}

async function resultHash(result: string, salt: string): Promise<string> {
  return sha256Bytes(canonicalJson({ result, reveal_salt: salt }));
}

export async function createCommitEvent(input: {
  experiment: ProofExperiment;
  workerDid: string;
  result: string;
  declaredModel: string;
  declaredComputeGflop: number;
  runtimeSeconds: number;
}): Promise<{ event: ProofEvent; privateReveal: PrivateReveal }> {
  const { experiment } = input;
  if (!experiment.challenge || !experiment.claim) throw new Error("The challenge must be claimed before a result can be committed.");
  if (experiment.commit) throw new Error("A result commitment already exists.");
  if (input.workerDid !== experiment.claim.did) throw new Error("Only the claimed worker DID can commit a result.");
  const result = normalize(input.result, "the completed result", 2200);
  const declaredModel = normalize(input.declaredModel, "the model used", 120);
  const declaredComputeGflop = positiveNumber(input.declaredComputeGflop, "Declared compute", 1_000_000_000);
  const runtimeSeconds = positiveNumber(input.runtimeSeconds, "Runtime", 31_536_000);
  const salt = base64urlEncode(crypto.getRandomValues(new Uint8Array(18)));
  const outputHash = await resultHash(result, salt);
  const source = experiment.challenge.event;
  const event: ProofEvent = {
    ...eventBase(source.challenge_id, source.task_hash, "commit"),
    worker_did: input.workerDid,
    result_sha256: outputHash,
    declared_model: declaredModel,
    declared_compute_gflop: declaredComputeGflop,
    runtime_seconds: runtimeSeconds,
  };
  return {
    event,
    privateReveal: {
      schema: "neoncore-proof-lab/private-reveal/v1",
      challenge_id: source.challenge_id,
      task_hash: source.task_hash,
      worker_did: input.workerDid,
      result,
      reveal_salt: salt,
      result_sha256: outputHash,
      declared_model: declaredModel,
      declared_compute_gflop: declaredComputeGflop,
      runtime_seconds: runtimeSeconds,
    },
  };
}

export async function createRevealEvent(experiment: ProofExperiment, reveal: PrivateReveal, workerDid: string): Promise<ProofEvent> {
  if (!experiment.challenge || !experiment.claim || !experiment.commit) throw new Error("A result commitment is required before reveal.");
  if (experiment.reveal) throw new Error("The result is already public.");
  if (workerDid !== experiment.claim.did || reveal.worker_did !== workerDid) throw new Error("Only the claimed worker DID can reveal this result.");
  if (reveal.challenge_id !== experiment.challenge.event.challenge_id || reveal.task_hash !== experiment.challenge.event.task_hash) {
    throw new Error("This private reveal backup belongs to a different challenge.");
  }
  const computed = await resultHash(reveal.result, reveal.reveal_salt);
  if (computed !== reveal.result_sha256 || computed !== experiment.commit.event.result_sha256) {
    throw new Error("The private reveal no longer matches the public commitment.");
  }
  return {
    ...eventBase(reveal.challenge_id, reveal.task_hash, "reveal"),
    worker_did: workerDid,
    result_sha256: computed,
    result: reveal.result,
    reveal_salt: reveal.reveal_salt,
  };
}

export function parsePrivateReveal(text: string): PrivateReveal {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The private reveal backup is not readable JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The private reveal backup is invalid.");
  const reveal = value as PrivateReveal;
  if (
    reveal.schema !== "neoncore-proof-lab/private-reveal/v1" ||
    !isProofLabRoom(reveal.challenge_id) ||
    !isHash(reveal.task_hash) ||
    !isDid(reveal.worker_did) ||
    !isHash(reveal.result_sha256) ||
    typeof reveal.result !== "string" ||
    typeof reveal.reveal_salt !== "string"
  ) {
    throw new Error("The private reveal backup fields are invalid.");
  }
  return reveal;
}

export function createValidationEvent(input: {
  experiment: ProofExperiment;
  validatorDid: string;
  verdict: ValidatorVerdict;
  note: string;
}): ProofEvent {
  const { experiment } = input;
  if (!experiment.challenge || !experiment.claim || !experiment.reveal) throw new Error("A valid public result is required before validation.");
  if (!["pass", "fail", "uncertain"].includes(input.verdict)) throw new Error("Choose a validator verdict.");
  if (!isDid(input.validatorDid)) throw new Error("Load a valid validator DID.");
  if ([experiment.challenge.did, experiment.claim.did].includes(input.validatorDid)) {
    throw new Error("The requester and worker cannot validate their own experiment.");
  }
  if (experiment.validations.some((validation) => validation.did === input.validatorDid)) {
    throw new Error("This validator DID already submitted a verdict.");
  }
  const source = experiment.challenge.event;
  return {
    ...eventBase(source.challenge_id, source.task_hash, "validate"),
    result_sha256: experiment.reveal.event.result_sha256,
    verdict: input.verdict,
    validator_note: normalize(input.note, "a short validation note", 500),
  };
}

async function accepted(message: ProofMessage, event: ProofEvent): Promise<AcceptedProofEvent | null> {
  if (!isDid(message.from)) return null;
  const nonce = message.nonce === undefined ? "" : String(message.nonce);
  const contentHash = await sha256Bytes(canonicalJson({
    schema: PROOF_EVENT_CONTENT_SCHEMA,
    did: message.from,
    nonce,
    event,
  }));
  return {
    seq: typeof message.seq === "number" && Number.isFinite(message.seq) ? message.seq : null,
    ts: typeof message.ts === "string" ? message.ts : "",
    did: message.from,
    nonce,
    contentId: `ncevt-${contentHash}`,
    event,
  };
}

function validDefinition(event: ProofEvent): event is ProofEvent & { definition: ChallengeDefinition } {
  const definition = event.definition;
  return Boolean(
    definition &&
    typeof definition.title === "string" &&
    typeof definition.task === "string" &&
    typeof definition.acceptance_criteria === "string" &&
    typeof definition.requested_model === "string" &&
    Number.isFinite(definition.time_limit_minutes) &&
    Number.isFinite(definition.max_compute_gflop) &&
    Number.isInteger(definition.validators_required) &&
    definition.validators_required >= 1 &&
    definition.validators_required <= 5 &&
    typeof definition.experiment_nonce === "string"
  );
}

export async function reconstructProofExperiment(room: string, messages: ProofMessage[]): Promise<ProofExperiment> {
  let challenge: AcceptedProofEvent | null = null;
  let checkpoint: AcceptedProofEvent | null = null;
  let claim: AcceptedProofEvent | null = null;
  let commit: AcceptedProofEvent | null = null;
  let reveal: AcceptedProofEvent | null = null;
  const validations: ProofValidation[] = [];
  let ignoredMessages = 0;
  const ordered = [...messages].sort((left, right) => (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER));

  for (const message of ordered) {
    const event = parseProofEvent(message.text);
    if (!event) {
      ignoredMessages += 1;
      continue;
    }
    const record = await accepted(message, event);
    if (!record) {
      ignoredMessages += 1;
      continue;
    }
    if (!challenge) {
      if (event.action !== "challenge" || !validDefinition(event) || event.challenge_id !== room) {
        ignoredMessages += 1;
        continue;
      }
      const expectedHash = await sha256Bytes(canonicalJson(event.definition as unknown as Record<string, unknown>));
      const currentId = `proof-${expectedHash.slice(0, 12)}`;
      const legacyId = `poui-${expectedHash.slice(0, 12)}`;
      if (expectedHash !== event.task_hash || ![currentId, legacyId].includes(event.challenge_id)) {
        ignoredMessages += 1;
        continue;
      }
      challenge = record;
      continue;
    }
    if (event.challenge_id !== challenge.event.challenge_id || event.task_hash !== challenge.event.task_hash) {
      ignoredMessages += 1;
      continue;
    }
    if (event.action === "checkpoint" && !checkpoint) {
      if (record.did !== challenge.did) ignoredMessages += 1;
      else checkpoint = record;
      continue;
    }
    if (event.action === "claim" && !claim) {
      if (record.did === challenge.did || event.worker_did !== record.did) ignoredMessages += 1;
      else claim = record;
      continue;
    }
    if (event.action === "commit" && claim && !commit) {
      if (
        record.did !== claim.did ||
        event.worker_did !== record.did ||
        !isHash(event.result_sha256) ||
        typeof event.declared_model !== "string" ||
        !Number.isFinite(event.declared_compute_gflop) ||
        !Number.isFinite(event.runtime_seconds)
      ) ignoredMessages += 1;
      else commit = record;
      continue;
    }
    if (event.action === "reveal" && claim && commit && !reveal) {
      if (
        record.did !== claim.did ||
        event.worker_did !== record.did ||
        typeof event.result !== "string" ||
        typeof event.reveal_salt !== "string" ||
        !isHash(event.result_sha256)
      ) {
        ignoredMessages += 1;
        continue;
      }
      const computed = await resultHash(event.result, event.reveal_salt);
      if (computed !== event.result_sha256 || computed !== commit.event.result_sha256) ignoredMessages += 1;
      else reveal = record;
      continue;
    }
    if (event.action === "validate" && claim && reveal) {
      if (
        record.did === challenge.did ||
        record.did === claim.did ||
        validations.some((validation) => validation.did === record.did) ||
        !["pass", "fail", "uncertain"].includes(event.verdict ?? "") ||
        event.result_sha256 !== reveal.event.result_sha256 ||
        typeof event.validator_note !== "string"
      ) {
        ignoredMessages += 1;
        continue;
      }
      validations.push({ ...record, verdict: event.verdict as ValidatorVerdict, note: event.validator_note });
      continue;
    }
    ignoredMessages += 1;
  }

  const requiredValidators = challenge && validDefinition(challenge.event) ? challenge.event.definition.validators_required : 1;
  const passCount = validations.filter((validation) => validation.verdict === "pass").length;
  const failCount = validations.filter((validation) => validation.verdict === "fail").length;
  let status: ProofExperiment["status"] = "empty";
  if (challenge) status = "open";
  if (claim) status = "claimed";
  if (commit) status = "committed";
  if (reveal) status = "revealed";
  if (reveal && failCount > 0) status = "contested";
  else if (reveal && passCount >= requiredValidators) status = "validated";
  return { room, challenge, checkpoint, claim, commit, reveal, validations, ignoredMessages, status, passCount, failCount, requiredValidators };
}

export async function createProofReceipt(identity: BrowserIdentity, experiment: ProofExperiment): Promise<ProofReceiptPackage> {
  if (!experiment.challenge || !experiment.claim || !experiment.commit || !experiment.reveal) {
    throw new Error("The public experiment record is incomplete.");
  }
  if (identity.did !== experiment.challenge.did) throw new Error("Only the requester DID can finalize this work receipt.");
  if (experiment.status !== "validated" && experiment.status !== "contested") {
    throw new Error("Wait for the required independent validator decisions before finalizing.");
  }
  const definition = experiment.challenge.event.definition!;
  const acceptedEvidence = [experiment.challenge, experiment.checkpoint, experiment.claim, experiment.commit, experiment.reveal, ...experiment.validations].filter(Boolean) as AcceptedProofEvent[];
  const evidence = acceptedEvidence.map((entry) => ({
    action: entry.event.action,
    did: entry.did,
    event_content_id: entry.contentId,
    seq: entry.seq,
    ts: entry.ts,
    nonce: entry.nonce,
    event_sha256: "pending",
  }));
  for (let index = 0; index < evidence.length; index += 1) {
    evidence[index].event_sha256 = await sha256Bytes(canonicalJson(
      acceptedEvidence[index].event as unknown as Record<string, unknown>,
    ));
  }
  const proofCore: Record<string, unknown> = {
    schema: PROOF_RECEIPT_SCHEMA,
    status: experiment.status,
    challenge_id: experiment.challenge.event.challenge_id,
    technocore_room: experiment.room,
    task_hash: experiment.challenge.event.task_hash,
    task: definition,
    owner_did: experiment.challenge.did,
    requester_did: experiment.challenge.did,
    worker_did: experiment.claim.did,
    result: {
      sha256: experiment.reveal.event.result_sha256,
      text: experiment.reveal.event.result,
      declared_model: experiment.commit.event.declared_model,
      declared_compute_gflop: experiment.commit.event.declared_compute_gflop,
      runtime_seconds: experiment.commit.event.runtime_seconds,
    },
    validation: {
      required: experiment.requiredValidators,
      pass_count: experiment.passCount,
      fail_count: experiment.failCount,
      decisions: experiment.validations.map((validation) => ({
        validator_did: validation.did,
        verdict: validation.verdict,
        note: validation.note,
        event_content_id: validation.contentId,
        technocore_seq: validation.seq,
      })),
    },
    technocore_evidence: evidence,
    sequence_scope: "room_generation_only",
    sequence_note:
      "Technocore sequence values are location hints inside the observed room generation. They can be reused if a room is reaped and recreated. Event content IDs and the signed receipt proof ID are the durable identifiers.",
    finalized_at_utc: now(),
    finalized_by_did: identity.did,
    proof_id_method: "SHA-256 of canonical receipt JSON with proof_id and proof omitted",
    declaration:
      "This independent experimental receipt records DID attributed messages observed in a Technocore room. It is not an official FLOP protocol record, token, payment, mining result, reward promise, or guarantee that every written claim is true.",
  };
  const proofIdHash = await sha256Bytes(canonicalJson(proofCore));
  const proofId = `ncwork-${proofIdHash}`;
  const unsigned: Record<string, unknown> = { ...proofCore, proof_id: proofId };
  const receipt = { ...unsigned, proof: await makeProof(identity, unsigned) };
  const receiptText = prettyJson(receipt);
  const receiptSha256 = await sha256Bytes(new TextEncoder().encode(receiptText));
  const challengeId = experiment.challenge.event.challenge_id;
  const announcement = cleanText(
    `NEONCORE PROOF OF USEFUL INFERENCE | Challenge: ${challengeId} | Status: ${experiment.status.toUpperCase()} | Permanent Proof ID: ${proofId} | Requester DID: ${experiment.challenge.did} | Worker DID: ${experiment.claim.did} | Validators: ${experiment.validations.length} | Model: ${String(experiment.commit.event.declared_model)} | Declared compute GFLOP: ${String(experiment.commit.event.declared_compute_gflop)} | Result SHA-256: ${String(experiment.reveal.event.result_sha256)} | Receipt SHA-256: ${receiptSha256} | Technocore room: ${experiment.room} | Declaration: Independent experimental work receipt, not an official FLOP protocol record, token, payment, mining result, or promise of rewards.`,
  );
  return {
    receipt,
    receiptText,
    receiptSha256,
    proofId,
    filename: `${challengeId}-public-work-receipt.json`,
    announcement,
  };
}

export async function verifyProofReceipt(text: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The Proof Lab receipt is not readable JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The Proof Lab receipt is invalid.");
  const receipt = value as Record<string, unknown>;
  const schema = receipt.schema;
  if (schema !== PROOF_RECEIPT_SCHEMA && schema !== PROOF_RECEIPT_SCHEMA_V1) {
    throw new Error("This Proof Lab receipt uses an unsupported schema.");
  }
  await verifySignedDocument(receipt, String(schema));
  if (!isProofLabRoom(receipt.challenge_id) || !isHash(receipt.task_hash)) throw new Error("The Proof Lab receipt identity is invalid.");
  if (schema === PROOF_RECEIPT_SCHEMA) {
    const proofId = receipt.proof_id;
    if (typeof proofId !== "string" || !/^ncwork-[0-9a-f]{64}$/.test(proofId)) {
      throw new Error("The Proof Lab permanent proof ID is invalid.");
    }
    const proofCore = { ...receipt };
    delete proofCore.proof;
    delete proofCore.proof_id;
    const expectedProofId = `ncwork-${await sha256Bytes(canonicalJson(proofCore))}`;
    if (proofId !== expectedProofId) throw new Error("The Proof Lab permanent proof ID does not match the receipt.");
  }
  return receipt;
}
