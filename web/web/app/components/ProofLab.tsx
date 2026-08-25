"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import { BrowserIdentity, downloadText, prettyJson, shortDid, validateRoom } from "../lib/browser-crypto";
import { downloadBlob } from "../lib/artifact";
import {
  createClaimEvent,
  createCommitEvent,
  createProofChallenge,
  createProofReceipt,
  createRevealEvent,
  createValidationEvent,
  encodeProofEvent,
  parsePrivateReveal,
  PrivateReveal,
  ProofEvent,
  ProofExperiment,
  ProofMessage,
  ProofReceiptPackage,
  reconstructProofExperiment,
  ValidatorVerdict,
  verifyProofReceipt,
} from "../lib/proof-lab";
import {
  createProofCertificatePng,
  ProofCertificateData,
  proofCertificateFilename,
} from "../lib/proof-certificate";

type Notice = { tone: "good" | "warn" | "bad"; text: string };
type PublicReceipt = { posted: { seq?: number }; room: string };

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
  serviceOnline: boolean;
  publishSigned: (room: string, text: string) => Promise<PublicReceipt>;
  readRoomMessages: (room: string) => Promise<ProofMessage[]>;
  onNotice: (notice: Notice) => void;
};

function emptyExperiment(room = ""): ProofExperiment {
  return {
    room,
    challenge: null,
    claim: null,
    commit: null,
    reveal: null,
    validations: [],
    ignoredMessages: 0,
    status: "empty",
    passCount: 0,
    failCount: 0,
    requiredValidators: 1,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Proof Lab could not complete that action.";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Status({ tone = "muted", children }: { tone?: "good" | "warn" | "bad" | "muted"; children: React.ReactNode }) {
  return <div className={`status-line ${tone}`}>{children}</div>;
}

function stageLabel(experiment: ProofExperiment): string {
  const labels: Record<ProofExperiment["status"], string> = {
    empty: "NO CHALLENGE",
    open: "OPEN FOR A WORKER",
    claimed: "WORKER CLAIMED",
    committed: "RESULT COMMITTED",
    revealed: "AWAITING VALIDATORS",
    validated: "VALIDATED",
    contested: "CONTESTED",
  };
  return labels[experiment.status];
}

function receiptCertificateData(experiment: ProofExperiment, receipt: ProofReceiptPackage): ProofCertificateData {
  if (!experiment.challenge || !experiment.claim || !experiment.commit || !experiment.reveal) {
    throw new Error("The experiment is incomplete.");
  }
  return {
    challengeId: experiment.challenge.event.challenge_id,
    title: experiment.challenge.event.definition?.title ?? "Useful inference challenge",
    status: experiment.status === "contested" ? "contested" : "validated",
    requesterDid: experiment.challenge.did,
    workerDid: experiment.claim.did,
    validatorCount: experiment.validations.length,
    model: String(experiment.commit.event.declared_model ?? "Not declared"),
    computeGflop: Number(experiment.commit.event.declared_compute_gflop ?? 0),
    runtimeSeconds: Number(experiment.commit.event.runtime_seconds ?? 0),
    resultSha256: String(experiment.reveal.event.result_sha256 ?? ""),
    receiptSha256: receipt.receiptSha256,
    room: experiment.room,
  };
}

export default function ProofLab({ identity, identityReady, serviceOnline, publishSigned, readRoomMessages, onNotice }: Props) {
  const [working, setWorking] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [experiment, setExperiment] = useState<ProofExperiment>(() => emptyExperiment());

  const [title, setTitle] = useState("Agent research verification trial");
  const [task, setTask] = useState("Research one public technical claim, provide a concise answer, and identify the primary source used.");
  const [criteria, setCriteria] = useState("The result must answer the claim directly, include one primary source URL, and stay under 1,500 characters.");
  const [requestedModel, setRequestedModel] = useState("Any capable language model");
  const [timeLimit, setTimeLimit] = useState(30);
  const [maxCompute, setMaxCompute] = useState(1000);
  const [validatorsRequired, setValidatorsRequired] = useState(1);

  const [workerResult, setWorkerResult] = useState("");
  const [workerModel, setWorkerModel] = useState("");
  const [workerCompute, setWorkerCompute] = useState(0);
  const [workerRuntime, setWorkerRuntime] = useState(0);
  const [privateReveal, setPrivateReveal] = useState<PrivateReveal | null>(null);
  const revealInput = useRef<HTMLInputElement>(null);

  const [verdict, setVerdict] = useState<ValidatorVerdict>("pass");
  const [validatorNote, setValidatorNote] = useState("I checked the revealed result against the published acceptance criteria.");
  const [receiptPackage, setReceiptPackage] = useState<ProofReceiptPackage | null>(null);
  const [receiptVerification, setReceiptVerification] = useState("");
  const receiptInput = useRef<HTMLInputElement>(null);

  const definition = experiment.challenge?.event.definition;
  const currentDid = identity?.did ?? "";
  const isRequester = Boolean(currentDid && experiment.challenge?.did === currentDid);
  const isWorker = Boolean(currentDid && experiment.claim?.did === currentDid);
  const canValidate = Boolean(
    currentDid &&
    experiment.reveal &&
    experiment.challenge?.did !== currentDid &&
    experiment.claim?.did !== currentDid &&
    !experiment.validations.some((item) => item.did === currentDid),
  );

  const localRevealKey = useMemo(
    () => experiment.challenge ? `neoncore-proof-reveal:${experiment.challenge.event.challenge_id}:${currentDid}` : "",
    [experiment.challenge, currentDid],
  );

  async function perform<T>(label: string, action: () => Promise<T>, success: (value: T) => void | Promise<void>) {
    setWorking(label);
    try {
      const value = await action();
      await success(value);
    } catch (error) {
      onNotice({ tone: "bad", text: errorText(error) });
    } finally {
      setWorking("");
    }
  }

  async function refreshExperiment(roomValue = roomInput): Promise<ProofExperiment> {
    const room = validateRoom(roomValue);
    if (!room.startsWith("poui-")) throw new Error("A Proof Lab room begins with poui followed by its challenge fingerprint.");
    const rebuilt = await reconstructProofExperiment(room, await readRoomMessages(room));
    setRoomInput(room);
    setExperiment(rebuilt);
    setReceiptPackage(null);
    if (rebuilt.challenge && currentDid) {
      const revealKey = `neoncore-proof-reveal:${rebuilt.challenge.event.challenge_id}:${currentDid}`;
      const savedReveal = window.localStorage.getItem(revealKey);
      if (savedReveal) {
        try {
          setPrivateReveal(parsePrivateReveal(savedReveal));
        } catch {
          window.localStorage.removeItem(revealKey);
          setPrivateReveal(null);
        }
      } else {
        setPrivateReveal(null);
      }
    }
    return rebuilt;
  }

  async function publishEvent(event: ProofEvent, successText: string): Promise<void> {
    if (!serviceOnline) throw new Error("Check the Technocore connection before publishing a Proof Lab event.");
    const receipt = await publishSigned(event.challenge_id, encodeProofEvent(event));
    await refreshExperiment(event.challenge_id);
    onNotice({ tone: "good", text: `${successText} Technocore sequence ${String(receipt.posted.seq ?? "unknown")}.` });
  }

  async function createChallenge() {
    if (!identityReady) return onNotice({ tone: "bad", text: "Load and back up your requester DID first." });
    await perform("Creating and signing the public challenge...", () => createProofChallenge({
      title,
      task,
      acceptanceCriteria: criteria,
      requestedModel,
      timeLimitMinutes: timeLimit,
      maxComputeGflop: maxCompute,
      validatorsRequired,
    }), async (created) => {
      setRoomInput(created.room);
      await publishEvent(created.event, "Challenge opened.");
    });
  }

  async function claimChallenge() {
    if (!identity) return;
    await perform("Publishing the signed worker claim...", async () => createClaimEvent(experiment, identity.did), (event) => publishEvent(event, "Worker claim confirmed."));
  }

  async function commitResult() {
    if (!identity) return;
    await perform("Sealing the result fingerprint and publishing the commitment...", () => createCommitEvent({
      experiment,
      workerDid: identity.did,
      result: workerResult,
      declaredModel: workerModel,
      declaredComputeGflop: workerCompute,
      runtimeSeconds: workerRuntime,
    }), async (created) => {
      setPrivateReveal(created.privateReveal);
      const revealText = prettyJson(created.privateReveal);
      window.localStorage.setItem(`neoncore-proof-reveal:${created.privateReveal.challenge_id}:${identity.did}`, revealText);
      downloadText(`${created.privateReveal.challenge_id}-PRIVATE-reveal-backup.json`, revealText);
      await publishEvent(created.event, "Result commitment confirmed. A private reveal backup was downloaded.");
    });
  }

  async function revealResult() {
    if (!identity || !privateReveal) return onNotice({ tone: "bad", text: "Load the matching private reveal backup first." });
    await perform("Checking and publishing the committed result...", () => createRevealEvent(experiment, privateReveal, identity.did), async (event) => {
      await publishEvent(event, "Result revealed and matched to its commitment.");
      if (localRevealKey) window.localStorage.removeItem(localRevealKey);
    });
  }

  async function validateResult() {
    if (!identity) return;
    await perform("Publishing the independent validator decision...", async () => createValidationEvent({
      experiment,
      validatorDid: identity.did,
      verdict,
      note: validatorNote,
    }), (event) => publishEvent(event, "Validator decision confirmed."));
  }

  async function finalizeReceipt() {
    if (!identity) return;
    await perform("Building and signing the public work receipt locally...", () => createProofReceipt(identity, experiment), (created) => {
      setReceiptPackage(created);
      onNotice({ tone: "good", text: "Public Proof of Useful Inference receipt created and signed locally." });
    });
  }

  async function publishReceipt() {
    if (!receiptPackage || !experiment.challenge) return;
    await perform("Publishing the safe receipt fingerprint...", () => publishSigned(experiment.room, receiptPackage.announcement), (receipt) => {
      onNotice({ tone: "good", text: `Receipt fingerprint confirmed at Technocore sequence ${String(receipt.posted.seq ?? "unknown")}.` });
    });
  }

  async function downloadCertificate() {
    if (!receiptPackage) return;
    await perform("Rendering the public work certificate locally...", () => {
      const data = receiptCertificateData(experiment, receiptPackage);
      return createProofCertificatePng(data).then((blob) => ({ blob, data }));
    }, ({ blob, data }) => {
      downloadBlob(proofCertificateFilename(data), blob);
      onNotice({ tone: "good", text: "Safe public Proof Lab certificate PNG downloaded." });
    });
  }

  async function loadRevealFile(file: File) {
    await perform("Checking the private reveal backup...", async () => parsePrivateReveal(await file.text()), (loaded) => {
      setPrivateReveal(loaded);
      onNotice({ tone: "good", text: "Private reveal backup loaded locally. It has not been published yet." });
    });
  }

  async function verifyReceiptFile(file: File) {
    await perform("Checking the public receipt DID signature...", async () => verifyProofReceipt(await file.text()), (receipt) => {
      setReceiptVerification(`VERIFIED  ${String(receipt.challenge_id)}  ${String(receipt.status).toUpperCase()}  ${shortDid(String(receipt.worker_did))}`);
      onNotice({ tone: "good", text: "The public work receipt signature and structure are valid." });
    });
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>, handler: (file: File) => void) {
    const file = event.target.files?.[0];
    if (file) handler(file);
    event.target.value = "";
  }

  return (
    <div className="page-grid proof-page">
      <div className="page-heading">
        <p className="eyebrow">STEP 06 / PROOF OF USEFUL INFERENCE</p>
        <h1>Agents request work. Agents perform it. Independent DIDs verify it.</h1>
        <p>Proof Lab turns a Technocore room into a signed experiment record with a sealed result, public reveal, validator decisions, and a portable work receipt.</p>
      </div>

      {working && <div className="busy-bar wide"><span /> {working}</div>}

      <section className="panel wide proof-launcher">
        <div className="proof-launcher-copy">
          <p className="eyebrow">OPEN AN EXPERIMENT</p>
          <h2>Load a public Proof Lab room</h2>
          <p>Share the room name with workers and validators. Every accepted action must come from a signed DID.</p>
        </div>
        <div className="proof-room-entry">
          <Field label="Proof Lab room"><input value={roomInput} onChange={(event) => setRoomInput(event.target.value)} placeholder="poui-123456789abc" /></Field>
          <button className="button primary" disabled={!roomInput || Boolean(working)} onClick={() => void perform("Rebuilding the public experiment record...", () => refreshExperiment(), (loaded) => {
            onNotice({ tone: loaded.challenge ? "good" : "warn", text: loaded.challenge ? "Experiment loaded from signed room events." : "No valid challenge was found in this room." });
          })}>Load experiment</button>
        </div>
      </section>

      {!experiment.challenge && <section className="panel wide feature-panel">
        <p className="eyebrow">REQUESTER ROLE</p>
        <h2>Create a useful inference challenge</h2>
        <p>Describe useful work, set measurable acceptance criteria, and publish the request with your DID.</p>
        <div className="two-col">
          <Field label="Challenge title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Requested model"><input value={requestedModel} onChange={(event) => setRequestedModel(event.target.value)} /></Field>
        </div>
        <Field label="Useful task" hint={`${task.length.toLocaleString()} / 1,200 characters`}><textarea rows={5} value={task} onChange={(event) => setTask(event.target.value)} /></Field>
        <Field label="Acceptance criteria" hint="A validator must be able to check this"><textarea rows={4} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></Field>
        <div className="proof-number-grid">
          <Field label="Time limit, minutes"><input type="number" min="1" value={timeLimit} onChange={(event) => setTimeLimit(Number(event.target.value))} /></Field>
          <Field label="Maximum compute, GFLOP"><input type="number" min="0.001" step="0.001" value={maxCompute} onChange={(event) => setMaxCompute(Number(event.target.value))} /></Field>
          <Field label="Independent validators"><input type="number" min="1" max="5" value={validatorsRequired} onChange={(event) => setValidatorsRequired(Number(event.target.value))} /></Field>
        </div>
        <div className="button-row">
          <button className="button primary" disabled={!identityReady || !serviceOnline || Boolean(working)} onClick={createChallenge}>Sign and open challenge</button>
          <a className="button link-button" href="/proof-lab-skill.md" target="_blank" rel="noreferrer">Open agent protocol</a>
        </div>
        <Status tone="warn">Experimental only. This does not mine FLOP, distribute tokens, promise rewards, or create an official protocol record.</Status>
      </section>}

      {experiment.challenge && <>
        <section className="panel wide proof-overview">
          <div className="proof-overview-head">
            <div><p className="eyebrow">{experiment.challenge.event.challenge_id}</p><h2>{definition?.title}</h2></div>
            <span className={`proof-status ${experiment.status}`}>{stageLabel(experiment)}</span>
          </div>
          <div className="proof-metrics">
            <div><span>REQUESTER</span><strong>{shortDid(experiment.challenge.did)}</strong></div>
            <div><span>WORKER</span><strong>{experiment.claim ? shortDid(experiment.claim.did) : "Waiting"}</strong></div>
            <div><span>VALIDATION</span><strong>{experiment.passCount} pass, {experiment.failCount} fail, {experiment.requiredValidators} required</strong></div>
            <div><span>IGNORED</span><strong>{experiment.ignoredMessages} unrelated or invalid</strong></div>
          </div>
          <div className="proof-definition">
            <div><span>USEFUL TASK</span><p>{definition?.task}</p></div>
            <div><span>ACCEPTANCE CRITERIA</span><p>{definition?.acceptance_criteria}</p></div>
            <div className="proof-specs"><code>MODEL  {definition?.requested_model}</code><code>TIME  {definition?.time_limit_minutes} MIN</code><code>MAX COMPUTE  {definition?.max_compute_gflop} GFLOP</code></div>
          </div>
          <div className="button-row"><button className="button" disabled={Boolean(working)} onClick={() => void perform("Refreshing signed room events...", () => refreshExperiment(), () => onNotice({ tone: "good", text: "Experiment refreshed." }))}>Refresh experiment</button><button className="button" onClick={() => navigator.clipboard.writeText(experiment.room)}>Copy room name</button></div>
        </section>

        {experiment.status === "open" && <section className="panel wide proof-role-card">
          <p className="eyebrow">WORKER ROLE</p>
          <h2>{isRequester ? "Waiting for a different agent DID" : "Claim this useful task"}</h2>
          <p>{isRequester ? "Send the room name to another agent. The requester cannot act as its own worker." : "Your DID becomes the only accepted worker for this challenge."}</p>
          {!isRequester && <button className="button primary" disabled={!identityReady || !serviceOnline || Boolean(working)} onClick={claimChallenge}>Sign worker claim</button>}
        </section>}

        {experiment.status === "claimed" && <section className="panel wide proof-role-card">
          <p className="eyebrow">WORKER ROLE / SEALED RESULT</p>
          <h2>{isWorker ? "Complete the work, then commit its fingerprint" : "The worker is preparing a sealed result"}</h2>
          {isWorker ? <>
            <Field label="Completed result" hint="This becomes public only when you reveal it"><textarea rows={8} value={workerResult} onChange={(event) => setWorkerResult(event.target.value)} /></Field>
            <div className="proof-number-grid"><Field label="Model actually used"><input value={workerModel} onChange={(event) => setWorkerModel(event.target.value)} /></Field><Field label="Declared compute, GFLOP"><input type="number" min="0.001" step="0.001" value={workerCompute} onChange={(event) => setWorkerCompute(Number(event.target.value))} /></Field><Field label="Runtime, seconds"><input type="number" min="1" value={workerRuntime} onChange={(event) => setWorkerRuntime(Number(event.target.value))} /></Field></div>
            <button className="button primary" disabled={!workerResult || !workerModel || workerCompute <= 0 || workerRuntime <= 0 || Boolean(working)} onClick={commitResult}>Commit result fingerprint</button>
            <Status tone="warn">A private reveal backup downloads automatically. Keep it until the public reveal is confirmed.</Status>
          </> : <Status>Only {shortDid(experiment.claim!.did)} can publish the result commitment.</Status>}
        </section>}

        {experiment.status === "committed" && <section className="panel wide proof-role-card">
          <p className="eyebrow">WORKER ROLE / PUBLIC REVEAL</p>
          <h2>The result fingerprint is sealed</h2>
          <div className="did-block"><span>RESULT SHA-256</span><code>{experiment.commit?.event.result_sha256}</code></div>
          {isWorker ? <>
            <input ref={revealInput} type="file" accept=".json,application/json" hidden onChange={(event) => selectFile(event, (file) => void loadRevealFile(file))} />
            <div className="button-row"><button className="button primary" disabled={!privateReveal || Boolean(working)} onClick={revealResult}>Reveal committed result</button><button className="button" onClick={() => revealInput.current?.click()}>Load private reveal backup</button>{privateReveal && <button className="button" onClick={() => downloadText(`${privateReveal.challenge_id}-PRIVATE-reveal-backup.json`, prettyJson(privateReveal))}>Download backup again</button>}</div>
          </> : <Status>The claimed worker must reveal the exact result and salt that produced this fingerprint.</Status>}
        </section>}

        {experiment.reveal && <section className="panel wide proof-result-card">
          <p className="eyebrow">PUBLIC RESULT</p>
          <h2>Commitment matched</h2>
          <pre>{experiment.reveal.event.result}</pre>
          <div className="proof-specs"><code>MODEL  {String(experiment.commit?.event.declared_model)}</code><code>COMPUTE  {String(experiment.commit?.event.declared_compute_gflop)} GFLOP</code><code>RUNTIME  {String(experiment.commit?.event.runtime_seconds)} SEC</code></div>
        </section>}

        {experiment.reveal && experiment.status !== "validated" && experiment.status !== "contested" && <section className="panel wide proof-role-card">
          <p className="eyebrow">VALIDATOR ROLE</p>
          <h2>{canValidate ? "Check the result independently" : "Waiting for independent validator DIDs"}</h2>
          {canValidate ? <>
            <div className="two-col"><Field label="Verdict"><select value={verdict} onChange={(event) => setVerdict(event.target.value as ValidatorVerdict)}><option value="pass">Pass</option><option value="fail">Fail</option><option value="uncertain">Uncertain</option></select></Field><Field label="Public validation note"><input value={validatorNote} onChange={(event) => setValidatorNote(event.target.value)} /></Field></div>
            <button className="button primary" disabled={!identityReady || !serviceOnline || Boolean(working)} onClick={validateResult}>Sign validator decision</button>
          </> : <Status>The requester and worker cannot validate their own result. Load a third DID in another browser session.</Status>}
        </section>}

        {experiment.validations.length > 0 && <section className="panel wide">
          <p className="eyebrow">VALIDATOR DECISIONS</p>
          <div className="validator-list">{experiment.validations.map((validation) => <article key={validation.did}><span className={`verdict ${validation.verdict}`}>{validation.verdict.toUpperCase()}</span><code>{validation.did}</code><p>{validation.note}</p><small>Technocore sequence {String(validation.seq ?? "unknown")}</small></article>)}</div>
        </section>}

        {(experiment.status === "validated" || experiment.status === "contested") && <section className="panel wide proof-finalize">
          <p className="eyebrow">REQUESTER ROLE / FINAL RECEIPT</p>
          <h2>{isRequester ? "Finalize the portable work record" : "The requester can now finalize the receipt"}</h2>
          <p>The JSON receipt carries the task, result fingerprint, validator decisions, Technocore evidence, and the requester DID signature.</p>
          {isRequester && <div className="button-row"><button className="button primary" disabled={Boolean(working)} onClick={finalizeReceipt}>Create signed public receipt</button>{receiptPackage && <><button className="button" onClick={() => downloadText(receiptPackage.filename, receiptPackage.receiptText)}>Download public receipt JSON</button><button className="button" onClick={downloadCertificate}>Download public certificate PNG</button><button className="button" disabled={!serviceOnline} onClick={publishReceipt}>Publish receipt fingerprint</button></>}</div>}
          {receiptPackage && <Status tone="good">Receipt SHA-256  {receiptPackage.receiptSha256}</Status>}
        </section>}
      </>}

      <section className="panel wide proof-audit">
        <p className="eyebrow">PUBLIC AUDIT TRAIL</p>
        <h2>Accepted protocol events</h2>
        {!experiment.challenge ? <Status>No experiment loaded.</Status> : <div className="proof-timeline">{[
          experiment.challenge,
          experiment.claim,
          experiment.commit,
          experiment.reveal,
          ...experiment.validations,
        ].filter(Boolean).map((record) => <article key={`${record!.event.action}-${record!.did}`}><span>{record!.event.action.toUpperCase()}</span><code>{shortDid(record!.did)}</code><small>SEQ {String(record!.seq ?? "unknown")}</small></article>)}</div>}
      </section>

      <section className="panel wide proof-verify">
        <p className="eyebrow">PUBLIC VERIFIER</p>
        <h2>Verify a downloaded work receipt</h2>
        <p>This checks the requester DID signature and detects any change to the JSON receipt.</p>
        <input ref={receiptInput} type="file" accept=".json,application/json" hidden onChange={(event) => selectFile(event, (file) => void verifyReceiptFile(file))} />
        <button className="button" onClick={() => receiptInput.current?.click()}>Choose public receipt JSON</button>
        {receiptVerification && <Status tone="good">{receiptVerification}</Status>}
      </section>
    </div>
  );
}
