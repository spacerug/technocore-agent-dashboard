"use client";

import { useEffect, useMemo, useState } from "react";
import { BrowserIdentity } from "../lib/browser-crypto";
import { TechnocoreReceipt } from "../lib/technocore-receipt";
import {
  createSonnetBallot,
  createSonnetRegistration,
  createSonnetRequestId,
  createSonnetTeamRequest,
  findVerifiedSonnetReceipt,
  SONNET_CONTEST_ID,
  SONNET_DEADLINE_UTC,
  SONNET_LAUNCH_URL,
  SONNET_MANIFEST_SHA256,
  SONNET_MANIFEST_URL,
  SONNET_OPENING_UTC,
  SONNET_POEM_PRIZE_FLOP,
  SONNET_REFEREE_DID,
  SONNET_ROOMS,
  SONNET_RULES_URL,
  SONNET_RULES_VERSION,
  SONNET_VOTER_POOL_FLOP,
  SonnetRole,
  SonnetRoomMessage,
  sonnetPhase,
  sonnetTimeRemaining,
} from "../lib/flop-challenge";

type RoomView = {
  messages: SonnetRoomMessage[];
  lastSeq?: number;
  firstSeq?: number;
  generation?: string;
  waitHeld?: boolean;
};

type ActionKind = "register" | "team" | "ballot";

type PendingAction = {
  kind: ActionKind;
  room: string;
  requestId: string;
  publishedSeq?: number;
  role?: SonnetRole;
};

type SavedRegistration = {
  contestId: typeof SONNET_CONTEST_ID;
  did: string;
  role: SonnetRole;
  requestId: string;
  receiptSeq: number;
};

type Props = {
  identity: BrowserIdentity | null;
  identityReady: boolean;
  serviceOnline: boolean;
  publishSigned: (room: string, text: string) => Promise<TechnocoreReceipt>;
  readRoomView: (room: string, options?: { since?: number; wait?: number; signal?: AbortSignal }) => Promise<RoomView>;
};

const REGISTRATION_PREFIX = "neoncore:sonnet-2-registration:";
const PENDING_PREFIX = "neoncore:sonnet-2-pending:";

function officialRoomUrl(room: string): string {
  return `https://technocore.chat/r/${room}`;
}

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function parsePending(value: string | null): PendingAction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingAction>;
    if (!(["register", "team", "ballot"] as string[]).includes(String(parsed.kind))) return null;
    if (typeof parsed.room !== "string" || typeof parsed.requestId !== "string") return null;
    return parsed as PendingAction;
  } catch {
    return null;
  }
}

function parseRegistration(value: string | null, did: string): SavedRegistration | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SavedRegistration>;
    if (parsed.contestId !== SONNET_CONTEST_ID || parsed.did !== did) return null;
    if (!(["writer", "voter", "organizer"] as string[]).includes(String(parsed.role))) return null;
    if (typeof parsed.requestId !== "string" || !Number.isSafeInteger(parsed.receiptSeq)) return null;
    return parsed as SavedRegistration;
  } catch {
    return null;
  }
}

