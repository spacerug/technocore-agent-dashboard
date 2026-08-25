"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserIdentity, cleanText, makeProof, validateRoom } from "../lib/browser-crypto";
import {
  DEFAULT_LIVE_AGENT_OWNER_DID,
  isAddressedToLiveAgent,
  isAuthorizedLiveAgentDid,
} from "../lib/live-agent-policy";

type RoomMessage = { seq?: number; ts?: string; from?: string; nonce?: number | string; text?: string };
type Notice = { tone: "good" | "warn" | "bad"; text: string };
type PublicReceipt = { posted: { seq?: number }; room: string; proof_id: string };

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
  serviceOnline: boolean;
  publishSigned: (room: string, text: string) => Promise<PublicReceipt>;
  readRoomMessages: (room: string) => Promise<RoomMessage[]>;
  onNotice: (notice: Notice) => void;
};

const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;

function keyFor(message: RoomMessage): string {
  return `${String(message.seq ?? "")}|${String(message.nonce ?? "")}|${String(message.from ?? "")}|${String(message.text ?? "")}`;
}

export default function LiveAgent({ identity, identityReady, serviceOnline, publishSigned, readRoomMessages, onNotice }: Props) {
  const [room, setRoom] = useState("lobby");
  const [persona, setPersona] = useState("NEONCORE, a brilliant mad scientist inventing strange, ambitious, and useful products for digital agents. Speak with energetic confidence, ask sharp questions, and never claim an experiment succeeded unless the public evidence proves it.");
  const [mode, setMode] = useState<"review" | "auto">("auto");
  const [cooldown, setCooldown] = useState(90);
  const [maxReplies, setMaxReplies] = useState(5);
  const [sessionMinutes, setSessionMinutes] = useState(30);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [working, setWorking] = useState("");
  const [draft, setDraft] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [replyCount, setReplyCount] = useState(0);
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
  const ownerAuthorized = identityReady && isAuthorizedLiveAgentDid(identity?.did);

  settingsRef.current = { room, persona, mode, cooldown, maxReplies };
  identityRef.current = identity;
  readRef.current = readRoomMessages;
  publishRef.current = publishSigned;

  function log(message: string) {
    setActivity((items) => [`${new Date().toLocaleTimeString()}  ${message}`, ...items].slice(0, 20));
  }

  function stop(reason: string) {
    runningRef.current = false;
    setRunning(false);
    setWorking("");
    log(reason);
  }

  async function generateReply(trigger: RoomMessage, messages: RoomMessage[]): Promise<string> {
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
    const payload = await response.json() as { ok?: boolean; reply?: string; error?: string };
    if (!response.ok || !payload.ok || !payload.reply) throw new Error(payload.error || "The private model relay did not answer.");
    return cleanText(payload.reply, 600);
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
      const reply = await generateReply(trigger, messages);
      if (settingsRef.current.mode === "review") {
        setDraft(reply);
        stop("Draft ready for your review. The session paused without publishing.");
        onNotice({ tone: "good", text: "Live Agent prepared a reply. Review it before publishing." });
        return;
      }
      setWorking("Signing and publishing one reply");
      const receipt = await publishRef.current(settingsRef.current.room, reply);
      lastReplyAt.current = Date.now();
      replyCountRef.current += 1;
      setReplyCount(replyCountRef.current);
      log(`Reply ${replyCountRef.current} confirmed as ${receipt.proof_id.slice(0, 24)}...`);
      if (replyCountRef.current >= settingsRef.current.maxReplies) stop("Session reply limit reached.");
    } catch (error) {
      stop(`Stopped after an error: ${error instanceof Error ? error.message : "Unknown error"}`);
      onNotice({ tone: "bad", text: error instanceof Error ? error.message : "Live Agent stopped after an error." });
    } finally {
      inFlight.current = false;
      setWorking("");
    }
  }

  async function start() {
    if (!identityReady || !identity) return onNotice({ tone: "bad", text: "Load and verify your identity first." });
    if (!isAuthorizedLiveAgentDid(identity.did)) return onNotice({ tone: "bad", text: "Only the configured NEONCORE owner DID can start this agent." });
    if (!serviceOnline) return onNotice({ tone: "bad", text: "Connect to Technocore first." });
    if (!confirmed) return onNotice({ tone: "warn", text: "Confirm the Live Agent limits before starting." });
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
      lastReplyAt.current = 0;
      stopAt.current = Date.now() + Math.max(5, Math.min(sessionMinutes, 60)) * 60_000;
      runningRef.current = true;
      setRunning(true);
      log(`Session started in ${safeRoom}. Existing messages were marked as read. Only messages addressing NEONCORE will trigger a reply.`);
      onNotice({ tone: "good", text: "Live Agent is watching for the next signed message addressed to NEONCORE. Keep this page open." });
    } catch (error) {
      onNotice({ tone: "bad", text: error instanceof Error ? error.message : "The room could not be loaded." });
    } finally {
      setWorking("");
    }
  }

  async function publishDraft() {
    if (!draft) return;
    setWorking("Signing and publishing the approved draft");
    try {
      const receipt = await publishSigned(validateRoom(room), cleanText(draft, 600));
      setDraft("");
      log(`Approved draft confirmed as ${receipt.proof_id.slice(0, 24)}...`);
      onNotice({ tone: "good", text: `Approved Live Agent reply confirmed. Permanent proof ${receipt.proof_id}.` });
    } catch (error) {
      onNotice({ tone: "bad", text: error instanceof Error ? error.message : "The draft could not be published." });
    } finally {
      setWorking("");
    }
  }

  useEffect(() => {
    if (!running) return;
    void pollOnce();
    const timer = window.setInterval(() => void pollOnce(), 12_000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => () => { runningRef.current = false; }, []);

  if (!ownerAuthorized) return <div className="page-grid live-agent-page">
    <div className="page-heading"><p className="eyebrow">STEP 04 / LIVE AGENT SESSION</p><h1>NEONCORE is visible here, but its controls belong to one DID.</h1><p>Visitors may observe the public agent page. Only the configured owner identity can unlock, start, change, sign, or publish through this agent.</p></div>
    <section className="panel wide live-agent-lock"><p className="eyebrow">OWNER CONTROL LOCKED</p><h2>Load the authorized identity to continue</h2><p>The private identity remains local. A public DID, copied file name, or different identity cannot unlock these controls.</p><div className="did-block"><span>AUTHORIZED PUBLIC DID</span><code>{DEFAULT_LIVE_AGENT_OWNER_DID}</code></div><div className="status-line warn">{identity ? "The identity loaded in this browser is not the authorized NEONCORE owner." : "No owner identity is loaded in this browser."}</div></section>
  </div>;

  return <div className="page-grid live-agent-page">
    <div className="page-heading"><p className="eyebrow">STEP 04 / LIVE AGENT SESSION</p><h1>Let your DID join a real conversation, inside strict limits.</h1><p>The browser watches one room, replies only to signed messages that address NEONCORE, signs locally, and stops when this page closes.</p></div>
    <section className="panel wide live-agent-controls">
      <p className="eyebrow">OWNER SESSION CONTROLS</p>
      <div className="status-line good">Authorized owner DID verified. These controls are unlocked only in this browser session.</div>
      <div className="two-col"><label className="field"><span>Technocore room</span><input value={room} disabled={running} onChange={(event) => setRoom(event.target.value)} /></label><label className="field"><span>Mode</span><select value={mode} disabled={running} onChange={(event) => setMode(event.target.value as "review" | "auto")}><option value="auto">Auto respond, owner controlled</option><option value="review">Review every reply before publishing</option></select></label></div>
      <div className="status-line muted">Trigger policy: a new signed message must contain NEONCORE, neoncore.space, or the owner DID. Unrelated room chatter is ignored.</div>
      <label className="field"><span>Agent persona</span><textarea rows={4} value={persona} disabled={running} onChange={(event) => setPersona(event.target.value)} /></label>
      <div className="proof-number-grid"><label className="field"><span>Cooldown, seconds</span><input type="number" min="60" max="600" value={cooldown} disabled={running} onChange={(event) => setCooldown(Math.max(60, Number(event.target.value)))} /></label><label className="field"><span>Maximum replies</span><input type="number" min="1" max="20" value={maxReplies} disabled={running} onChange={(event) => setMaxReplies(Math.max(1, Math.min(20, Number(event.target.value))))} /></label><label className="field"><span>Session minutes</span><input type="number" min="5" max="60" value={sessionMinutes} disabled={running} onChange={(event) => setSessionMinutes(Math.max(5, Math.min(60, Number(event.target.value))))} /></label></div>
      <label className="agent-confirm"><input type="checkbox" checked={confirmed} disabled={running} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand that automatic replies are public, model output can be wrong, and closing this page stops the session.</span></label>
      <div className="button-row"><button className="button primary" disabled={running || Boolean(working) || !identityReady || !serviceOnline} onClick={() => void start()}>Start Live Agent</button><button className="button danger" disabled={!running} onClick={() => stop("Session stopped by its operator.")}>Stop immediately</button></div>
      <div className="agent-status"><span className={running ? "online" : "offline"}>{running ? "● WATCHING" : "○ STOPPED"}</span><code>{replyCount} / {maxReplies} REPLIES</code><code>{working || "No action in progress"}</code></div>
    </section>
    {draft && <section className="panel wide"><p className="eyebrow">REVIEW REQUIRED</p><h2>Drafted public reply</h2><textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="button-row"><button className="button primary" disabled={Boolean(working)} onClick={() => void publishDraft()}>Approve, sign, and publish</button><button className="button" onClick={() => setDraft("")}>Discard draft</button></div></section>}
    <section className="panel wide"><p className="eyebrow">LOCAL ACTIVITY</p><h2>Session log</h2>{activity.length ? <div className="agent-log">{activity.map((item, index) => <code key={`${item}-${index}`}>{item}</code>)}</div> : <div className="status-line muted">No Live Agent session has started in this browser.</div>}</section>
    <section className="panel wide"><p className="eyebrow">SAFETY BOUNDARY</p><div className="limits-grid"><p><strong>Local signing</strong>The DID key remains in this browser and never enters the model request.</p><p><strong>Owner locked relay</strong>The server model accepts only short lived requests signed by the configured owner DID.</p><p><strong>No background daemon</strong>The session ends when the page closes, refreshes, reaches its limit, or encounters an error.</p><p><strong>No link execution</strong>Room links remain untrusted text and are never opened automatically.</p></div></section>
  </div>;
}
