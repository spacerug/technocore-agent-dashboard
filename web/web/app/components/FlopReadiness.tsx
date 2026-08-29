"use client";

import { useEffect, useState } from "react";
import { BrowserIdentity } from "../lib/browser-crypto";
import {
  FLOP_TEASER_URL,
  inferenceActivityKey,
  parseDevelopmentInference,
  projectedAirdropUnlock,
  DevelopmentInferenceSummary,
  summarizeDevelopmentInference,
} from "../lib/flop-readiness";

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
};

function amount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

export default function FlopReadiness({ identity, identityReady }: Props) {
  const [plannedSpend, setPlannedSpend] = useState(300);
  const [lockedAllocation, setLockedAllocation] = useState(100);
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
  const projectedUnlock = projectedAirdropUnlock(plannedSpend, lockedAllocation);

  return <div className="page-grid flop-readiness-page">
    <section className="flop-status-strip wide" aria-label="FLOP testnet readiness status">
      <div><span>NETWORK STATE</span><strong>AWAITING OFFICIAL TESTNET</strong></div>
      <div><span>ELIGIBLE FLOP SPEND</span><strong>0 CONFIRMED</strong></div>
      <div><span>IDENTITY</span><strong>{identityReady ? "DID READY" : "LOAD DID FIRST"}</strong></div>
    </section>

    <div className="page-heading">
      <p className="eyebrow">STEP 08 / FLOP INFERENCE READINESS</p>
      <h1>Prepare for the metric FLOP actually announced.</h1>
      <p>The current draft says agents earn through testnet inference consumption. NEONCORE now measures development inference honestly while waiting for the official testnet interfaces.</p>
    </div>

    <section className="panel wide flop-fact-panel">
      <p className="eyebrow">OFFICIAL TEASER / SECTION 04</p>
      <h2>What the current draft says</h2>
      <div className="flop-fact-grid">
        <article><span>TESTNET</span><strong>Q4 2026</strong><p>Planned to run for roughly 90 days.</p></article>
        <article><span>AGENT ACTION</span><strong>Claim and spend</strong><p>Agents claim test tokens and spend them on inference.</p></article>
        <article><span>AIRDROP BASIS</span><strong>Largely inference spend</strong><p>The draft also mentions various prizes.</p></article>
        <article><span>UNLOCK RULE</span><strong>3 spent unlocks 1</strong><p>Three FLOP spent on inference unlocks one airdropped FLOP.</p></article>
      </div>
      <div className="status-line warn">Draft v0.1 is provisional. The Yellow Paper, chain parameters, faucet rules, and integration format are not final.</div>
      <a className="button link-button" href={FLOP_TEASER_URL} target="_blank" rel="noreferrer">Read official Section 04</a>
    </section>

    <section className="panel flop-development-panel">
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

    <section className="panel flop-calculator-panel">
      <p className="eyebrow">DRAFT UNLOCK CALCULATOR</p>
      <h2>Model the stated 3-to-1 rule</h2>
      <div className="two-col">
        <label className="field"><span>FLOP spent on inference</span><input type="number" min="0" step="1" value={plannedSpend} onChange={(event) => setPlannedSpend(Math.max(0, Number(event.target.value) || 0))} /></label>
        <label className="field"><span>Locked airdrop allocation</span><input type="number" min="0" step="1" value={lockedAllocation} onChange={(event) => setLockedAllocation(Math.max(0, Number(event.target.value) || 0))} /></label>
      </div>
      <div className="flop-unlock-result"><span>PROJECTED UNLOCK</span><strong>{amount(projectedUnlock)} FLOP</strong><p>{amount(Math.max(0, lockedAllocation - projectedUnlock))} FLOP would remain locked.</p></div>
      <div className="status-line muted">This is arithmetic from the draft teaser, not an allocation estimate, reward promise, or live network result.</div>
    </section>

    <section className="panel wide">
      <p className="eyebrow">INTEGRATION READINESS</p>
      <h2>What NEONCORE has ready, and what must wait</h2>
      <div className="flop-readiness-grid">
        <article className="ready"><span>READY</span><strong>Sovereign agent identity</strong><p>Local DID keys and owner authorization are already operational.</p></article>
        <article className="ready"><span>READY</span><strong>Useful inference workflow</strong><p>Public requests, bounded agent replies, validation, and portable receipts already exist.</p></article>
        <article className="ready"><span>READY</span><strong>Spend protections</strong><p>Cooldowns, reply caps, session limits, review mode, and emergency stop are already enforced.</p></article>
        <article className="waiting"><span>WAITING</span><strong>Official network adapter</strong><p>Chain ID, RPC, faucet, wallet format, model index, session schema, and verified spend receipt are not published yet.</p></article>
      </div>
    </section>

    <section className="panel wide flop-boundary-panel">
      <p className="eyebrow">AIR DROP ACCURACY BOUNDARY</p>
      <h2>No fake credit, no check-in farming claim</h2>
      <p>Technocore lobby messages, weekly continuity records, Proof Lab experiments, and current development model calls may demonstrate useful project work, but the teaser does not identify them as the primary agent allocation metric. NEONCORE will label eligible spend only after an official FLOP testnet session is verified.</p>
    </section>
  </div>;
}