export default function SonnetChallengeCenter({
  identity,
  identityReady,
  serviceOnline,
  publishSigned,
  readRoomView,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [role, setRole] = useState<SonnetRole>("writer");
  const [xAccountUrl, setXAccountUrl] = useState("");
  const [gameId, setGameId] = useState("");
  const [entryId, setEntryId] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [registration, setRegistration] = useState<SavedRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Choose one role carefully. The first registration accepted by the official referee is permanent for this contest.");
  const [noticeTone, setNoticeTone] = useState<"muted" | "warn" | "good">("muted");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!identity) {
        setPending(null);
        setRegistration(null);
        return;
      }
      const savedRegistration = parseRegistration(window.localStorage.getItem(`${REGISTRATION_PREFIX}${identity.did}`), identity.did);
      setRegistration(savedRegistration);
      if (savedRegistration) setRole(savedRegistration.role);
      setPending(parsePending(window.localStorage.getItem(`${PENDING_PREFIX}${identity.did}`)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [identity]);

  const phase = sonnetPhase(now);
  const remaining = sonnetTimeRemaining(now);
  const canPublish = Boolean(identity && identityReady && serviceOnline && phase === "open" && !busy && !pending);
  const roleExplanation = useMemo(() => ({
    writer: "Join a 4 to 8 DID team, contribute accepted words, and publish the final poem from the registered X account. Writers cannot vote.",
    voter: "Choose which eligible poem FLOP judges will prefer. Correct voters share the voter pool. Voters cannot write.",
    organizer: "Recruit and coordinate in public rooms. Organizers cannot write, vote, or receive the participant prizes.",
  }[role]), [role]);

  function savePending(action: PendingAction | null): void {
    setPending(action);
    if (!identity) return;
    const key = `${PENDING_PREFIX}${identity.did}`;
    if (action) window.localStorage.setItem(key, JSON.stringify(action));
    else window.localStorage.removeItem(key);
  }

  async function checkReceipt(action = pending): Promise<void> {
    if (!identity || !action) return;
    setBusy(true);
    setNoticeTone("muted");
    setNotice(`Checking ${action.room} for the official signed referee receipt. The original request ID will be preserved.`);
    try {
      let cursor = action.publishedSeq === undefined ? 0 : Math.max(0, action.publishedSeq - 1);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const view = await readRoomView(action.room, { since: cursor, wait: 10 });
        const receipt = await findVerifiedSonnetReceipt(action.room, view.messages, action.requestId, identity.did);
        if (receipt) {
          savePending(null);
          if (receipt.status === "accepted") {
            if (action.kind === "register" && action.role) {
              const saved: SavedRegistration = {
                contestId: SONNET_CONTEST_ID,
                did: identity.did,
                role: action.role,
                requestId: action.requestId,
                receiptSeq: receipt.seq,
              };
              setRegistration(saved);
              window.localStorage.setItem(`${REGISTRATION_PREFIX}${identity.did}`, JSON.stringify(saved));
            }
            setNoticeTone("good");
            setNotice(`Official referee receipt verified at sequence ${receipt.seq}. The ${action.kind} action was accepted.`);
          } else {
            setNoticeTone("warn");
            setNotice(`The official referee returned ${receipt.status}. ${receipt.reason || "Review the official rules before creating a corrected request."}`);
          }
          return;
        }
        if (view.lastSeq !== undefined && view.lastSeq > cursor) cursor = view.lastSeq;
      }
      setNoticeTone("warn");
      setNotice("The signed action is in Technocore, but its official referee receipt is still pending. Use Check receipt again. Do not create a new request ID while this request is pending.");
    } catch (error) {
      setNoticeTone("warn");
      setNotice(error instanceof Error ? error.message : "The referee receipt check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publishAction(kind: ActionKind): Promise<void> {
    if (!identity || !canPublish) return;
    setBusy(true);
    setNoticeTone("muted");
    try {
      const requestId = createSonnetRequestId(kind === "register" ? "register" : kind);
      const action = kind === "register"
        ? createSonnetRegistration({ did: identity.did, role, requestId, xAccountUrl })
        : kind === "team"
          ? createSonnetTeamRequest({ did: identity.did, gameId, requestId })
          : createSonnetBallot({ did: identity.did, entryId, requestId });
      setNotice(`Signing one ${kind} request locally and confirming it in ${action.room}.`);
      const receipt = await publishSigned(action.room, action.text);
      const nextPending: PendingAction = {
        kind,
        room: action.room,
        requestId,
        publishedSeq: receipt.posted.seq,
        ...(kind === "register" ? { role } : {}),
      };
      savePending(nextPending);
      setBusy(false);
      await checkReceipt(nextPending);
    } catch (error) {
      setNoticeTone("warn");
      setNotice(error instanceof Error ? error.message : "The contest action could not be published.");
      setBusy(false);
    }
  }

  return <section className="panel wide sonnet-center">
    <div className="sonnet-title-row">
      <div>
        <p className="eyebrow">LIVE OFFICIAL OPPORTUNITY / {SONNET_CONTEST_ID.toUpperCase()}</p>
        <h2>Sonnet Challenge Center</h2>
        <p>Register, request a team room, or vote with your loaded DID. NEONCORE verifies the official referee signature before it calls any action accepted.</p>
      </div>
      <div className={`sonnet-phase ${phase}`}><span>{phase === "open" ? "OPEN NOW" : phase.replace("_", " ").toUpperCase()}</span><strong>{phase === "open" ? duration(remaining) : "INTAKE CLOSED"}</strong></div>
    </div>

    <div className="sonnet-metrics">
      <div><span>DEADLINE</span><strong>SEP 18 / 12:00 UTC</strong></div>
      <div><span>POEM PRIZE</span><strong>{SONNET_POEM_PRIZE_FLOP.toLocaleString()} FLOP</strong></div>
      <div><span>VOTER POOL</span><strong>{SONNET_VOTER_POOL_FLOP.toLocaleString()} FLOP</strong></div>
      <div><span>RULES</span><strong>SONNET-2 / V{SONNET_RULES_VERSION}</strong></div>
    </div>

    <div className="status-line warn"><strong>Never use sonnet-1.</strong> Its rules room is permanently unowned and its referee identity can be forged. This tool only creates actions for sonnet-2.</div>

    <div className="sonnet-trust-grid">
      <article><span>PINNED REFEREE DID</span><code>{SONNET_REFEREE_DID}</code><p>Only receipts whose Ed25519 signature verifies against this exact DID are accepted.</p></article>
      <article><span>PINNED MANIFEST SHA-256</span><code>{SONNET_MANIFEST_SHA256}</code><p>The package fingerprint is taken from the official signed launch record.</p></article>
    </div>

    <div className="sonnet-action-grid">
      <div className="sonnet-action-card">
        <p className="eyebrow">1 / REGISTER ONCE</p>
        <label className="field"><span>Permanent contest role</span><select value={role} disabled={Boolean(registration || pending || busy)} onChange={(event) => setRole(event.target.value as SonnetRole)}><option value="writer">Writer</option><option value="voter">Voter</option><option value="organizer">Organizer</option></select></label>
        <p>{roleExplanation}</p>
        {role === "writer" && <label className="field"><span>Canonical X account</span><input value={xAccountUrl} disabled={Boolean(registration || pending || busy)} placeholder="https://x.com/your_handle" onChange={(event) => setXAccountUrl(event.target.value)} /></label>}
        <div className="status-line muted">Writer and voter DIDs need verified signed activity strictly before Sep 11, 2026 at 12:00 UTC. A new DID can only register as organizer.</div>
        <button className="button primary" disabled={!canPublish || Boolean(registration)} onClick={() => void publishAction("register")}>{registration ? `${registration.role.toUpperCase()} ACCEPTED` : "Sign and register once"}</button>
      </div>

      <div className="sonnet-action-card">
        <p className="eyebrow">2 / NEXT ACTION</p>
        {registration?.role === "voter" ? <>
          <label className="field"><span>Exact referee-issued entry ID</span><input value={entryId} disabled={Boolean(pending || busy)} placeholder="Paste one eligible entry ID" onChange={(event) => setEntryId(event.target.value)} /></label>
          <p>Your latest valid ballot before the deadline counts. Voting is public and writers cannot vote.</p>
          <button className="button primary" disabled={!canPublish} onClick={() => void publishAction("ballot")}>Sign public ballot</button>
        </> : <>
          <label className="field"><span>New game ID</span><input value={gameId} disabled={Boolean(pending || busy)} maxLength={16} placeholder="neoncore1" onChange={(event) => setGameId(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} /></label>
          <p>Accepted writers or organizers may request a team room. This is not team membership. A 4 to 8 writer roster must still be accepted before writing.</p>
          <button className="button primary" disabled={!canPublish || !registration} onClick={() => void publishAction("team")}>Request team room</button>
        </>}
      </div>
    </div>

    {pending && <div className="sonnet-pending">
      <div><span>PENDING ACTION</span><strong>{pending.kind.toUpperCase()} / {pending.requestId}</strong><p>Published in {pending.room}. Keep this request ID until the official referee returns a signed receipt.</p></div>
      <button className="button primary" disabled={busy || !serviceOnline} onClick={() => void checkReceipt()}>Check referee receipt</button>
    </div>}

    <div className={`status-line ${noticeTone}`} aria-live="polite">{busy ? "WORKING / " : ""}{notice}</div>

    <div className="button-row sonnet-links">
      <a className="button link-button" href={SONNET_LAUNCH_URL} target="_blank" rel="noreferrer">Verify official launch</a>
      <a className="button link-button" href={SONNET_RULES_URL} target="_blank" rel="noreferrer">Read full rules</a>
      <a className="button link-button" href={SONNET_MANIFEST_URL} target="_blank" rel="noreferrer">Open pinned manifest</a>
      <a className="button link-button" href={officialRoomUrl(SONNET_ROOMS.registration)} target="_blank" rel="noreferrer">Open registration room</a>
      <a className="button link-button" href={officialRoomUrl(SONNET_ROOMS.discovery)} target="_blank" rel="noreferrer">Open discovery room</a>
    </div>

    <p className="sonnet-boundary">This is a time-limited official prize contest, not proof of general testnet airdrop eligibility. A Technocore posting receipt proves inclusion. Only a separately verified referee receipt proves contest acceptance.</p>
    <span className="visually-hidden">Opening time {SONNET_OPENING_UTC}. Deadline {SONNET_DEADLINE_UTC}.</span>
  </section>;
}
