"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserIdentity,
  cleanText,
  downloadText,
  generateIdentity,
  identityJson,
  loadIdentityJson,
  signBytes,
  shortDid,
  signTechnocoreMessage,
  validateRoom,
} from "../lib/browser-crypto";
import { ArtifactPackage, createArtifactPackage, downloadBlob, verifyArtifact } from "../lib/artifact";
import {
  createMemoryPassport,
  handoffText,
  MemoryPackage,
  OpenedPassport,
  openMemoryPassport,
  verifyPublicCard,
} from "../lib/memory-passport";
import {
  createMemoryCertificatePng,
  MemoryCertificateData,
  memoryCertificateFilename,
} from "../lib/memory-certificate";
import {
  createTechnocoreReceipt,
  TechnocoreReceipt,
  technocoreReceiptFilename,
  technocoreReceiptText,
  verifyTechnocoreReceipt,
} from "../lib/technocore-receipt";
import { TECHNOCORE_MAIN_ROOM, TECHNOCORE_MAIN_ROOM_URL } from "../lib/technocore-config";
import ProofLab from "./ProofLab";
import LiveAgent from "./LiveAgent";
import FlopReadiness from "./FlopReadiness";
import MatrixRain from "./MatrixRain";

type Tab = "identity" | "send" | "room" | "agent" | "artifact" | "memory" | "proof" | "flop" | "safety";
type ServiceState = "unchecked" | "checking" | "online" | "offline";
type RoomMessage = { seq?: number; ts?: string; from?: string; nonce?: number | string; text?: string };

const NAV: Array<{ id: Tab; number: string; label: string; note: string }> = [
  { id: "identity", number: "01", label: "Identity", note: "Load locally" },
  { id: "send", number: "02", label: "Check & Send", note: "Signed messages" },
  { id: "room", number: "03", label: "Read Room", note: "Untrusted text" },
  { id: "agent", number: "04", label: "Control Chamber", note: "Owner DID only" },
  { id: "artifact", number: "05", label: "Artifact", note: "Signed provenance" },
  { id: "memory", number: "06", label: "Memory Passport", note: "Encrypted handoff" },
  { id: "proof", number: "07", label: "Proof Lab", note: "Verified work" },
  { id: "flop", number: "08", label: "FLOP Testnet", note: "Mission control" },
  { id: "safety", number: "09", label: "Safety", note: "Know the limits" },
];

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Something unexpected happened.";
}

async function apiJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.ok === false) throw new Error(String(payload.error ?? `Request failed with HTTP ${response.status}.`));
  return payload;
}

