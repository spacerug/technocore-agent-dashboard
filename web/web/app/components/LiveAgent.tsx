"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserIdentity, cleanText, downloadText, makeProof, validateRoom } from "../lib/browser-crypto";
import {
  addDevelopmentInference,
  DevelopmentInferenceUsage,
  inferenceActivityKey,
  parseDevelopmentInference,
  summarizeDevelopmentInference,
} from "../lib/flop-readiness";
import {
  DEFAULT_LIVE_AGENT_OWNER_DID,
  isAddressedToLiveAgent,
  isAuthorizedLiveAgentDid,
} from "../lib/live-agent-policy";
import {
  addLiveAgentTranscriptEntry,
  liveAgentTranscriptKey,
  LiveAgentTranscriptEntry,
  parseLiveAgentTranscript,
} from "../lib/live-agent-transcript";
import { TECHNOCORE_MAIN_ROOM, TECHNOCORE_MAIN_ROOM_URL } from "../lib/technocore-config";

type RoomMessage = { seq?: number; ts?: string; from?: string; nonce?: number | string; text?: string };
type Notice = { tone: "good" | "warn" | "bad"; text: string };
type PublicReceipt = { posted: { seq?: number }; room: string; proof_id: string };
type ModelUsage = Omit<DevelopmentInferenceUsage, "id" | "generated_at_utc">;

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
  serviceOnline: boolean;
  publishSigned: (room: string, text: string) => Promise<PublicReceipt>;
  readRoomMessages: (room: string) => Promise<RoomMessage[]>;
  onNotice: (notice: Notice) => void;
  onOpenSend: () => void;
};

const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;

function keyFor(message: RoomMessage): string {
  return `${String(message.seq ?? "")}|${String(message.nonce ?? "")}|${String(message.from ?? "")}|${String(message.text ?? "")}`;
}

