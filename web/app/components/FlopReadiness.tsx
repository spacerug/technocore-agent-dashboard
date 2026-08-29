"use client";

import { useEffect, useState } from "react";
import { BrowserIdentity } from "../lib/browser-crypto";
import {
  calculateTestnetSpendPlan,
  createTestnetSessionDraft,
  DEFAULT_TESTNET_SPEND_PLAN,
  DevelopmentInferenceSummary,
  FLOP_TEASER_UPDATED,
  FLOP_TEASER_URL,
  inferenceActivityKey,
  parseDevelopmentInference,
  parseTestnetSpendPlan,
  summarizeDevelopmentInference,
  testnetSpendPlanKey,
  TestnetSessionDraftInput,
  TestnetSpendPlanInput,
} from "../lib/flop-readiness";

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
};

function amount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const DEFAULT_SESSION_DRAFT: TestnetSessionDraftInput = {
  taskLabel: "Useful inference request",
  modelWeightsIndex: "awaiting-official-model-index",
  maximumLatencyMs: 30_000,
  computeFlops: "1000000000",
  confidentiality: false,
  maximumFeeFlop: "3",
};

export default function FlopReadiness({ identity, identityReady }: Props) {
  const [plan, setPlan] = useState<TestnetSpendPlanInput>({ ...DEFAULT_TESTNET_SPEND_PLAN });
  const [sessionDraft, setSessionDraft] = useState<TestnetSessionDraftInput>({ ...DEFAULT_SESSION_DRAFT });
  const [draftNotice, setDraftNotice] = useState("The unpublished model index is clearly marked as a placeholder. Replace it when FLOP publishes the official value.");
  const [draftNoticeTone, setDraftNoticeTone] = useState<"muted" | "warn" | "good">("muted");
  const [developmentSummary, setDevelopmentSummary] = useState<DevelopmentInferenceSummary>(() => summarizeDevelopmentInference([]));

  useEffect(() => {
    const update = () => {
      if (!identity) return setDevelopmentSummary(summarizeDevelopmentInference([]));
      setDevelopmentSummary(summarizeDevelopmentInference(parseDevelopmentInference(window.localStorage.getItem(inferenceActivityKey(identity.did)))));
    };
    const initialTimer = window.setTimeout(update, 0);
    window.addEventListener("neoncore:inference-activity", update);
    window.addEventListener("storage", update);
    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener("neoncore:inference-activity", update);
      window.removeEventListener("storage", update);
    };
  }, [identity]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPlan(identity ? parseTestnetSpendPlan(window.localStorage.getItem(testnetSpendPlanKey(identity.did))) : { ...DEFAULT_TESTNET_SPEND_PLAN });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [identity]);

  function updatePlan<K extends keyof TestnetSpendPlanInput>(key: K, value: TestnetSpendPlanInput[K]): void {
    setPlan((current) => {
      const next = { ...current, [key]: value };
      if (identity) window.localStorage.setItem(testnetSpendPlanKey(identity.did), JSON.stringify(next));
      return next;
    });
  }

  function updateSessionDraft<K extends keyof TestnetSessionDraftInput>(key: K, value: TestnetSessionDraftInput[K]): void {
    setSessionDraft((current) => ({ ...current, [key]: value }));
    setDraftNoticeTone("muted");
    setDraftNotice("Draft changed locally. Download a new preparation kit when the required fields are complete.");
  }

  function downloadPreparationKit(): void {
    if (!identity || !identityReady) {
      setDraftNoticeTone("warn");
      return setDraftNotice("Load and back up the owner identity before creating an owner-bound preparation kit.");
    }
    try {
      const requestDraft = createTestnetSessionDraft(identity.did, sessionDraft);
      const summary = calculateTestnetSpendPlan(plan);
      downloadJson("neoncore-flop-testnet-preparation-kit.json", {
        schema_version: "neoncore.flop-testnet-preparation-kit.v1",
        scope: "planning_only_not_submitted",
        owner_did: identity.did,
        official_reference: FLOP_TEASER_URL,
        official_draft_updated: FLOP_TEASER_UPDATED,
        spend_plan: { input: plan, summary },
        session_draft: requestDraft,
        adapter_requirements: [
          "chain_id",
          "rpc_endpoint",
          "account_and_signing_format",
          "faucet_endpoint_and_claim_rules",
          "model_weights_index",
          "session_submission_schema",
          "verified_spend_receipt_schema",
          "explorer_or_receipt_verification_endpoint",
        ],
      });
      setDraftNoticeTone("good");
      setDraftNotice("Preparation kit downloaded. It contains no private key and does not claim testnet credit.");
    } catch (error) {
      setDraftNoticeTone("warn");
      setDraftNotice(error instanceof Error ? error.message : "The session draft is incomplete.");
    }
  }

  const summary = calculateTestnetSpendPlan(plan);

  return <div className="page-grid flop-readiness-page">
    <section className="flop-status-strip wide" aria-label="FLOP testnet readiness status">
      <div><span>NETWORK STATE</span><strong>Q4 2026 PLANNED</strong></div>
      <div><span>ELIGIBLE FLOP SPEND</span><strong>0 CONFIRMED</strong></div>
      <div><span>OWNER IDENTITY</span><strong>{identityReady ? "DID READY" : "LOAD DID FIRST"}</strong></div>
      <div><span>LIVE ADAPTER</span><strong>AWAITING SPEC</strong></div>
    </section>

    <div className="page-heading">
      <p className="eyebrow">STEP 08 / FLOP TESTNET MISSION CONTROL</p>
      <h1>Prepare to claim faucet tokens and buy useful inference.</h1>
      <p>The draft makes agent participation measurable: claim test tokens, spend them on real inference, and retain verifiable network receipts. NEONCORE prepares the budget and request shape now without pretending development calls are eligible.</p>
    </div>

    <section className="panel wide flop-fact-panel">
      <p className="eyebrow">OFFICIAL TEASER / SECTION 04 / UPDATED {FLOP_TEASER_UPDATED}</p>
      <h2>What the current draft actually rewards</h2>
      <div className="flop-fact-grid">
        <article><span>TESTNET</span><strong>Roughly 90 days</strong><p>FLOP plans a full Q4 2026 rehearsal using test tokens.</p></article>
        <article><span>AGENT ACTION</span><strong>Claim and spend</strong><p>Agents claim faucet tokens and buy inference from miners.</p></article>
        <article><span>AIRDROP BASIS</span><strong>Largely inference spend</strong><p>The draft mentions additional prizes but does not define them yet.</p></article>
        <article><span>UNLOCK RULE</span><strong>3 spent unlocks 1</strong><p>Three FLOP spent on inference unlocks one airdropped FLOP.</p></article>
      </div>
      <div className="status-line warn">Draft v0.1 is provisional. The Yellow Paper, chain parameters, faucet rules, official model index, and receipt format are not final.</div>
      <a className="button link-button" href={FLOP_TEASER_URL} target="_blank" rel="noreferrer">Read official Section 04</a>
    </section>

    <section className="panel wide flop-planner-panel">
      <p className="eyebrow">90-DAY FAUCET SPEND PLANNER</p>
      <h2>Plan useful inference without losing the budget</h2>
      <p>Enter hypothetical testnet values now. Your plan is stored only in this browser under the loaded DID and never counted as confirmed FLOP activity.</p>
      <div className="flop-planner-fields">
        <label className="field"><span>Expected faucet balance</span><input type="number" min="0" step="1" value={plan.faucetBalance} onChange={(event) => updatePlan("faucetBalance", Math.max(0, Number(event.target.value) || 0))} /></label>
        <label className="field"><span>Planned inference spend</span><input type="number" min="0" step="1" value={plan.plannedSpend} onChange={(event) => updatePlan("plannedSpend", Math.max(0, Number(event.target.value) || 0))} /></label>
        <label className="field"><span>Average session fee</span><input type="number" min="0.000001" step="0.1" value={plan.averageSessionFee} onChange={(event) => updatePlan("averageSessionFee", Math.max(0.000001, Number(event.target.value) || 0.000001))} /></label>
        <label className="field"><span>Campaign days</span><input type="number" min="1" max="365" step="1" value={plan.campaignDays} onChange={(event) => updatePlan("campaignDays", Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1))))} /></label>
        <label className="field"><span>Hypothetical locked allocation</span><input type="number" min="0" step="1" value={plan.lockedAllocation} onChange={(event) => updatePlan("lockedAllocation", Math.max(0, Number(event.target.value) || 0))} /></label>
      </div>
      <div className="flop-plan-results">
        <div><span>DAILY SPEND TARGET</span><strong>{amount(summary.dailySpendTarget)} FLOP</strong></div>
        <div><span>ESTIMATED SESSIONS</span><strong>{summary.estimatedSessions.toLocaleString()}</strong></div>
        <div><span>UNUSED FAUCET</span><strong>{amount(summary.unusedFaucetBalance)} FLOP</strong></div>
        <div><span>UNFUNDED PLAN</span><strong>{amount(summary.unfundedSpend)} FLOP</strong></div>
        <div><span>UNLOCK CAPACITY</span><strong>{amount(summary.unlockCapacity)} FLOP</strong></div>
        <div><span>PROJECTED UNLOCK</span><strong>{amount(summary.projectedUnlock)} FLOP</strong></div>
      </div>
      <div className="status-line muted">{amount(summary.additionalSpendToUnlockAllocation)} additional FLOP of inference spend would be required to unlock the remaining hypothetical allocation. This is draft arithmetic, not an allocation estimate.</div>
    </section>

    <section className="panel wide flop-session-panel">
      <p className="eyebrow">SESSION REQUEST PREPARATION</p>
      <h2>Build the five fields FLOP says a request will carry</h2>
      <p>This creates a local, owner-bound JSON draft containing the model weights index, maximum latency, compute amount, confidentiality choice, and maximum fee. It cannot submit or spend tokens until official endpoints exist.</p>
      <div className="two-col">
        <label className="field"><span>Task label</span><input value={sessionDraft.taskLabel} maxLength={120} onChange={(event) => updateSessionDraft("taskLabel", event.target.value)} /></label>
        <label className="field"><span>Model weights index or hash</span><input value={sessionDraft.modelWeightsIndex} maxLength={256} placeholder="Add the official model index when published" onChange={(event) => updateSessionDraft("modelWeightsIndex", event.target.value)} /></label>
        <label className="field"><span>Maximum latency, milliseconds</span><input type="number" min="1" max="86400000" step="1" value={sessionDraft.maximumLatencyMs} onChange={(event) => updateSessionDraft("maximumLatencyMs", Number(event.target.value) || 0)} /></label>
        <label className="field"><span>Compute, FLOPs</span><input inputMode="numeric" value={sessionDraft.computeFlops} onChange={(event) => updateSessionDraft("computeFlops", event.target.value.replace(/\D/g, ""))} /></label>
        <label className="field"><span>Confidentiality</span><select value={sessionDraft.confidentiality ? "private" : "public"} onChange={(event) => updateSessionDraft("confidentiality", event.target.value === "private")}><option value="public">Public session</option><option value="private">Confidential session</option></select></label>
        <label className="field"><span>Maximum fee, FLOP</span><input inputMode="decimal" value={sessionDraft.maximumFeeFlop} onChange={(event) => updateSessionDraft("maximumFeeFlop", event.target.value)} /></label>
      </div>
      <div className="button-row"><button className="button primary" disabled={!identityReady} onClick={downloadPreparationKit}>Download testnet preparation kit</button></div>
      <div className={`status-line ${draftNoticeTone}`}>{draftNotice}</div>
    </section>

    <section className="panel wide flop-development-panel">
      <p className="eyebrow">DEVELOPMENT INFERENCE METER</p>
      <h2>Real model use, zero claimed FLOP credit</h2>
      <div className="flop-meter-grid">
        <div><span>MODEL CALLS</span><strong>{developmentSummary.calls.toLocaleString()}</strong></div>
        <div><span>INPUT TOKENS</span><strong>{developmentSummary.inputTokens.toLocaleString()}</strong></div>
        <div><span>OUTPUT TOKENS</span><strong>{developmentSummary.outputTokens.toLocaleString()}</strong></div>
        <div><span>TOTAL TOKENS</span><strong>{developmentSummary.totalTokens.toLocaleString()}</strong></div>
      </div>
      <p>These counters come from owner-authorized Control Chamber responses saved in this browser. They demonstrate that NEONCORE consumes inference, but they are off-network development activity and do not count toward the FLOP testnet airdrop.</p>
    </section>

    <section className="panel wide">
      <p className="eyebrow">LAUNCH INTEGRATION CHECKLIST</p>
      <h2>Ready now, blocked only where the specification is missing</h2>
      <div className="flop-readiness-grid">
        <article className="ready"><span>READY</span><strong>Sovereign agent identity</strong><p>Local DID keys, owner authorization, and public DID discovery are operational.</p></article>
        <article className="ready"><span>READY</span><strong>Session request shape</strong><p>NEONCORE can prepare the five fields named in the teaser without claiming submission.</p></article>
        <article className="ready"><span>READY</span><strong>Budget and spend limits</strong><p>A 90-day plan, reply caps, cooldowns, session limits, and emergency stop are available.</p></article>
        <article className="waiting"><span>WAITING</span><strong>Faucet adapter</strong><p>The official claim endpoint, amount, cadence, and DID or account binding rules are unpublished.</p></article>
        <article className="waiting"><span>WAITING</span><strong>Inference adapter</strong><p>Chain ID, RPC, account format, model index, and session submission schema remain unpublished.</p></article>
        <article className="waiting"><span>WAITING</span><strong>Receipt verifier</strong><p>Only an official transaction or session receipt will be allowed to increase eligible spend above zero.</p></article>
      </div>
    </section>

    <section className="panel wide flop-boundary-panel">
      <p className="eyebrow">AIRDROP ACCURACY BOUNDARY</p>
      <h2>Useful inference first, verifiable spend always</h2>
      <p>Technocore lobby messages, DID notes, weekly continuity records, Proof Lab experiments, preparation files, and current development calls do not become eligible testnet spend merely because NEONCORE records them. Only officially verified FLOP inference sessions will count after the network publishes its adapter and receipt rules.</p>
    </section>
  </div>;
}
