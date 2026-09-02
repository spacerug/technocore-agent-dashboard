"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  PaperRail,
  dealRoom,
  encodeFrame,
  lockTerms,
  validateFrame,
  verifySecret,
  type ContractState,
  type NoteStore,
  type TclkFrame,
} from "@flop-labs/tclk";
import { BrowserIdentity, downloadText, shortDid, signBytes } from "../lib/browser-crypto";
import {
  TCLK_CHANGELOG_URL,
  TCLK_OFFER_ROOM,
  TCLK_RELEASE,
  TCLK_SPEC_URL,
  auditTclkDeal,
  createPaperOffer,
  paperNoteAuthorizationText,
  parseTclkRecovery,
  preparePaperAccept,
  receiptForVerifiedState,
  scanTclkOfferBoard,
  tclkPublicExport,
  type PaperNoteCondition,
  type TclkAudit,
  type TclkBoardDeal,
  type TclkBoardOffer,
  type TclkBoardScan,
  type TclkRecovery,
  type TclkRoomMessage,
} from "../lib/tclk-deal";

type Notice = { tone: "good" | "warn" | "bad"; text: string };

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
  serviceOnline: boolean;
  publishSigned: (room: string, text: string) => Promise<unknown>;
  readRoomMessages: (room: string) => Promise<TclkRoomMessage[]>;
  onNotice: (notice: Notice) => void;
};

type PendingAccept = {
  offer: TclkBoardOffer;
  accept: Extract<TclkFrame, { type: "accept" }>;
  recovery: TclkRecovery;
};

const EMPTY_BOARD: TclkBoardScan = { offers: [], deals: [], rejected: [] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The TCLK operation failed.";
}

async function apiJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error ?? `Request failed with HTTP ${response.status}.`));
  return payload;
}

function recoveryFilename(contract: string): string {
  return `PRIVATE-tclk-recovery-${contract.slice(2, 18)}.json`;
}

function transcriptFilename(contract: string): string {
  return `tclk-public-transcript-${contract.slice(2, 18)}.json`;
}

function fileFromEvent(event: ChangeEvent<HTMLInputElement>): File | null {
  return event.target.files?.[0] ?? null;
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleString();
}

function stateTone(status: ContractState["status"]): string {
  if (status === "claimed") return "good";
  if (status === "refunded" || status === "cancelled") return "warn";
  return "active";
}

function makePaperNoteStore(identity: BrowserIdentity): NoteStore {
  return {
    async get(ns, key) {
      const payload = await apiJson(`/api/technocore?action=tclk_paper_get&ns=${encodeURIComponent(ns)}&key=${encodeURIComponent(key)}`);
      return typeof payload.value === "string" ? payload.value : null;
    },
    async set(ns, key, value, condition?: PaperNoteCondition) {
      const nonce = Date.now();
      const authorization = paperNoteAuthorizationText({ did: identity.did, nonce, ns, key, value, condition });
      const sig = await signBytes(identity, new TextEncoder().encode(authorization));
      const payload = await apiJson("/api/technocore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tclk_paper_set",
          did: identity.did,
          nonce,
          ns,
          key,
          value,
          condition: condition === undefined ? null : "ifAbsent" in condition ? { if_absent: true } : { if: condition.if },
          sig,
        }),
      });
      return payload.applied === true;
    },
  };
}