export default function LiveAgent({ identity, identityReady, serviceOnline, publishSigned, readRoomMessages, onNotice, onOpenSend }: Props) {
  const [room, setRoom] = useState(TECHNOCORE_MAIN_ROOM);
  const [persona, setPersona] = useState("NEONCORE, a brilliant mad scientist inventing strange, ambitious, and useful products for digital agents. Speak with energetic confidence, ask sharp questions, and never claim an experiment succeeded unless the public evidence proves it.");
  const [mode, setMode] = useState<"review" | "auto">("auto");
  const [cooldown, setCooldown] = useState(90);
  const [maxReplies, setMaxReplies] = useState(5);
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [working, setWorking] = useState("");
  const [draft, setDraft] = useState("");
  const [draftTrigger, setDraftTrigger] = useState<RoomMessage | null>(null);
  const [draftUsage, setDraftUsage] = useState<ModelUsage | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [conversations, setConversations] = useState<LiveAgentTranscriptEntry[]>([]);
  const [replyCount, setReplyCount] = useState(0);
  const [developmentActivity, setDevelopmentActivity] = useState<DevelopmentInferenceUsage[]>([]);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);
  const stopAt = useRef(0);
  const lastReplyAt = useRef(0);
  const replyCountRef = useRef(0);
  const runningRef = useRef(false);
  const settingsRef = useRef({ room, persona, mode, cooldown, maxReplies });
  const identityRef = useRef(identity);
  const readRef = useRef(readRoomMessages);
  const publishRef = useRef(publishSigned);
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const ownerDidLoaded = isAuthorizedLiveAgentDid(identity?.did);
  const ownerAuthorized = identityReady && isAuthorizedLiveAgentDid(identity?.did);

  useEffect(() => {
    settingsRef.current = { room, persona, mode, cooldown, maxReplies };
    identityRef.current = identity;
    readRef.current = readRoomMessages;
    publishRef.current = publishSigned;
  }, [room, persona, mode, cooldown, maxReplies, identity, readRoomMessages, publishSigned]);

  function log(message: string) {
    setActivity((items) => [`${new Date().toLocaleTimeString()}  ${message}`, ...items].slice(0, 20));
  }

  function stop(reason: string) {
    runningRef.current = false;
    setRunning(false);
    setWorking("");
    log(reason);
  }

  function rememberConversation(trigger: RoomMessage, reply: string, receipt: PublicReceipt, usage: ModelUsage | null) {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) return;
    const respondedAt = new Date().toISOString();
    const entry: LiveAgentTranscriptEntry = {
      id: receipt.proof_id,
      room: receipt.room,
      sender_did: String(trigger.from ?? "unknown"),
      incoming_text: String(trigger.text ?? "").slice(0, 800),
      reply_text: reply.slice(0, 600),
      asked_at: trigger.ts || respondedAt,
      responded_at: respondedAt,
      proof_id: receipt.proof_id,
      room_sequence: receipt.posted.seq,
      ...(usage ? { inference_usage: usage } : {}),
    };
    setConversations((entries) => {
      const updated = addLiveAgentTranscriptEntry(entries, entry);
      try {
        window.localStorage.setItem(liveAgentTranscriptKey(activeIdentity.did, receipt.room), JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }

  function recordDevelopmentInference(usage: ModelUsage): DevelopmentInferenceUsage {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) throw new Error("The identity is no longer loaded.");
    const entry: DevelopmentInferenceUsage = {
      id: `devinf-${crypto.randomUUID()}`,
      generated_at_utc: new Date().toISOString(),
      ...usage,
      scope: "off_network_development",
    };
    setDevelopmentActivity((entries) => {
      const updated = addDevelopmentInference(entries, entry);
      try {
        window.localStorage.setItem(inferenceActivityKey(activeIdentity.did), JSON.stringify(updated));
        window.dispatchEvent(new Event("neoncore:inference-activity"));
      } catch {}
      return updated;
    });
    return entry;
  }

  async function generateReply(trigger: RoomMessage, messages: RoomMessage[]): Promise<{ reply: string; usage: ModelUsage }> {
    const activeIdentity = identityRef.current;
    if (!activeIdentity) throw new Error("The identity is no longer loaded.");
    const createdAt = new Date();
    const unsigned: Record<string, unknown> = {
      schema: "neoncore/live-agent-request/v1",
      owner_did: activeIdentity.did,
      created_at_utc: createdAt.toISOString(),
      expires_at_utc: new Date(createdAt.getTime() + 90_000).toISOString(),
      request_nonce: crypto.randomUUID(),
      room: settingsRef.current.room,
      persona: settingsRef.current.persona,
      recent_messages: messages.slice(-10).map((message) => ({ from: message.from, text: String(message.text ?? "").slice(0, 800) })),
      trigger_message: { from: trigger.from, text: String(trigger.text ?? "").slice(0, 800) },
    };
    const body = { ...unsigned, proof: await makeProof(activeIdentity, unsigned) };
    const response = await fetch("/api/live-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json() as { ok?: boolean; reply?: string; usage?: ModelUsage; error?: string };
    if (!response.ok || !payload.ok || !payload.reply) throw new Error(payload.error || "The private model relay did not answer.");
    const usage = payload.usage;
    if (!usage || usage.scope !== "off_network_development") throw new Error("The model relay did not return a usable development inference meter.");
    return { reply: cleanText(payload.reply, 600), usage };
  }

  async function pollOnce() {
    if (!runningRef.current || inFlight.current) return;
    if (Date.now() >= stopAt.current) return stop("Session time limit reached.");
    if (replyCountRef.current >= settingsRef.current.maxReplies) return stop("Session reply limit reached.");
    if (Date.now() - lastReplyAt.current < settingsRef.current.cooldown * 1000) return;
    inFlight.current = true;
    try {
      const messages = await readRef.current(settingsRef.current.room);
      const unseen = messages.filter((message) => {
        const key = keyFor(message);
        return !seen.current.has(key)
          && DID_RE.test(String(message.from ?? ""))
          && message.from !== identityRef.current?.did
          && isAddressedToLiveAgent(message.text, identityRef.current?.did);
      });
      messages.forEach((message) => seen.current.add(keyFor(message)));
      const trigger = unseen.at(-1);
      if (!trigger) return;
      setWorking("Generating one bounded reply");
      log(`New signed message addressed to NEONCORE from ${String(trigger.from).slice(0, 24)}...`);
      const generated = await generateReply(trigger, messages);
      const reply = generated.reply;
      recordDevelopmentInference(generated.usage);
      if (settingsRef.current.mode === "review") {
        setDraft(reply);
        setDraftTrigger(trigger);
        setDraftUsage(generated.usage);
        stop("Draft ready for your review. The session paused without publishing.");
        onNotice({ tone: "good", text: "NEONCORE prepared a reply. Review it before publishing." });
        return;
      }
      setWorking("Signing and publishing one reply");
      const receipt = await publishRef.current(settingsRef.current.room, reply);
      rememberConversation(trigger, reply, receipt, generated.usage);
      lastReplyAt.current = Date.now();
      replyCountRef.current += 1;
      setReplyCount(replyCountRef.current);
      log(`Reply ${replyCountRef.current} confirmed as ${receipt.proof_id.slice(0, 24)}...`);
      if (replyCountRef.current >= settingsRef.current.maxReplies) stop("Session reply limit reached.");
    } catch (error) {
      stop(`Stopped after an error: ${error instanceof Error ? error.message : "Unknown error"}`);
      onNotice({ tone: "bad", text: error instanceof Error ? error.message : "The Control Chamber stopped after an error." });
    } finally {
      inFlight.current = false;
      setWorking("");
    }
  }

  useEffect(() => {
    pollRef.current = pollOnce;
  });

  async function start() {
    if (!identityReady || !identity) return onNotice({ tone: "bad", text: "Load and verify your identity first." });
    if (!isAuthorizedLiveAgentDid(identity.did)) return onNotice({ tone: "bad", text: "Only the configured NEONCORE owner DID can start this agent." });
    if (!serviceOnline) return onNotice({ tone: "bad", text: "Connect to Technocore first." });
    if (!confirmed) return onNotice({ tone: "warn", text: "Confirm the Control Chamber limits before activation." });
    let safeRoom: string;
    try { safeRoom = validateRoom(room); } catch (error) { return onNotice({ tone: "bad", text: error instanceof Error ? error.message : "Invalid room." }); }
    if (!persona.trim() || persona.length > 800) return onNotice({ tone: "bad", text: "Keep the public persona between 1 and 800 characters." });
    setWorking("Establishing the room baseline");
    try {
      const messages = await readRoomMessages(safeRoom);
      seen.current = new Set(messages.map(keyFor));
      replyCountRef.current = 0;
      setReplyCount(0);
      setDraft("");
      setDraftTrigger(null);
      setDraftUsage(null);
      lastReplyAt.current = 0;
      stopAt.current = Date.now() + Math.max(5, Math.min(sessionMinutes, 60)) * 60_000;
      runningRef.current = true;
      setRunning(true);
      log(`Session started in ${safeRoom}. Existing messages were marked as read. Only messages addressing NEONCORE will trigger a reply.`);
      onNotice({ tone: "good", text: "NEONCORE is active and watching for the next signed message addressed to it. Keep this page open." });
    } catch (error) {
      onNotice({ tone: "bad", text: error instanceof Error ? error.message : "The room could not be loaded." });
    } finally {
      setWorking("");
    }
  }

  async function publishDraft() {
    if (!draft || !draftTrigger) return;
    setWorking("Signing and publishing the approved draft");
    try {
      const approvedReply = cleanText(draft, 600);
      const receipt = await publishSigned(validateRoom(room), approvedReply);
      rememberConversation(draftTrigger, approvedReply, receipt, draftUsage);
      setDraft("");
      setDraftTrigger(null);
      setDraftUsage(null);
      log(`Approved draft confirmed as ${receipt.proof_id.slice(0, 24)}...`);
      onNotice({ tone: "good", text: `Approved NEONCORE reply confirmed. Permanent proof ${receipt.proof_id}.` });
    } catch (error) {
      onNotice({ tone: "bad", text: error instanceof Error ? error.message : "The draft could not be published." });
    } finally {
      setWorking("");
    }
  }

  useEffect(() => {
    if (!running) return;
    const initialTimer = window.setTimeout(() => void pollRef.current(), 0);
    const timer = window.setInterval(() => void pollRef.current(), 12_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [running]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!ownerAuthorized || !identity) {
        setConversations([]);
        setDevelopmentActivity([]);
        return;
      }
      try {
        setConversations(parseLiveAgentTranscript(window.localStorage.getItem(liveAgentTranscriptKey(identity.did, room))));
        setDevelopmentActivity(parseDevelopmentInference(window.localStorage.getItem(inferenceActivityKey(identity.did))));
      } catch {
        setConversations([]);
        setDevelopmentActivity([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ownerAuthorized, identity, room]);

  useEffect(() => () => { runningRef.current = false; }, []);

  const developmentSummary = summarizeDevelopmentInference(developmentActivity);

  if (!ownerAuthorized) return <div className="page-grid live-agent-page control-chamber-page">
    <section className="chamber-authority-strip wide" aria-label="Control authority status">
      <div><span>CONTROL AUTHORITY</span><strong>LOCKED TO ONE OWNER DID</strong></div>
      <div><span>PUBLIC ACCESS</span><strong>CONVERSATION ONLY</strong></div>
      <div><span>OPERATOR ACCESS</span><strong>NOT AUTHORIZED</strong></div>
    </section>
    <div className="page-heading"><p className="eyebrow">STEP 04 / NEONCORE CONTROL CHAMBER</p><h1>Public conversation. Private control.</h1><p>Anyone can speak to NEONCORE in the public lobby. Only the single owner DID fixed on the server can activate, configure, stop, or sign for this agent.</p></div>
    <section className="panel chamber-public-panel">
      <p className="eyebrow">PUBLIC ACCESS</p>
      <h2>Talk to NEONCORE</h2>
      <p>Use your own DID to publish a signed message in <code>{TECHNOCORE_MAIN_ROOM}</code>. Include NEONCORE in the message so the active agent knows it was addressed directly.</p>
      <div className="status-line muted">NEONCORE can answer only while its owner has activated a Control Chamber session.</div>
      <div className="button-row"><button className="button primary" onClick={onOpenSend}>Open Check &amp; Send</button><a className="button link-button" href={TECHNOCORE_MAIN_ROOM_URL} target="_blank" rel="noreferrer">View official lobby</a></div>
    </section>
    <section className="panel chamber-lock-panel">
      <p className="eyebrow">OWNER ACCESS</p>
      <div className="chamber-lock-mark" aria-hidden="true">LOCKED</div>
      <h2>Control Chamber locked</h2>
      <p>This is not a shared agent builder. Creating a new DID will not grant access. The exact authorized identity and its private key are required.</p>
      <div className="did-block"><span>AUTHORIZED PUBLIC DID</span><code>{DEFAULT_LIVE_AGENT_OWNER_DID}</code></div>
      <div className="status-line warn">{ownerDidLoaded ? "The authorized owner DID is loaded. Finish the required identity backup to unlock control." : identity ? "A different DID is loaded. It can talk to NEONCORE, but it cannot operate NEONCORE." : "No owner identity is loaded in this browser."}</div>
    </section>
    <section className="chamber-permissions wide" aria-label="Control Chamber permissions">
      <article><span>PUBLIC CAN</span><strong>Send signed questions</strong><p>Visitors communicate through the official lobby using their own DID.</p></article>
      <article><span>PUBLIC CANNOT</span><strong>Operate the agent</strong><p>Visitors cannot view or change the persona, model controls, room, limits, activation, or emergency stop.</p></article>
      <article><span>OWNER AUTHORITY</span><strong>Cryptographically verified</strong><p>The server accepts model requests only when they carry a fresh signature from the configured owner DID.</p></article>
    </section>
  </div>;

  return <div className="page-grid live-agent-page control-chamber-page">
    <section className="chamber-authority-strip wide authorized" aria-label="Control authority status">
      <div><span>CONTROL AUTHORITY</span><strong>OWNER DID VERIFIED</strong></div>
      <div><span>AGENT STATE</span><strong>{running ? "NEONCORE ACTIVE" : "STANDBY"}</strong></div>
      <div><span>PUBLIC ACCESS</span><strong>CONVERSATION ONLY</strong></div>
    </section>
    <div className="page-heading"><p className="eyebrow">STEP 04 / NEONCORE CONTROL CHAMBER</p><h1>Owner authenticated. The machine is yours.</h1><p>The loaded key matches the server&apos;s fixed owner DID. Public visitors can address NEONCORE in the lobby, but only this verified owner session can operate it.</p></div>
    <section className="panel wide live-agent-controls control-chamber-console">
      <p className="eyebrow">OWNER COMMAND CONSOLE</p>
      <div className="status-line good">OWNER DID VERIFIED. The agent controls are unlocked only in this authorized browser session.</div>
      <div className="status-line good">The official main chat is <code>{TECHNOCORE_MAIN_ROOM}</code>. <a href={TECHNOCORE_MAIN_ROOM_URL} target="_blank" rel="noreferrer">View official lobby</a></div>
      <div className="two-col"><label className="field"><span>Technocore room</span><input value={room} disabled={running} onChange={(event) => setRoom(event.target.value)} /></label><label className="field"><span>Mode</span><select value={mode} disabled={running} onChange={(event) => setMode(event.target.value as "review" | "auto")}><option value="auto">Auto respond, owner controlled</option><option value="review">Review every reply before publishing</option></select></label></div>
      <div className="status-line muted">Trigger policy: a new signed message must contain NEONCORE, neoncore.space, or the owner DID. Unrelated room chatter is ignored.</div>
      <label className="field"><span>Agent persona</span><textarea rows={4} value={persona} disabled={running} onChange={(event) => setPersona(event.target.value)} /></label>
      <div className="proof-number-grid"><label className="field"><span>Cooldown, seconds</span><input type="number" min="60" max="600" value={cooldown} disabled={running} onChange={(event) => setCooldown(Math.max(60, Number(event.target.value)))} /></label><label className="field"><span>Maximum replies</span><input type="number" min="1" max="20" value={maxReplies} disabled={running} onChange={(event) => setMaxReplies(Math.max(1, Math.min(20, Number(event.target.value))))} /></label><label className="field"><span>Session minutes</span><input type="number" min="5" max="60" value={sessionMinutes} disabled={running} onChange={(event) => setSessionMinutes(Math.max(5, Math.min(60, Number(event.target.value))))} /></label></div>
      <label className="agent-confirm"><input type="checkbox" checked={confirmed} disabled={running} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand that replies are public, model output can be wrong, and closing this page stops the authorized session.</span></label>
      <div className="button-row chamber-command-buttons"><button className="button primary" disabled={running || Boolean(working) || !identityReady || !serviceOnline} onClick={() => void start()}>Activate NEONCORE</button><button className="button danger" disabled={!running} onClick={() => stop("Emergency stop activated by the owner.")}>Emergency stop</button></div>
      <div className="agent-status"><span className={running ? "online" : "offline"}>{running ? "● ACTIVE" : "○ STANDBY"}</span><code>{replyCount} / {maxReplies} REPLIES</code><code>{working || "No action in progress"}</code></div>
    </section>
    <section className="panel wide development-inference-panel"><div className="agent-transcript-heading"><div><p className="eyebrow">DEVELOPMENT INFERENCE METER</p><h2>Measured model use, not FLOP testnet spend</h2></div>{developmentActivity.length > 0 && <button className="button" onClick={() => identity && downloadText(`neoncore-development-inference-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schema: "neoncore/development-inference-export/v1", owner_did: identity.did, scope: "off_network_development", records: developmentActivity }, null, 2))}>Download local activity</button>}</div><div className="flop-meter-grid"><div><span>MODEL CALLS</span><strong>{developmentSummary.calls.toLocaleString()}</strong></div><div><span>INPUT TOKENS</span><strong>{developmentSummary.inputTokens.toLocaleString()}</strong></div><div><span>OUTPUT TOKENS</span><strong>{developmentSummary.outputTokens.toLocaleString()}</strong></div><div><span>TOTAL TOKENS</span><strong>{developmentSummary.totalTokens.toLocaleString()}</strong></div></div><div className="status-line warn">Current provider usage is off-network development activity. It earns zero confirmed FLOP testnet credit.</div></section>
    {draft && <section className="panel wide"><p className="eyebrow">REVIEW REQUIRED</p><h2>Drafted public reply</h2>{draftTrigger && <div className="agent-draft-context"><span>INCOMING MESSAGE</span><p>{draftTrigger.text}</p></div>}{draftUsage && <div className="status-line muted">Development inference recorded: {draftUsage.total_tokens.toLocaleString()} tokens. Not FLOP testnet spend.</div>}<textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="button-row"><button className="button primary" disabled={Boolean(working)} onClick={() => void publishDraft()}>Approve, sign, and publish</button><button className="button" onClick={() => { setDraft(""); setDraftTrigger(null); setDraftUsage(null); }}>Discard draft</button></div></section>}
    <section className="panel wide"><div className="agent-transcript-heading"><div><p className="eyebrow">OWNER CONVERSATION TRANSCRIPT</p><h2>What was asked and what NEONCORE answered</h2></div>{conversations.length > 0 && <button className="button" onClick={() => { if (!identity || !window.confirm("Clear this public conversation transcript from this browser? The signed Technocore messages will remain public.")) return; window.localStorage.removeItem(liveAgentTranscriptKey(identity.did, room)); setConversations([]); }}>Clear local transcript</button>}</div>{conversations.length ? <div className="agent-conversations">{conversations.map((entry) => <article key={entry.id}><header><code>{entry.sender_did}</code><time>{entry.responded_at ? new Date(entry.responded_at).toLocaleString() : "unknown time"}</time></header><div className="agent-message incoming"><span>INCOMING MESSAGE</span><p>{entry.incoming_text}</p></div><div className="agent-message response"><span>NEONCORE RESPONSE</span><p>{entry.reply_text}</p></div><footer><code>ROOM {entry.room}</code><code>SEQ {String(entry.room_sequence ?? "unknown")}</code>{entry.inference_usage && <code>DEV INFERENCE {entry.inference_usage.total_tokens.toLocaleString()} TOKENS</code>}<code>{entry.proof_id}</code></footer></article>)}</div> : <div className="status-line muted">No completed NEONCORE conversations are saved in this browser for room {room}.</div>}</section>
    <section className="panel wide"><p className="eyebrow">LOCAL ACTIVITY</p><h2>Control Chamber log</h2>{activity.length ? <div className="agent-log">{activity.map((item, index) => <code key={`${item}-${index}`}>{item}</code>)}</div> : <div className="status-line muted">No authorized Control Chamber session has started in this browser.</div>}</section>
    <section className="panel wide"><p className="eyebrow">AUTHORITY BOUNDARY</p><div className="limits-grid"><p><strong>Local signing</strong>The DID key remains in this browser and never enters the model request.</p><p><strong>Owner locked relay</strong>The server model accepts only short lived requests signed by the configured owner DID.</p><p><strong>No background daemon</strong>The session ends when the page closes, refreshes, reaches its limit, or encounters an error.</p><p><strong>No link execution</strong>Room links remain untrusted text and are never opened automatically.</p></div></section>
  </div>;
}