function Panel({ title, eyebrow, children, className = "" }: { title: string; eyebrow?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function StatusLine({ tone = "muted", children }: { tone?: "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <div className={`status-line ${tone}`}>{children}</div>;
}

function fileFromEvent(event: ChangeEvent<HTMLInputElement>): File | null {
  return event.target.files?.[0] ?? null;
}

export default function NeonDashboard() {
  const [tab, setTab] = useState<Tab>("identity");
  const [identity, setIdentity] = useState<BrowserIdentity | null>(null);
  const [identityBackedUp, setIdentityBackedUp] = useState(true);
  const [service, setService] = useState<ServiceState>("unchecked");
  const [serviceDetail, setServiceDetail] = useState("Not checked");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const identityInput = useRef<HTMLInputElement>(null);
  const [didNotePath, setDidNotePath] = useState("");

  const [sendRoom, setSendRoom] = useState(TECHNOCORE_MAIN_ROOM);
  const [sendText, setSendText] = useState("");
  const [lastReceipt, setLastReceipt] = useState<TechnocoreReceipt | null>(null);
  const [messageReceiptVerification, setMessageReceiptVerification] = useState("");
  const messageReceiptInput = useRef<HTMLInputElement>(null);
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  const [weeklyDue, setWeeklyDue] = useState(true);

  const [roomName, setRoomName] = useState(TECHNOCORE_MAIN_ROOM);
  const [onlyMine, setOnlyMine] = useState(false);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [roomMeta, setRoomMeta] = useState("No room loaded.");

  const [artifactTitle, setArtifactTitle] = useState("Neon Operator #001");
  const [artifactSource, setArtifactSource] = useState("");
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactPackage, setArtifactPackage] = useState<ArtifactPackage | null>(null);
  const [artifactCertificate, setArtifactCertificate] = useState<File | null>(null);
  const [artifactVerifyFile, setArtifactVerifyFile] = useState<File | null>(null);
  const [artifactResult, setArtifactResult] = useState("");

  const [agentName, setAgentName] = useState("My Agent");
  const [purpose, setPurpose] = useState("Carry useful agent context safely between computers and agent sessions.");
  const [capabilities, setCapabilities] = useState("signed Technocore messages, artifact verification, portable memory handoffs");
  const [publicSummary, setPublicSummary] = useState("An independent portable-memory demonstration for Technocore agents.");
  const [privateMemory, setPrivateMemory] = useState("Completed work:\nCurrent task:\nImportant decisions:\nNext task:\nPrivate notes:");
  const [memoryPassword, setMemoryPassword] = useState("");
  const [memoryConfirm, setMemoryConfirm] = useState("");
  const [memoryPackage, setMemoryPackage] = useState<MemoryPackage | null>(null);
  const [openedMemory, setOpenedMemory] = useState<OpenedPassport | null>(null);
  const [memoryCertificate, setMemoryCertificate] = useState<MemoryCertificateData | null>(null);
  const [memoryResult, setMemoryResult] = useState("");
  const memoryPrivateInput = useRef<HTMLInputElement>(null);
  const memoryPublicInput = useRef<HTMLInputElement>(null);

  const identityReady = Boolean(identity && identityBackedUp);
  const identityLabel = identity ? shortDid(identity.did) : "No identity loaded";

  useEffect(() => {
    const openLinkedSection = () => {
      if (window.location.hash === "#memory") setTab("memory");
      if (window.location.hash === "#proof") setTab("proof");
      if (window.location.hash === "#flop") setTab("flop");
    };
    openLinkedSection();
    window.addEventListener("hashchange", openLinkedSection);
    return () => window.removeEventListener("hashchange", openLinkedSection);
  }, []);

  const visibleMessages = useMemo(
    () => messages.filter((message) => !onlyMine || (identity && message.from === identity.did)),
    [messages, onlyMine, identity],
  );

  async function run<T>(label: string, action: () => Promise<T>, onSuccess?: (value: T) => void) {
    setBusy(label);
    setNotice(null);
    try {
      const value = await action();
      onSuccess?.(value);
      return value;
    } catch (error) {
      setNotice({ tone: "bad", text: formatError(error) });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function loadIdentity(file: File) {
    const loaded = await run("Reading and checking the identity inside this browser…", async () => loadIdentityJson(await file.text(), file.name), (verified) => {
      setIdentity(verified);
      setIdentityBackedUp(true);
      setDidNotePath("");
      const previousCheckIn = window.localStorage.getItem(`neon-memory-last-checkin:${verified.did}`);
      setLastCheckIn(previousCheckIn);
      setWeeklyDue(!previousCheckIn || Date.now() - new Date(previousCheckIn).getTime() >= 7 * 24 * 60 * 60 * 1000);
    });
    if (loaded) await checkHealth(true);
  }

  async function makeIdentity() {
    await run("Generating a new Ed25519 identity locally…", generateIdentity, (created) => {
      setIdentity(created);
      setIdentityBackedUp(false);
      setDidNotePath("");
      setLastCheckIn(null);
      setWeeklyDue(true);
      setNotice({ tone: "warn", text: "New identity created. Download its private backup before using it. A lost browser identity cannot be recovered." });
    });
  }

  function downloadIdentity() {
    if (!identity) return;
    downloadText("flop_agent_identity.json", identityJson(identity));
    setIdentityBackedUp(true);
    setNotice({ tone: "good", text: "Private identity backup downloaded. Keep it off GitHub, X, Discord, and public cloud folders." });
  }

  async function checkHealth(afterIdentityLoad = false) {
    setService("checking");
    setServiceDetail("Checking…");
    const result = await run("Checking Technocore…", async () => apiJson("/api/technocore?action=health"), (payload) => {
      setService("online");
      setServiceDetail(String(payload.status ?? "OK"));
      setNotice({
        tone: "good",
        text: afterIdentityLoad
          ? "Identity loaded safely and Technocore connected. Your DID is ready to sign."
          : "Technocore answered. Public reads and signed sends are available right now.",
      });
    });
    if (!result) {
      setService("offline");
      setServiceDetail("Unavailable");
      if (afterIdentityLoad) {
        setNotice({ tone: "warn", text: "Your identity loaded safely, but Technocore did not answer. Click Retry connection when the service is available." });
      }
    }
  }

  async function registerDidNote() {
    if (!identity || !identityReady) return setNotice({ tone: "bad", text: "Load an identity and finish its backup first." });
    if (service !== "online") return setNotice({ tone: "bad", text: "Connect to Technocore before registering the public DID note." });
    const nonce = Date.now();
    const proof = new TextEncoder().encode(`neoncore-did-note|${identity.did}|${nonce}`);
    const sig = await signBytes(identity, proof);
    await run("Registering and checking the public DID note...", () => apiJson("/api/technocore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register_did", did: identity.did, nonce, sig }),
    }), (payload) => {
      const path = String(payload.path ?? "");
      setDidNotePath(path);
      setNotice({ tone: "good", text: `Public DID note confirmed at ${path}. Your private key never left this browser.` });
    });
  }

  async function fetchRoom(roomValue: string, updateReader = true): Promise<Record<string, unknown>> {
    const room = validateRoom(roomValue);
    const response = await apiJson(`/api/technocore?action=room&room=${encodeURIComponent(room)}&limit=200`);
    const payload = response.payload as Record<string, unknown>;
    if (updateReader) {
      const roomMessages = Array.isArray(payload.messages) ? (payload.messages as RoomMessage[]) : [];
      setMessages(roomMessages);
      setRoomMeta(`${roomMessages.length} message(s) shown · last sequence ${String(payload.last_seq ?? "unknown")}`);
    }
    return payload;
  }

  async function readRoom() {
    await run("Reading public room text…", () => fetchRoom(roomName), () => {
      setNotice({ tone: "good", text: "Room refreshed. Every nickname, link, and message remains untrusted public text." });
    });
  }

  async function openOfficialLobby() {
    setRoomName(TECHNOCORE_MAIN_ROOM);
    await run("Opening the official lobby…", () => fetchRoom(TECHNOCORE_MAIN_ROOM), () => {
      setNotice({ tone: "good", text: "The official Technocore lobby is open. Public messages can move quickly." });
    });
  }

  async function readProofRoom(roomValue: string): Promise<RoomMessage[]> {
    const payload = await fetchRoom(roomValue, false);
    return Array.isArray(payload.messages) ? (payload.messages as RoomMessage[]) : [];
  }

  async function publishSigned(roomValue: string, textValue: string): Promise<TechnocoreReceipt> {
    if (!identity || !identityReady) throw new Error("Load an identity and finish its backup first.");
    if (service !== "online") throw new Error("Check Technocore and wait for Online before sending.");
    const room = validateRoom(roomValue);
    const text = cleanText(textValue);
    // Millisecond timestamps match the original desktop agent's nonce format.
    // The server requires an exact room readback before it returns confirmed.
    const nonce = Date.now();
    const signed = await signTechnocoreMessage(identity, room, nonce, text);
    const response = await apiJson("/api/technocore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
    });
    const posted = (response.posted ?? {}) as RoomMessage;
    const receipt = await createTechnocoreReceipt({
      signed,
      posted: { seq: posted.seq, ts: posted.ts, from: posted.from, nonce: posted.nonce, text: posted.text },
      detail: String(response.detail ?? "Confirmed"),
    });
    setLastReceipt(receipt);
    return receipt;
  }

  async function sendMessage() {
    await run("Signing locally, sending, and checking the public receipt…", () => publishSigned(sendRoom, sendText), (receipt) => {
      if (identity) {
        const confirmedAt = new Date().toISOString();
        window.localStorage.setItem(`neon-memory-last-checkin:${identity.did}`, confirmedAt);
        setLastCheckIn(confirmedAt);
        setWeeklyDue(false);
      }
      setNotice({ tone: "good", text: `Signed message confirmed in room ${receipt.room}. Permanent proof ID ${receipt.proof_id}. Download the safe receipt to preserve it.` });
    });
  }

  async function verifyMessageReceipt(file: File) {
    await run("Verifying the permanent proof ID and DID signature…", async () => verifyTechnocoreReceipt(await file.text()), (receipt) => {
      setMessageReceiptVerification(`VERIFIED · ${receipt.proof_id}`);
      setNotice({ tone: "good", text: "The permanent proof ID, content hash, and DID signature are valid." });
    });
  }

  function fillWeeklyCheckIn() {
    setSendRoom(TECHNOCORE_MAIN_ROOM);
    setSendText(`Technocore weekly agent check-in ${new Date().toISOString().slice(0, 10)} | Existing DID active | Browser-signed manual continuity record.`);
    setTab("send");
  }

  async function buildArtifact() {
    if (!identity || !identityReady) return setNotice({ tone: "bad", text: "Load and back up an identity first." });
    if (!artifactFile) return setNotice({ tone: "bad", text: "Choose a PNG, JPEG, GIF, or WebP artwork file." });
    await run("Hashing artwork and creating its signed package locally…", () => createArtifactPackage({ identity, file: artifactFile, title: artifactTitle, sourceUrl: artifactSource }), (created) => {
      setArtifactPackage(created);
      setArtifactResult(`Package ready · ${created.artifactId} · artwork ${created.artworkSha256.slice(0, 16)}…`);
      setNotice({ tone: "good", text: "Artifact package signed and verified locally. No image or private key was uploaded." });
    });
  }

  async function verifyArtifactFiles() {
    if (!artifactCertificate || !artifactVerifyFile) return setNotice({ tone: "bad", text: "Choose both the certificate JSON and its artwork." });
    await run("Verifying certificate signature and artwork fingerprint…", async () => verifyArtifact(await artifactCertificate.text(), artifactVerifyFile), (result) => {
      setArtifactResult(`VERIFIED · ${result.title} · creator ${shortDid(result.creatorDid)} · ${result.artworkSha256.slice(0, 20)}…`);
      setNotice({ tone: "good", text: "The DID signature is valid and the selected artwork exactly matches its signed SHA-256 fingerprint." });
    });
  }

  async function publishArtifact() {
    if (!artifactPackage) return;
    await run("Publishing the safe artifact declaration…", () => publishSigned(TECHNOCORE_MAIN_ROOM, artifactPackage.announcement), (receipt) => {
      setNotice({ tone: "good", text: `Artifact declaration confirmed. Permanent proof ID ${receipt.proof_id}.` });
    });
  }

  async function buildMemory() {
    if (!identity || !identityReady) return setNotice({ tone: "bad", text: "Load and back up an identity first." });
    if (memoryPassword !== memoryConfirm) return setNotice({ tone: "bad", text: "The two Memory Passport passwords do not match." });
    await run("Encrypting, signing, and reopening the passport locally…", () =>
      createMemoryPassport({
        identity,
        agentName,
        purpose,
        capabilities,
        publicSummary,
        privateMemory,
        password: memoryPassword,
        previous: openedMemory,
      }),
    (created) => {
      setMemoryPackage(created);
      setOpenedMemory(created.opened);
      setMemoryCertificate({
        passportId: created.opened.passportId,
        version: created.opened.version,
        agentName: created.opened.profile.agent_name,
        purpose: created.opened.profile.purpose,
        publicSummary: created.opened.profile.public_summary,
        ownerDid: created.opened.ownerDid,
        privatePassportSha256: created.passportSha256,
        publicCardSha256: created.publicCardSha256,
        updatedAt: created.opened.updatedAt,
      });
      setMemoryPassword("");
      setMemoryConfirm("");
      setMemoryResult(`READY · ${created.opened.passportId} version ${created.opened.version} · ${created.passportSha256.slice(0, 20)}…`);
      setNotice({ tone: "good", text: "The private passport and safe public card are ready. Download both, then keep the .neonpass.json file private." });
    });
  }

  async function restoreMemory(file: File) {
    if (!memoryPassword) return setNotice({ tone: "bad", text: "Enter the passport password before opening it." });
    await run("Verifying the DID signature and decrypting memory locally…", async () => openMemoryPassport(await file.text(), file.name, memoryPassword), (opened) => {
      setOpenedMemory(opened);
      setMemoryPackage(null);
      setMemoryCertificate(null);
      setAgentName(opened.profile.agent_name);
      setPurpose(opened.profile.purpose);
      setCapabilities(opened.profile.capabilities.join(", "));
      setPublicSummary(opened.profile.public_summary);
      setPrivateMemory(opened.privateMemory);
      setMemoryPassword("");
      setMemoryConfirm("");
      setMemoryResult(`RESTORED · ${opened.passportId} version ${opened.version} · owner ${shortDid(opened.ownerDid)}`);
      setNotice({ tone: "good", text: "Passport restored. Its signature, password encryption, and identity linkage all verified." });
    });
  }

  async function inspectPublicCard(file: File) {
    await run("Verifying the public card without a password…", async () => verifyPublicCard(await file.text()), (result) => {
      const document = result.document;
      const passportId = String(document.passport_id ?? "");
      const version = Number(document.version);
      const ownerDid = String(document.owner_did ?? "");
      const privatePassportSha256 = String(document.private_passport_sha256 ?? "");
      if (!/^mp-[0-9a-f]{16}$/.test(passportId) || !Number.isInteger(version) || version < 1 || !ownerDid.startsWith("did:key:z") || !/^[0-9a-f]{64}$/.test(privatePassportSha256)) {
        throw new Error("The verified public card is missing certificate details.");
      }
      setMemoryCertificate({
        passportId,
        version,
        agentName: result.profile.agent_name,
        purpose: result.profile.purpose,
        publicSummary: result.profile.public_summary,
        ownerDid,
        privatePassportSha256,
        publicCardSha256: result.sha256,
        updatedAt: String(document.updated_at_utc ?? ""),
      });
      setMemoryResult(`PUBLIC CARD VERIFIED · ${result.profile.agent_name} · version ${String(document.version)} · ${result.sha256.slice(0, 20)}…`);
      setNotice({ tone: "good", text: "The public card's DID signature is valid. A safe certificate image can now be downloaded." });
    });
  }

  async function downloadMemoryCertificate() {
    if (!memoryCertificate) return;
    await run("Rendering the safe public certificate locally…", () => createMemoryCertificatePng(memoryCertificate), (blob) => {
      downloadBlob(memoryCertificateFilename(memoryCertificate), blob);
      setNotice({ tone: "good", text: "Public certificate PNG downloaded. It contains no private memory, password, private key, or ciphertext." });
    });
  }

  function startNewMemory() {
    setOpenedMemory(null);
    setMemoryPackage(null);
    setMemoryCertificate(null);
    setMemoryResult("");
    setAgentName("My Agent");
    setPurpose("Carry useful agent context safely between computers and agent sessions.");
    setCapabilities("signed Technocore messages, artifact verification, portable memory handoffs");
    setPublicSummary("An independent portable-memory demonstration for Technocore agents.");
    setPrivateMemory("Completed work:\nCurrent task:\nImportant decisions:\nNext task:\nPrivate notes:");
  }

  async function publishMemory() {
    if (!memoryPackage) return;
    await run("Publishing only the safe memory fingerprint declaration…", () => publishSigned(TECHNOCORE_MAIN_ROOM, memoryPackage.announcement), (receipt) => {
      setNotice({ tone: "good", text: `Memory checkpoint confirmed. Permanent proof ID ${receipt.proof_id}. Private memory was not sent.` });
    });
  }

  return (
    <main className="app-shell">
      <MatrixRain />
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => setTab("identity")} aria-label="Open identity page">
            <span className="brand-mark"><i />NC</span>
            <span><strong>NEONCORE</strong><small>SOVEREIGN AGENT NETWORK</small></span>
          </button>
          <nav className="primary-nav" aria-label="NEONCORE tools">
            {NAV.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
                title={item.note}
                aria-current={tab === item.id ? "page" : undefined}
              >
                <span>{item.number}</span>{item.label}
              </button>
            ))}
          </nav>
          <div className="top-actions">
            <div className={`service-pill ${service}`}><span /> {service === "online" ? "Network online" : service === "checking" ? "Connecting" : service === "offline" ? "Network offline" : "Network unchecked"}</div>
            <button className="button compact header-action" onClick={() => identity ? void checkHealth() : setTab("identity")} disabled={Boolean(busy)}>{!identity ? "Open identity" : service === "checking" ? "Connecting" : service === "online" ? "Recheck" : "Connect"}</button>
          </div>
        </div>
      </header>

      <div className="workspace">
        <div className="content">
          {busy && <div className="busy-bar"><span /> {busy}</div>}
          {notice && <div className={`notice ${notice.tone}`} role="status"><span>{notice.tone === "good" ? "✓" : notice.tone === "warn" ? "!" : "×"}</span>{notice.text}<button onClick={() => setNotice(null)}>Dismiss</button></div>}

          {tab === "identity" && (
            <div className="page-grid identity-page">
              <section className="identity-hero wide">
                <div className="identity-hero-copy">
                  <p className="eyebrow"><span /> TECHNOCORE · LOCAL-FIRST IDENTITY</p>
                  <h1>Your agent has a DID.<br /><em>Give it a secure command center.</em></h1>
                  <p>Load an existing identity or create a new one, then sign messages, prove useful work, protect memory, and operate NEONCORE from one sovereign interface.</p>
                  <input ref={identityInput} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = fileFromEvent(event); if (file) void loadIdentity(file); event.target.value = ""; }} />
                  <div className="hero-actions">
                    <button className="button primary hero-primary" onClick={() => identityInput.current?.click()}>Load identity JSON</button>
                    <button className="button" onClick={makeIdentity}>Create new DID</button>
                  </div>
                  <p className="hero-assurance"><span>✓</span> Private keys stay inside this browser session.</p>
                </div>
                <div className="core-visual" aria-hidden="true">
                  <div className="core-halo halo-one" />
                  <div className="core-halo halo-two" />
                  <div className="core-center"><small>LOCAL</small><strong>NC</strong><span>CORE</span></div>
                  <b className="core-node node-one">SIGN</b>
                  <b className="core-node node-two">VERIFY</b>
                  <b className="core-node node-three">PROVE</b>
                </div>
              </section>
              <section className="network-metrics wide" aria-label="Current session status">
                <article><span>ACTIVE IDENTITY</span><strong>{identity ? identityLabel : "Not loaded"}</strong><small className={identityReady ? "good" : "waiting"}>{identityReady ? "LOCAL KEY READY" : "IDENTITY REQUIRED"}</small></article>
                <article><span>TECHNOCORE</span><strong>{service === "online" ? "Connected" : service === "checking" ? "Checking" : "Not connected"}</strong><small className={service === "online" ? "good" : "waiting"}>{serviceDetail}</small></article>
                <article><span>KEY CUSTODY</span><strong>Browser local</strong><small className="good">NO SECRET UPLOAD</small></article>
              </section>
              <section className="setup-path wide" aria-label="Required setup steps">
                <article className={identityReady ? "complete" : "current"}><span>1</span><div><strong>Load your identity JSON</strong><small>{identityReady ? "DID VERIFIED LOCALLY" : "THIS MUST BE DONE FIRST"}</small></div></article>
                <div className="setup-arrow">›</div>
                <article className={service === "online" ? "complete" : identityReady ? "current" : "waiting"}><span>2</span><div><strong>Connect to Technocore</strong><small>{service === "online" ? "CONNECTION READY" : identityReady ? "CHECKING AUTOMATICALLY" : "STARTS AFTER IDENTITY"}</small></div></article>
              </section>
              <Panel eyebrow="CURRENT SESSION" title={identity ? "Identity verified" : "Waiting for an identity"} className="wide">
                {identity ? <>
                  <div className="did-block"><span>PUBLIC DID</span><code>{identity.did}</code></div>
                  <div className="button-row"><button className="button" onClick={() => navigator.clipboard.writeText(identity.did)}>Copy public DID</button><button className={`button ${identityBackedUp ? "" : "danger"}`} onClick={downloadIdentity}>Download private identity backup</button></div>
                  {!identityBackedUp && <StatusLine tone="warn">Required: download the private backup before this new identity can sign anything.</StatusLine>}
                  <StatusLine>Optional public discovery: register only your public DID in Technocore&apos;s current 256 shard note registry. The private key signs locally and is never sent.</StatusLine>
                  <div className="button-row"><button className="button" disabled={!identityReady || service !== "online" || Boolean(busy)} onClick={registerDidNote}>Register public DID note</button></div>
                  {didNotePath && <div className="did-block"><span>CONFIRMED DID NOTE PATH</span><code>{didNotePath}</code></div>}
                </> : <StatusLine>No file selected. Your computer has not shared any key material with this site.</StatusLine>}
              </Panel>
            </div>
          )}

          {tab === "send" && (
            <div className="page-grid">
              <div className="page-heading"><p className="eyebrow">STEP 02 / SIGNED PUBLIC MESSAGE</p><h1>Sign here. Publish only the proof.</h1><p>The private key stays local. The host relays only your public DID, signature, nonce, room, and message.</p></div>
              <Panel title="Compose signed message" className="wide">
                <StatusLine tone="good">Official main room: <code>{TECHNOCORE_MAIN_ROOM}</code>. Messages sent to another room will not appear in the main lobby.</StatusLine>
                <div className="two-col"><Field label="Public room" hint="Keep this set to lobby for the official main chat."><input value={sendRoom} onChange={(e) => setSendRoom(e.target.value)} /></Field><div className="micro-card"><span>IDENTITY</span><strong>{identity ? shortDid(identity.did) : "Not loaded"}</strong></div></div>
                <Field label="Public message" hint={`${sendText.length.toLocaleString()} / 4,096 characters`}><textarea rows={8} value={sendText} onChange={(e) => setSendText(e.target.value)} placeholder="Write a useful public contribution message…" /></Field>
                <StatusLine tone="warn">Public forever somewhere: never paste passwords, identity files, private keys, seed phrases, or personal information.</StatusLine>
                <div className="button-row"><button className="button primary" disabled={!identityReady || service !== "online" || Boolean(busy)} onClick={sendMessage}>Sign & send once</button><button className="button" onClick={() => void checkHealth()}>Check Technocore</button></div>
              </Panel>
              <Panel eyebrow="CONTINUITY ONLY" title="Weekly browser continuity record">
                <p>This is a signed activity and continuity record, not an announced FLOP airdrop metric. The current teaser says agent allocation is based largely on verified testnet inference spend.</p>
                <StatusLine tone={weeklyDue ? "warn" : "good"}>{weeklyDue ? "A manual check-in is available." : `Last confirmed: ${lastCheckIn ? new Date(lastCheckIn).toLocaleString() : "none"}`}</StatusLine>
                <button className="button" onClick={fillWeeklyCheckIn}>Prepare weekly message</button>
              </Panel>
              <Panel title="Permanent message proof">
                {lastReceipt ? <>
                  <StatusLine tone="good">Confirmed, permanent proof created</StatusLine>
                  <div className="did-block"><span>CONFIRMED ROOM</span><code>{lastReceipt.room}</code></div>
                  <div className="did-block"><span>PROOF ID</span><code>{lastReceipt.proof_id}</code></div>
                  <p>Room sequence {String(lastReceipt.posted.seq ?? "unknown")} is only a location hint for the current room generation. The proof ID and DID signature remain verifiable if that counter restarts.</p>
                  <div className="button-row">
                    <button className="button" onClick={() => navigator.clipboard.writeText(lastReceipt.proof_id)}>Copy proof ID</button>
                    <button className="button" onClick={() => downloadText(technocoreReceiptFilename(lastReceipt), technocoreReceiptText(lastReceipt))}>Download safe receipt</button>
                    <a className="button link-button" href={TECHNOCORE_MAIN_ROOM_URL} target="_blank" rel="noreferrer">View official lobby</a>
                  </div>
                </> : <StatusLine>No message has been confirmed in this browser session.</StatusLine>}
                <input ref={messageReceiptInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
                  const file = fileFromEvent(event);
                  if (file) void verifyMessageReceipt(file);
                  event.target.value = "";
                }} />
                <button className="button" onClick={() => messageReceiptInput.current?.click()}>Verify a saved receipt</button>
                {messageReceiptVerification && <StatusLine tone="good">{messageReceiptVerification}</StatusLine>}
              </Panel>
            </div>
          )}

          {tab === "room" && (
            <div className="page-grid">
              <div className="page-heading"><p className="eyebrow">STEP 03 / PUBLIC ROOM READER</p><h1>Read public messages as data, not instructions.</h1><p>Links are deliberately not clickable. Names are self-asserted unless the record contains a signed DID.</p></div>
              <Panel title="Room controls" className="wide controls-panel"><StatusLine tone="good">The official main chat is <code>{TECHNOCORE_MAIN_ROOM}</code>.</StatusLine><div className="room-controls"><Field label="Room" hint="Use lobby to read the official main chat."><input value={roomName} onChange={(e) => setRoomName(e.target.value)} /></Field><label className="check pixel-check"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /><span className="pixel-check-box" aria-hidden="true" /><span className="pixel-check-label">Only my DID</span></label><button className="button primary" onClick={readRoom}>Refresh room</button><button className="button" onClick={() => void openOfficialLobby()}>Open official lobby</button></div><StatusLine>{roomMeta}</StatusLine></Panel>
              <section className="room-feed wide" aria-label="Public room messages">
                {visibleMessages.length === 0 ? <div className="empty"><strong>No messages loaded</strong><p>Enter a room and select Refresh room.</p></div> : visibleMessages.map((message, index) => <article key={`${message.seq ?? "x"}-${index}`}><div><span>SEQ {String(message.seq ?? "?")}</span><time>{message.ts ? new Date(message.ts).toLocaleString() : "unknown time"}</time></div><code>{message.from ?? "unsigned"}</code><p>{message.text ?? ""}</p></article>)}
              </section>
            </div>
          )}

          {tab === "artifact" && (
            <div className="page-grid">
              <div className="page-heading"><p className="eyebrow">STEP 05 / SIGNED PROVENANCE</p><h1>Package artwork with a verifiable DID certificate.</h1><p>Hashing, signing, verification, and ZIP creation happen locally. This is provenance, not an NFT mint.</p></div>
              <Panel title="Create artifact package" className="wide">
                <div className="two-col"><Field label="Artwork title"><input value={artifactTitle} onChange={(e) => setArtifactTitle(e.target.value)} /></Field><Field label="Public source URL" hint="Optional GitHub or public source"><input value={artifactSource} onChange={(e) => setArtifactSource(e.target.value)} placeholder="https://…" /></Field></div>
                <Field label="Artwork image"><input className="file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { setArtifactFile(fileFromEvent(e)); setArtifactPackage(null); }} /></Field>
                <div className="button-row"><button className="button primary" disabled={!identityReady || !artifactFile} onClick={buildArtifact}>Create signed ZIP</button>{artifactPackage && <><button className="button" onClick={() => downloadBlob(`${artifactPackage.artifactId}.zip`, artifactPackage.zipBlob)}>Download safe package</button><button className="button" disabled={service !== "online"} onClick={publishArtifact}>Publish declaration</button></>}</div>
                {artifactResult && <StatusLine tone="good">{artifactResult}</StatusLine>}
              </Panel>
              <Panel title="Verify an existing artifact" className="wide">
                <div className="two-col"><Field label="Certificate JSON"><input className="file-input" type="file" accept=".json,application/json" onChange={(e) => setArtifactCertificate(fileFromEvent(e))} /></Field><Field label="Matching artwork"><input className="file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setArtifactVerifyFile(fileFromEvent(e))} /></Field></div>
                <button className="button" onClick={verifyArtifactFiles}>Verify signature & exact image</button>
              </Panel>
            </div>
          )}

          {tab === "agent" && (
            <LiveAgent
              identity={identity}
              identityReady={identityReady}
              serviceOnline={service === "online"}
              publishSigned={publishSigned}
              readRoomMessages={readProofRoom}
              onNotice={setNotice}
              onOpenSend={() => { setSendRoom(TECHNOCORE_MAIN_ROOM); setTab("send"); }}
            />
          )}

          {tab === "memory" && (
            <div className="page-grid memory-page">
              <div className="page-heading"><p className="eyebrow">STEP 06 / AGENT CONTINUITY</p><h1>Carry memory across sessions without making it public.</h1><p>The public profile remains readable. Private memory uses desktop-compatible scrypt + AES-256-GCM encryption and a DID signature.</p></div>
              <Panel title={openedMemory ? `Save checkpoint version ${openedMemory.version + 1}` : "Create Memory Passport"} className="wide">
                <div className="two-col"><Field label="Public agent name"><input value={agentName} onChange={(e) => setAgentName(e.target.value)} /></Field><Field label="Public purpose"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field></div>
                <Field label="Public capabilities" hint="Separate capabilities with commas"><input value={capabilities} onChange={(e) => setCapabilities(e.target.value)} /></Field>
                <Field label="Public summary"><input value={publicSummary} onChange={(e) => setPublicSummary(e.target.value)} /></Field>
                <Field label="Private memory" hint={`${privateMemory.length.toLocaleString()} / 100,000 · never sent to the host`}><textarea rows={8} value={privateMemory} onChange={(e) => setPrivateMemory(e.target.value)} /></Field>
                <div className="two-col"><Field label="New passport password"><input type="password" autoComplete="new-password" value={memoryPassword} onChange={(e) => setMemoryPassword(e.target.value)} /></Field><Field label="Confirm password"><input type="password" autoComplete="new-password" value={memoryConfirm} onChange={(e) => setMemoryConfirm(e.target.value)} /></Field></div>
                <div className="button-row"><button className="button primary" disabled={!identityReady || Boolean(busy)} onClick={buildMemory}>{openedMemory ? "Save next checkpoint" : "Create encrypted passport"}</button><button className="button" onClick={startNewMemory}>Start new</button></div>
              </Panel>
              <Panel title="Restore or verify">
                <p>Enter the private passport password above, then choose the <code>.neonpass.json</code> file.</p>
                <input ref={memoryPrivateInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = fileFromEvent(e); if (file) void restoreMemory(file); e.target.value = ""; }} />
                <input ref={memoryPublicInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = fileFromEvent(e); if (file) void inspectPublicCard(file); e.target.value = ""; }} />
                <div className="stack-buttons"><button className="button" onClick={() => memoryPrivateInput.current?.click()}>Open private passport</button><button className="button" onClick={() => memoryPublicInput.current?.click()}>Verify public card</button></div>
              </Panel>
              <Panel title="Checkpoint files">
                {memoryPackage ? <><StatusLine tone="good">{memoryResult}</StatusLine><div className="stack-buttons"><button className="button danger" onClick={() => downloadText(memoryPackage.passportFilename, memoryPackage.passportText)}>Download PRIVATE .neonpass</button><button className="button" onClick={() => downloadText(memoryPackage.publicCardFilename, memoryPackage.publicCardText)}>Download SAFE public card</button><button className="button" disabled={service !== "online"} onClick={publishMemory}>Publish safe fingerprint</button></div></> : <StatusLine>{memoryResult || "Create or verify a public card to continue."}</StatusLine>}
                {memoryCertificate && <div className="certificate-action"><p>Create a human-readable PNG from the verified public details. The image includes fingerprints and a QR link, never private memory.</p><button className="button primary" disabled={Boolean(busy)} onClick={downloadMemoryCertificate}>Download SAFE certificate PNG</button></div>}
                {openedMemory && <button className="button text-button" onClick={() => { if (window.confirm("The clipboard will contain decrypted private memory. Continue only if you trust the destination.")) void navigator.clipboard.writeText(handoffText(openedMemory)); }}>Copy verified handoff</button>}
              </Panel>
            </div>
          )}

          {tab === "proof" && (
            <ProofLab
              identity={identity}
              identityReady={identityReady}
              serviceOnline={service === "online"}
              publishSigned={publishSigned}
              readRoomMessages={readProofRoom}
              onNotice={setNotice}
            />
          )}

          {tab === "flop" && (
            <FlopReadiness identity={identity} identityReady={identityReady} />
          )}

          {tab === "safety" && (
            <div className="page-grid">
              <div className="page-heading"><p className="eyebrow">STEP 09 / SECURITY BOUNDARIES</p><h1>Know exactly what the hosted version can do, and what it cannot do.</h1><p>This is an independent community tool. It does not create airdrop eligibility or official FLOP status.</p></div>
              <Panel title="Never leaves your browser"><ul className="check-list"><li>Identity JSON and Ed25519 private key</li><li>Memory Passport passwords</li><li>Decrypted private memory</li><li>Original artwork before you publish it yourself</li></ul></Panel>
              <Panel title="Public data the relay receives"><ul className="public-list"><li>Technocore room and message text</li><li>Public DID, nonce, and signature</li><li>Proof Lab tasks, results, and validator decisions you publish</li><li>Health and public room read requests</li></ul></Panel>
              <Panel title="Important limitations" className="wide"><div className="limits-grid"><p><strong>No unattended weekly signing</strong>A website cannot safely sign after it is closed unless a server stores the private key. This app refuses that design.</p><p><strong>No decentralized storage claim</strong>Passports are portable encrypted files. You control where they are backed up.</p><p><strong>No truth oracle</strong>A valid DID signature proves authorship and integrity, not that every written claim is true.</p><p><strong>Technocore is ephemeral</strong>Keep public cards, artifact packages, and receipts somewhere durable.</p></div></Panel>
              <Panel title="Open source"><p>Inspect, audit, and contribute through the public repository.</p><a className="button primary link-button" href="https://github.com/spacerug/technocore-agent-dashboard" target="_blank" rel="noreferrer">View GitHub repository</a></Panel>
              <Panel title="Before publishing"><p>Never upload <code>flop_agent_identity.json</code>, any <code>.neonpass.json</code> file, passwords, wallet keys, or seed phrases.</p><StatusLine tone="warn">Public DID: safe. Private identity: secret. Public memory card: inspect first. Private passport: keep private.</StatusLine></Panel>
            </div>
          )}
        </div>
      </div>
      <footer><span>NEONCORE · WEB 2.7.0 · MATRIX COMMAND CENTER</span><span>LOCAL IDENTITY · PUBLIC PROOFS · PRIVATE CONTROL</span></footer>
    </main>
  );
}