export default function TclkDealLab({
  identity,
  identityReady,
  serviceOnline,
  publishSigned,
  readRoomMessages,
  onNotice,
}: Props) {
  const [board, setBoard] = useState<TclkBoardScan>(EMPTY_BOARD);
  const [boardMeta, setBoardMeta] = useState("Offer board not loaded.");
  const [selectedContract, setSelectedContract] = useState("");
  const [audit, setAudit] = useState<TclkAudit | null>(null);
  const [busy, setBusy] = useState("");
  const [amount, setAmount] = useState("100");
  const [taskId, setTaskId] = useState("neoncore-useful-task-001");
  const [taskContext, setTaskContext] = useState("PaperRail rehearsal for a useful agent task");
  const [offerMinutes, setOfferMinutes] = useState(15);
  const [claimMinutes, setClaimMinutes] = useState(60);
  const [refundMinutes, setRefundMinutes] = useState(120);
  const [pendingAccept, setPendingAccept] = useState<PendingAccept | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [loadedRecovery, setLoadedRecovery] = useState<TclkRecovery | null>(null);
  const [clockNow, setClockNow] = useState<number | null>(null);
  const recoveryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initial = window.setTimeout(() => setClockNow(Date.now()), 0);
    const timer = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  const selectedDeal = useMemo(
    () => board.deals.find((deal) => deal.accept.frame.contract === selectedContract) ?? null,
    [board.deals, selectedContract],
  );

  async function execute(label: string, action: () => Promise<void>): Promise<void> {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      onNotice({ tone: "bad", text: errorText(error) });
    } finally {
      setBusy("");
    }
  }

  async function readDealRoom(deal: TclkBoardDeal): Promise<TclkRoomMessage[]> {
    try {
      return await readRoomMessages(deal.room);
    } catch (error) {
      if (/404|not found/i.test(errorText(error))) return [];
      throw error;
    }
  }

  async function loadDealAudit(deal: TclkBoardDeal): Promise<TclkAudit> {
    const messages = await readDealRoom(deal);
    const next = auditTclkDeal(deal, messages);
    setSelectedContract(deal.accept.frame.contract);
    setAudit(next);
    return next;
  }

  async function refreshBoard(targetContract = selectedContract): Promise<{ scan: TclkBoardScan; current: TclkAudit | null }> {
    const messages = await readRoomMessages(TCLK_OFFER_ROOM);
    const scan = scanTclkOfferBoard(messages);
    setBoard(scan);
    setBoardMeta(`${scan.offers.length} valid offer(s), ${scan.deals.length} accepted deal(s), ${scan.rejected.length} rejected TCLK frame(s).`);
    const target = scan.deals.find((deal) => deal.accept.frame.contract === targetContract);
    const current = target ? await loadDealAudit(target) : null;
    if (!target && targetContract) {
      setSelectedContract("");
      setAudit(null);
    }
    return { scan, current };
  }

  async function createOffer(): Promise<void> {
    await execute("Publishing TCLK offer", async () => {
      if (!identity || !identityReady) throw new Error("Load and back up a DID before creating a TCLK offer.");
      if (!serviceOnline) throw new Error("Connect to Technocore before creating a TCLK offer.");
      const offer = createPaperOffer(identity.did, {
        amount,
        taskId,
        taskContext,
        offerMinutes,
        claimMinutes,
        refundMinutes,
      });
      await publishSigned(TCLK_OFFER_ROOM, encodeFrame(offer));
      await refreshBoard();
      onNotice({ tone: "good", text: `TCLK offer ${offer.id.slice(0, 18)}... was confirmed in ${TCLK_OFFER_ROOM}. It is a PaperRail simulation and moves no value.` });
    });
  }

  function prepareAccept(offer: TclkBoardOffer): void {
    if (!identity || !identityReady) return onNotice({ tone: "bad", text: "Load and back up the accepting DID first." });
    try {
      const prepared = preparePaperAccept(offer.frame, identity.did);
      downloadText(recoveryFilename(prepared.accept.contract), prepared.recoveryText);
      setPendingAccept({ offer, accept: prepared.accept, recovery: prepared.recovery });
      setLoadedRecovery(prepared.recovery);
      setRecoveryAcknowledged(false);
      onNotice({ tone: "warn", text: "Private recovery downloaded. Store it safely, confirm the checkbox, then publish the accept frame. Never share this file before reveal." });
    } catch (error) {
      onNotice({ tone: "bad", text: errorText(error) });
    }
  }

  async function publishAccept(): Promise<void> {
    await execute("Publishing TCLK accept", async () => {
      if (!identity || !pendingAccept) throw new Error("Prepare an accept and its private recovery first.");
      if (!recoveryAcknowledged) throw new Error("Confirm that the private recovery file was saved before publishing accept.");
      if (identity.did !== pendingAccept.recovery.owner_did) throw new Error("The loaded DID does not own this prepared accept.");
      await publishSigned(TCLK_OFFER_ROOM, encodeFrame(pendingAccept.accept));
      const contract = pendingAccept.accept.contract;
      setPendingAccept(null);
      setRecoveryAcknowledged(false);
      await refreshBoard(contract);
      onNotice({ tone: "good", text: `Accept confirmed. Deal room ${dealRoom(contract)} is ready for the payer's PaperRail lock.` });
    });
  }

  async function openDeal(deal: TclkBoardDeal): Promise<void> {
    await execute("Verifying deal transcript", async () => {
      const next = await loadDealAudit(deal);
      onNotice({ tone: next.rejected.length ? "warn" : "good", text: `Deal transcript verified to ${next.state.status}. ${next.rejected.length} conflicting or invalid frame(s) were ignored.` });
    });
  }

  async function currentVerifiedDeal(): Promise<{ deal: TclkBoardDeal; current: TclkAudit }> {
    if (!selectedDeal) throw new Error("Select an accepted deal first.");
    const current = await loadDealAudit(selectedDeal);
    return { deal: selectedDeal, current };
  }

  async function publishLock(): Promise<void> {
    await execute("Recording PaperRail lock", async () => {
      if (!identity) throw new Error("Load the payer DID first.");
      const { deal, current } = await currentVerifiedDeal();
      if (current.state.status !== "accepted") throw new Error(`The verified deal is ${current.state.status}, not accepted.`);
      if (current.state.payerDid !== identity.did) throw new Error("Only the payer DID can publish the lock.");
      const terms = lockTerms(current.state);
      const rail = new PaperRail(makePaperNoteStore(identity));
      const alreadyRecorded = await rail.verifyLock(terms, terms.contract);
      const ref = alreadyRecorded ? terms.contract : await rail.lock(terms);
      const frame = validateFrame({ type: "lock", from: identity.did, contract: terms.contract, rail: "paper", ref });
      await publishSigned(deal.room, encodeFrame(frame));
      await loadDealAudit(deal);
      onNotice({ tone: "good", text: "PaperRail lock rehearsal confirmed. This record holds no funds and proves no payment." });
    });
  }

  async function publishReveal(): Promise<void> {
    await execute("Revealing and claiming PaperRail", async () => {
      if (!identity || !loadedRecovery) throw new Error("Load the payee DID and its private TCLK recovery file first.");
      const { deal, current } = await currentVerifiedDeal();
      if (current.state.status !== "locked") throw new Error(`The verified deal is ${current.state.status}, not locked.`);
      if (current.state.payeeDid !== identity.did || loadedRecovery.owner_did !== identity.did) throw new Error("The loaded DID does not own this deal's recovery secret.");
      if (loadedRecovery.contract_id !== current.state.contract || loadedRecovery.statement !== current.state.statement) throw new Error("The recovery file belongs to a different contract.");
      if (!verifySecret("hash", current.state.statement!, loadedRecovery.preimage)) throw new Error("The recovery secret does not open this contract.");
      const rail = new PaperRail(makePaperNoteStore(identity));
      const record = await rail.read(current.state.contract!);
      if (!(record?.status === "claimed" && record.secret === loadedRecovery.preimage)) {
        await rail.claim(current.state.contract!, loadedRecovery.preimage);
      }
      const frame = validateFrame({ type: "reveal", from: identity.did, contract: current.state.contract, secret: loadedRecovery.preimage });
      await publishSigned(deal.room, encodeFrame(frame));
      await loadDealAudit(deal);
      onNotice({ tone: "good", text: "Reveal confirmed and the PaperRail rehearsal reached claimed. The revealed secret is now public by protocol design." });
    });
  }

  async function publishRefund(): Promise<void> {
    await execute("Refunding PaperRail rehearsal", async () => {
      if (!identity) throw new Error("Load the payer DID first.");
      const { deal, current } = await currentVerifiedDeal();
      if (current.state.status !== "locked") throw new Error(`The verified deal is ${current.state.status}, not locked.`);
      if (current.state.payerDid !== identity.did) throw new Error("Only the payer DID can publish the refund.");
      if (Date.now() < current.state.offer.refundAfterMs) throw new Error(`Refund is locked until ${timeLabel(current.state.offer.refundAfterMs)}.`);
      const rail = new PaperRail(makePaperNoteStore(identity));
      const record = await rail.read(current.state.contract!);
      if (record?.status !== "refunded") await rail.refund(current.state.contract!);
      const frame = validateFrame({ type: "refund", from: identity.did, contract: current.state.contract, reason: "PaperRail refund deadline reached" });
      await publishSigned(deal.room, encodeFrame(frame));
      await loadDealAudit(deal);
      onNotice({ tone: "good", text: "Refund frame confirmed. PaperRail moved no value." });
    });
  }

  async function publishCancel(): Promise<void> {
    await execute("Cancelling TCLK deal", async () => {
      if (!identity) throw new Error("Load a contract party DID first.");
      const { deal, current } = await currentVerifiedDeal();
      if (current.state.status !== "proposed" && current.state.status !== "accepted") throw new Error(`A ${current.state.status} deal cannot be cancelled.`);
      const frame = validateFrame({ type: "cancel", from: identity.did, contract: current.state.contract, reason: "Cancelled by contract party" });
      await publishSigned(deal.room, encodeFrame(frame));
      await loadDealAudit(deal);
      onNotice({ tone: "good", text: "Cancellation confirmed in the public deal transcript." });
    });
  }

  async function publishReceipt(): Promise<void> {
    await execute("Publishing verified TCLK receipt", async () => {
      if (!identity) throw new Error("Load a contract party DID first.");
      const { deal, current } = await currentVerifiedDeal();
      const frame = receiptForVerifiedState(current.state, identity.did);
      await publishSigned(deal.room, encodeFrame(frame));
      await loadDealAudit(deal);
      onNotice({ tone: "good", text: `Receipt confirmed with outcome ${frame.outcome}. NEONCORE independently matched it to the terminal state.` });
    });
  }

  async function loadRecovery(file: File): Promise<void> {
    try {
      const recovery = parseTclkRecovery(await file.text());
      if (identity && recovery.owner_did !== identity.did) throw new Error("This recovery file belongs to a different DID.");
      setLoadedRecovery(recovery);
      onNotice({ tone: "good", text: `Private recovery verified for contract ${recovery.contract_id.slice(0, 18)}... The secret remains inside this browser.` });
    } catch (error) {
      onNotice({ tone: "bad", text: errorText(error) });
    }
  }

  function downloadTranscript(): void {
    if (!selectedDeal || !audit?.state.contract) return;
    downloadText(transcriptFilename(audit.state.contract), tclkPublicExport(selectedDeal, audit));
    onNotice({ tone: "good", text: "Public TCLK transcript exported. It contains no unrevealed recovery secret." });
  }

  const acceptedOfferIds = new Set(board.deals.map((deal) => deal.offer.frame.id));
  const selectedState = audit?.state;
  const canLock = Boolean(identity && selectedState?.status === "accepted" && selectedState.payerDid === identity.did);
  const canReveal = Boolean(identity && loadedRecovery && selectedState?.status === "locked" && selectedState.payeeDid === identity.did && loadedRecovery.contract_id === selectedState.contract);
  const canRefund = Boolean(identity && clockNow !== null && selectedState?.status === "locked" && selectedState.payerDid === identity.did && clockNow >= selectedState.offer.refundAfterMs);
  const canCancel = Boolean(identity && selectedState && ["proposed", "accepted"].includes(selectedState.status) && (selectedState.payerDid === identity.did || selectedState.payeeDid === identity.did));
  const canReceipt = Boolean(identity && selectedState && ["claimed", "refunded", "cancelled"].includes(selectedState.status) && (selectedState.payerDid === identity.did || selectedState.payeeDid === identity.did));

  return <div className="page-grid tclk-page">
    <section className="tclk-alpha-banner wide" role="status">
      <strong>TCLK DEAL LAB</strong>
      <span>ALPHA SIMULATION ONLY</span>
      <p>PaperRail holds no funds, moves no tokens, and proves no payment.</p>
    </section>

    <div className="page-heading">
      <p className="eyebrow">STEP 08 / TECHNOCORE LOCK PROTOCOL</p>
      <h1>Rehearse verifiable agent deals before value rails arrive.</h1>
      <p>Create signed offers, accept with a locally generated hash lock, fold the public transcript through the official fail-closed state machine, and export the result.</p>
    </div>

    <section className="panel wide tclk-protocol-panel">
      <div className="tclk-protocol-head">
        <div><p className="eyebrow">OFFICIAL FLOP LABS RELEASE</p><h2>tclk/1 protocol, package {TCLK_RELEASE}</h2></div>
        <div className="tclk-release-chip">PINNED 0.1.0</div>
      </div>
      <div className="tclk-flow" aria-label="TCLK deal flow">
        {["OFFER", "ACCEPT", "LOCK", "REVEAL OR REFUND", "RECEIPT"].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></div>)}
      </div>
      <div className="status-line warn">Hash-lock PaperRail only. PTLC actions, hosted MCP dependency, wallets, and real settlement remain disabled.</div>
      <div className="button-row"><a className="button link-button" href={TCLK_SPEC_URL} target="_blank" rel="noreferrer">Official specification</a><a className="button link-button" href={TCLK_CHANGELOG_URL} target="_blank" rel="noreferrer">Official changelog</a></div>
    </section>

    <section className="panel tclk-create-panel">
      <p className="eyebrow">CREATE PAYER OFFER</p>
      <h2>Publish a useful task rehearsal</h2>
      <p>The offer is public in <code>{TCLK_OFFER_ROOM}</code>. Amounts use PAPER simulation units, never FLOP.</p>
      <div className="two-col">
        <label className="field"><span>PAPER units</span><input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ""))} /></label>
        <label className="field"><span>A2A task ID</span><input value={taskId} maxLength={200} onChange={(event) => setTaskId(event.target.value)} /></label>
      </div>
      <label className="field"><span>Public task context</span><input value={taskContext} maxLength={500} onChange={(event) => setTaskContext(event.target.value)} /></label>
      <div className="tclk-deadline-grid">
        <label className="field"><span>Offer expires, minutes</span><input type="number" min="1" value={offerMinutes} onChange={(event) => setOfferMinutes(Math.max(1, Math.round(Number(event.target.value) || 1)))} /></label>
        <label className="field"><span>Claim deadline, minutes</span><input type="number" min="2" value={claimMinutes} onChange={(event) => setClaimMinutes(Math.max(2, Math.round(Number(event.target.value) || 2)))} /></label>
        <label className="field"><span>Refund opens, minutes</span><input type="number" min="3" value={refundMinutes} onChange={(event) => setRefundMinutes(Math.max(3, Math.round(Number(event.target.value) || 3)))} /></label>
      </div>
      <button className="button primary" disabled={!identityReady || !serviceOnline || Boolean(busy)} onClick={createOffer}>Sign and publish offer</button>
    </section>

    <section className="panel tclk-board-panel">
      <p className="eyebrow">PUBLIC RENDEZVOUS</p>
      <h2>Signed offer board</h2>
      <div className="button-row"><button className="button primary" disabled={!serviceOnline || Boolean(busy)} onClick={() => void execute("Reading TCLK offer board", async () => { await refreshBoard(); onNotice({ tone: "good", text: "TCLK offer board refreshed and untrusted frames were checked." }); })}>Refresh {TCLK_OFFER_ROOM}</button></div>
      <div className="status-line muted">{busy || boardMeta}</div>
      <div className="tclk-board-list">
        {board.offers.length === 0 ? <div className="empty"><strong>No verified offers loaded</strong><p>Refresh the public offer room to begin.</p></div> : board.offers.slice(0, 20).map((offer) => {
          const accepted = acceptedOfferIds.has(offer.frame.id);
          const expired = clockNow !== null && clockNow >= offer.frame.expiresMs;
          return <article key={offer.frame.id}>
            <div className="tclk-card-top"><span className={`tclk-state ${accepted ? "good" : expired ? "warn" : "active"}`}>{accepted ? "ACCEPTED" : expired ? "EXPIRED" : "OPEN"}</span><code>SEQ {String(offer.message.seq ?? "?")}</code></div>
            <strong>{offer.frame.job?.id ?? "Unlabeled task"}</strong>
            <p>{offer.frame.job?.context ?? "No public task context."}</p>
            <div className="tclk-card-meta"><span>{offer.frame.amount} PAPER</span><span>{shortDid(offer.frame.from)}</span><span>Expires {timeLabel(offer.frame.expiresMs)}</span></div>
            <div className="button-row"><button className="button" disabled={expired || offer.frame.from === identity?.did || !identityReady || Boolean(busy)} onClick={() => prepareAccept(offer)}>Prepare private accept</button></div>
          </article>;
        })}
      </div>
    </section>

    {pendingAccept && <section className="panel wide tclk-recovery-gate">
      <p className="eyebrow">PRIVATE RECOVERY GATE</p>
      <h2>Save the secret before publishing accept</h2>
      <p>The downloaded recovery file contains the preimage needed to reveal later. NEONCORE does not upload it or keep it after this browser session.</p>
      <div className="did-block"><span>CONTRACT</span><code>{pendingAccept.accept.contract}</code></div>
      <label className="check pixel-check"><input type="checkbox" checked={recoveryAcknowledged} onChange={(event) => setRecoveryAcknowledged(event.target.checked)} /><span className="pixel-check-box" aria-hidden="true" /><span className="pixel-check-label">I stored the private recovery file safely</span></label>
      <div className="button-row"><button className="button" onClick={() => downloadText(recoveryFilename(pendingAccept.accept.contract), `${JSON.stringify(pendingAccept.recovery, null, 2)}\n`)}>Download recovery again</button><button className="button primary" disabled={!recoveryAcknowledged || Boolean(busy)} onClick={publishAccept}>Publish accept</button></div>
      <div className="status-line warn">Do not post, paste, or share the recovery file. The preimage becomes public only when you deliberately reveal.</div>
    </section>}

    <section className="panel wide tclk-deals-panel">
      <p className="eyebrow">DISCOVERED CONTRACTS</p>
      <h2>Open a deal transcript</h2>
      <div className="tclk-deal-list">
        {board.deals.length === 0 ? <div className="empty"><strong>No accepted deals loaded</strong><p>An offer and its accept must both be visible in {TCLK_OFFER_ROOM}.</p></div> : board.deals.slice(0, 20).map((deal) => <article className={selectedContract === deal.accept.frame.contract ? "selected" : ""} key={deal.accept.frame.contract}>
          <div><strong>{deal.offer.frame.job?.id ?? "TCLK deal"}</strong><code>{deal.accept.frame.contract.slice(0, 22)}...</code></div>
          <span>{shortDid(deal.offer.frame.from)} to {shortDid(deal.accept.frame.from)}</span>
          <button className="button" disabled={Boolean(busy)} onClick={() => void openDeal(deal)}>Verify deal</button>
        </article>)}
      </div>
    </section>

    {selectedDeal && audit && selectedState && <>
      <section className="panel wide tclk-inspector">
        <div className="tclk-protocol-head"><div><p className="eyebrow">FAIL-CLOSED TRANSCRIPT</p><h2>Verified state: {selectedState.status}</h2></div><div className={`tclk-release-chip ${stateTone(selectedState.status)}`}>{selectedState.status.toUpperCase()}</div></div>
        <div className="tclk-state-track">
          {["proposed", "accepted", "locked", selectedState.status === "refunded" ? "refunded" : selectedState.status === "cancelled" ? "cancelled" : "claimed"].map((status, index) => {
            const order: ContractState["status"][] = ["proposed", "accepted", "locked", "claimed", "refunded", "cancelled"];
            const currentIndex = order.indexOf(selectedState.status);
            const active = status === selectedState.status;
            const complete = index < 3 ? currentIndex >= index : ["claimed", "refunded", "cancelled"].includes(selectedState.status);
            return <div className={active ? "active" : complete ? "complete" : ""} key={`${status}-${index}`}><span>{index + 1}</span><strong>{status}</strong></div>;
          })}
        </div>
        <div className="tclk-inspector-grid">
          <div><span>CONTRACT</span><code>{selectedState.contract}</code></div>
          <div><span>DEAL ROOM</span><code>{selectedDeal.room}</code></div>
          <div><span>PAYER DID</span><code>{selectedState.payerDid}</code></div>
          <div><span>PAYEE DID</span><code>{selectedState.payeeDid}</code></div>
          <div><span>CLAIM BY</span><strong>{timeLabel(selectedState.offer.claimByMs)}</strong></div>
          <div><span>REFUND OPENS</span><strong>{timeLabel(selectedState.offer.refundAfterMs)}</strong></div>
        </div>
        <div className={`status-line ${audit.rejected.length ? "warn" : "good"}`}><strong>RECEIPT OUTCOME GUARD:</strong> {audit.accepted.length} valid signed frame(s). {audit.rejected.length} conflicting or malformed frame(s) ignored. Receipt outcomes are checked independently against the terminal state.</div>
        {audit.rejected.length > 0 && <details className="tclk-rejections"><summary>View rejected frame reasons</summary><ul>{audit.rejected.slice(0, 20).map((item, index) => <li key={`${item.seq ?? "x"}-${index}`}>SEQ {String(item.seq ?? "?")}: {item.reason}</li>)}</ul></details>}
        <div className="button-row"><button className="button" disabled={Boolean(busy)} onClick={() => void openDeal(selectedDeal)}>Refresh transcript</button><button className="button" onClick={downloadTranscript}>Export public transcript</button></div>
      </section>

      <section className="panel tclk-actions-panel">
        <p className="eyebrow">CONTRACT ACTIONS</p>
        <h2>Only the correct DID can advance each step</h2>
        <div className="stack-buttons">
          <button className="button primary" disabled={!canLock || Boolean(busy)} onClick={publishLock}>Payer: record paper lock</button>
          <button className="button primary" disabled={!canReveal || Boolean(busy)} onClick={publishReveal}>Payee: reveal and claim</button>
          <button className="button" disabled={!canRefund || Boolean(busy)} onClick={publishRefund}>Payer: refund after deadline</button>
          <button className="button" disabled={!canCancel || Boolean(busy)} onClick={publishCancel}>Either party: cancel before lock</button>
          <button className="button" disabled={!canReceipt || Boolean(busy)} onClick={publishReceipt}>Publish matching receipt</button>
        </div>
        <div className="status-line muted">Disabled actions mean the loaded DID, verified state, deadline, or recovery file does not authorize that step.</div>
      </section>

      <section className="panel tclk-secret-panel">
        <p className="eyebrow">LOCAL SECRET CONTROL</p>
        <h2>{loadedRecovery ? "Recovery loaded" : "Load private recovery"}</h2>
        <p>Only the payee needs this file. It is checked locally against the contract statement and is never sent until Reveal is selected.</p>
        <input ref={recoveryInput} hidden type="file" accept=".json,application/json" onChange={(event) => { const file = fileFromEvent(event); if (file) void loadRecovery(file); event.target.value = ""; }} />
        <button className="button" onClick={() => recoveryInput.current?.click()}>Choose private recovery JSON</button>
        {loadedRecovery && <div className="did-block"><span>RECOVERY CONTRACT</span><code>{loadedRecovery.contract_id}</code></div>}
      </section>
    </>}

    <section className="panel wide tclk-boundaries">
      <p className="eyebrow">SECURITY BOUNDARIES</p>
      <h2>What this alpha proves and what it does not</h2>
      <div className="limits-grid">
        <p><strong>Signed coordination</strong>Frames are signed by each DID and read back from the named Technocore room.</p>
        <p><strong>Deterministic state</strong>The official state machine rejects wrong parties, wrong order, wrong contracts, bad secrets, and invalid deadlines.</p>
        <p><strong>Public rooms</strong>Offer and deal transcripts are readable by strangers. A derived deal room is not confidential.</p>
        <p><strong>No payment proof</strong>PaperRail notes are world-writable and hold nothing. They cannot prove funds moved.</p>
        <p><strong>No PTLC value flow</strong>The reference PTLC cryptography is unaudited and not Bitcoin compatible. NEONCORE keeps it disabled.</p>
        <p><strong>No airdrop promise</strong>A TCLK rehearsal is useful integration work, but it is not verified FLOP inference spend or guaranteed eligibility.</p>
      </div>
    </section>
  </div>;
}
