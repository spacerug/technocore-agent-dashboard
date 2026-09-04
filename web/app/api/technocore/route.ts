import { TECHNOCORE_BASE_URL } from "../../lib/technocore-config";
import { verifyBytes } from "../../lib/browser-crypto";
import { capabilityToken, decodePaperRecord } from "@flop-labs/tclk";
import { paperNoteAuthorizationText, type PaperNoteCondition } from "../../lib/tclk-deal";

const BASE_URL = TECHNOCORE_BASE_URL;
const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;
const SIG_RE = /^[A-Za-z0-9_-]{80,100}$/;
const PAPER_NS_RE = /^tclk-paper-[0-9a-f]{2}$/;
const PAPER_KEY_RE = /^[0-9a-f]{14}$/;
const MAX_TCLK_EXPORT_CHARS = 6 * 1024 * 1024;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

type FetchMode = "safe-read" | "write-once";

async function technocoreFetch(url: string, init?: RequestInit, mode: FetchMode = "safe-read"): Promise<Response> {
  const attempts = mode === "safe-read" ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await wait(attempt === 1 ? 250 : 750);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "User-Agent": "Neon-Memory-Passport-Web/1.0",
          Accept: "application/json, text/plain",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (mode === "safe-read" && [502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
        await response.text().catch(() => "");
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (mode === "write-once" || attempt + 1 >= attempts) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Technocore is unavailable.");
}

function sequenceFrom(value: unknown): number | undefined {
  const sequence = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

function lastRoomSequence(payload: Record<string, unknown>): number | undefined {
  const declared = sequenceFrom(payload.last_seq);
  if (declared !== undefined) return declared;
  const messages = payload.messages as Array<Record<string, unknown>>;
  const sequences = messages.map((message) => sequenceFrom(message.seq)).filter((value): value is number => value !== undefined);
  return sequences.length > 0 ? Math.max(...sequences) : undefined;
}

function exactMessage(
  payload: Record<string, unknown>,
  did: string,
  nonce: string,
  text: string,
): Record<string, unknown> | undefined {
  const messages = payload.messages as Array<Record<string, unknown>>;
  const message = messages.find(
    (candidate) => sequenceFrom(candidate.seq) !== undefined && candidate.from === did && String(candidate.nonce) === nonce && candidate.text === text,
  );
  if (message) message.seq = sequenceFrom(message.seq);
  return message;
}

async function readRoom(room: string, limit = 100, since?: number): Promise<Record<string, unknown>> {
  const search = new URLSearchParams({
    format: "json",
    limit: String(Math.max(1, Math.min(limit, 200))),
  });
  if (since !== undefined) search.set("since", String(since));
  const response = await technocoreFetch(
    `${BASE_URL}/r/${encodeURIComponent(room)}?${search.toString()}`,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}.`);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Technocore returned an unreadable room response.");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).messages)) {
    throw new Error("Technocore returned an unexpected room response.");
  }
  return payload as Record<string, unknown>;
}

async function readRoomExport(room: string): Promise<Record<string, unknown>> {
  const response = await technocoreFetch(`${BASE_URL}/r/${encodeURIComponent(room)}/export`, {
    headers: { Accept: "application/x-ndjson, application/json, text/plain" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Technocore export returned HTTP ${response.status}.`);
  if (body.length > MAX_TCLK_EXPORT_CHARS) throw new Error("Technocore room export exceeds NEONCORE's bounded audit limit.");

  const messages: Array<Record<string, unknown>> = [];
  for (const [index, line] of body.split("\n").entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Technocore export line ${index + 1} is not valid JSON.`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Technocore export line ${index + 1} is not a message object.`);
    }
    const message = parsed as Record<string, unknown>;
    if (!Number.isSafeInteger(message.seq) || Number(message.seq) < 0 || typeof message.ts !== "string" || typeof message.from !== "string" || typeof message.text !== "string") {
      throw new Error(`Technocore export line ${index + 1} has a malformed message envelope.`);
    }
    if (message.nonce !== undefined && message.nonce !== null && typeof message.nonce !== "string" && !Number.isSafeInteger(message.nonce)) {
      throw new Error(`Technocore export line ${index + 1} has a malformed nonce.`);
    }
    if (message.sig !== undefined && message.sig !== null && typeof message.sig !== "string") {
      throw new Error(`Technocore export line ${index + 1} has a malformed signature.`);
    }
    messages.push({ ...message, room });
  }
  return {
    source: "full-export",
    complete: true,
    messages,
    last_seq: messages.length ? messages[messages.length - 1].seq : 0,
  };
}

async function didFingerprint(did: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(did));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function noteValueFromResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!! UNTRUSTED CONTENT")) return trimmed;
  const lines = trimmed.split(/\r?\n/);
  const separator = lines.findIndex((line) => line.trim() === "");
  return separator >= 0 ? lines.slice(separator + 1).join("\n").trim() : "";
}

async function readNote(ns: string, key: string): Promise<string | null> {
  const response = await technocoreFetch(`${BASE_URL}/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, {
    headers: { Accept: "text/plain" },
  });
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}.`);
  const value = noteValueFromResponse(text);
  return value || null;
}

async function confirmRoomMessage(
  room: string,
  did: string,
  nonce: string,
  text: string,
  since?: number,
): Promise<Record<string, unknown> | undefined> {
  const propagationDelays = [0, 500, 1_500, 3_000];
  for (const delay of propagationDelays) {
    if (delay > 0) await wait(delay);
    try {
      const posted = exactMessage(await readRoom(room, 200, since), did, nonce, text);
      if (posted) return posted;
    } catch {
      // A later attempt may succeed while the public service is under load.
    }
  }
  if (since !== undefined) {
    try {
      return exactMessage(await readRoom(room, 200), did, nonce, text);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function registerDidNote(body: Record<string, unknown>): Promise<Response> {
  const did = typeof body.did === "string" ? body.did.trim() : "";
  const nonce = typeof body.nonce === "number" || typeof body.nonce === "string" ? String(body.nonce) : "";
  const sig = typeof body.sig === "string" ? body.sig.trim() : "";
  if (!DID_RE.test(did) || !SIG_RE.test(sig) || !/^\d{13}$/.test(nonce)) {
    return json({ ok: false, error: "The DID note request fields are invalid." }, 400);
  }
  const requestedAt = Number(nonce);
  if (!Number.isSafeInteger(requestedAt) || Math.abs(Date.now() - requestedAt) > 5 * 60 * 1000) {
    return json({ ok: false, error: "The DID note request expired. Try again." }, 400);
  }
  const advertiseTclk = body.tclk === true;
  const tclkCapability = advertiseTclk ? capabilityToken(["paper"]) : "";
  const noteValue = advertiseTclk ? `${did} ${tclkCapability}` : did;
  const proof = new TextEncoder().encode(advertiseTclk
    ? `neoncore-did-note|${did}|${nonce}|${noteValue}`
    : `neoncore-did-note|${did}|${nonce}`);
  if (!(await verifyBytes(did, sig, proof))) {
    return json({ ok: false, error: "The DID note request signature is invalid." }, 401);
  }

  const fingerprint = await didFingerprint(did);
  const notePath = `/kv/did-${fingerprint.slice(0, 2)}/${fingerprint.slice(2)}`;
  let writeStatus: number | undefined;
  let writeAccepted = false;
  try {
    const write = await technocoreFetch(`${BASE_URL}${notePath}/set/${encodeURIComponent(noteValue)}`, {
      headers: { Accept: "text/plain" },
    }, "write-once");
    writeStatus = write.status;
    writeAccepted = write.ok;
    await write.text();
  } catch {
    // A write can reach Technocore even if its response is lost. Read back the
    // exact note before deciding whether registration succeeded.
  }

  try {
    const check = await technocoreFetch(`${BASE_URL}${notePath}`, { headers: { Accept: "text/plain" } });
    const registeredValue = noteValueFromResponse(await check.text());
    if (check.ok && registeredValue === noteValue) {
      return json({
        ok: true,
        registered: true,
        did,
        fingerprint,
        path: notePath,
        value: noteValue,
        capability: tclkCapability || undefined,
        detail: "The public DID note was confirmed in Technocore's sharded registry.",
      });
    }
  } catch {
    // Return one clear unconfirmed result below.
  }
  const statusDetail = writeStatus && !writeAccepted ? ` The write returned HTTP ${writeStatus}.` : "";
  return json({ ok: false, confirmed: false, error: `Technocore did not confirm the public DID note.${statusDetail} Do not immediately register it again. Check the note path after the service recovers.` }, 502);
}

function parsePaperCondition(value: unknown): PaperNoteCondition | null {
  if (value === null || value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) return null;
  if (record.if_absent === true) return { ifAbsent: true };
  if (typeof record.if === "string" && decodePaperRecord(record.if)) return { if: record.if };
  return null;
}

async function setTclkPaperNote(body: Record<string, unknown>): Promise<Response> {
  const did = typeof body.did === "string" ? body.did.trim() : "";
  const nonceText = typeof body.nonce === "number" || typeof body.nonce === "string" ? String(body.nonce) : "";
  const ns = typeof body.ns === "string" ? body.ns.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const value = typeof body.value === "string" ? body.value : "";
  const sig = typeof body.sig === "string" ? body.sig.trim() : "";
  const condition = parsePaperCondition(body.condition);
  if (!DID_RE.test(did) || !/^\d{13}$/.test(nonceText) || !PAPER_NS_RE.test(ns) || !PAPER_KEY_RE.test(key) || !SIG_RE.test(sig) || !decodePaperRecord(value) || condition === null) {
    return json({ ok: false, error: "The signed PaperRail note request is invalid." }, 400);
  }
  const nonce = Number(nonceText);
  if (!Number.isSafeInteger(nonce) || Math.abs(Date.now() - nonce) > 5 * 60 * 1000) {
    return json({ ok: false, error: "The PaperRail note request expired. Refresh the deal and try again." }, 400);
  }
  const authorization = paperNoteAuthorizationText({ did, nonce, ns, key, value, condition });
  if (!(await verifyBytes(did, sig, new TextEncoder().encode(authorization)))) {
    return json({ ok: false, error: "The PaperRail authorization signature is invalid." }, 401);
  }

  const query = condition === undefined
    ? ""
    : "ifAbsent" in condition
      ? "?if_absent=1"
      : `?if=${encodeURIComponent(condition.if)}`;
  let responseStatus: number | undefined;
  try {
    const response = await technocoreFetch(
      `${BASE_URL}/kv/${encodeURIComponent(ns)}/${encodeURIComponent(key)}/set/${encodeURIComponent(value)}${query}`,
      { headers: { Accept: "text/plain" } },
      "write-once",
    );
    responseStatus = response.status;
    await response.text();
    if (response.status === 409) {
      return json({ ok: true, applied: false, current: await readNote(ns, key) });
    }
  } catch {
    // The write may have landed even if the response was lost. Exact readback decides.
  }

  try {
    const confirmed = await readNote(ns, key);
    if (confirmed === value) return json({ ok: true, applied: true, value, path: `/kv/${ns}/${key}` });
  } catch {
    // Return one fail-closed result below.
  }
  return json({ ok: false, applied: false, error: `Technocore did not confirm the PaperRail note${responseStatus ? ` after HTTP ${responseStatus}` : ""}. Do not repeat the deal action until the note is checked.` }, 502);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "health";
  try {
    if (action === "health") {
      const response = await technocoreFetch(`${BASE_URL}/healthz`, { headers: { Accept: "text/plain" } });
      const body = await response.text();
      if (!response.ok) return json({ ok: false, error: `Technocore returned HTTP ${response.status}.` }, 502);
      return json({ ok: true, status: body.trim() || "OK" });
    }
    if (action === "room") {
      const room = (url.searchParams.get("room") ?? "").trim();
      if (!ROOM_RE.test(room)) return json({ ok: false, error: "Invalid room name." }, 400);
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
      return json({ ok: true, payload: await readRoom(room, Number.isFinite(limit) ? limit : 100) });
    }
    if (action === "tclk_export") {
      const room = (url.searchParams.get("room") ?? "").trim();
      if (!ROOM_RE.test(room)) return json({ ok: false, error: "Invalid TCLK export room name." }, 400);
      return json({ ok: true, payload: await readRoomExport(room) });
    }
    if (action === "tclk_paper_get") {
      const ns = (url.searchParams.get("ns") ?? "").trim();
      const key = (url.searchParams.get("key") ?? "").trim();
      if (!PAPER_NS_RE.test(ns) || !PAPER_KEY_RE.test(key)) return json({ ok: false, error: "Invalid PaperRail note path." }, 400);
      return json({ ok: true, value: await readNote(ns, key), path: `/kv/${ns}/${key}` });
    }
    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Technocore timed out." : error instanceof Error ? error.message : "Technocore is unavailable.";
    return json({ ok: false, error: message }, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "The signed request is not readable JSON." }, 400);
  }
  if (body.action === "register_did") {
    try {
      return await registerDidNote(body);
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "Technocore timed out." : error instanceof Error ? error.message : "Technocore is unavailable.";
      return json({ ok: false, error: message }, 502);
    }
  }
  if (body.action === "tclk_paper_set") {
    try {
      return await setTclkPaperNote(body);
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "Technocore timed out." : error instanceof Error ? error.message : "Technocore is unavailable.";
      return json({ ok: false, error: message }, 502);
    }
  }
  const room = typeof body.room === "string" ? body.room.trim() : "";
  const did = typeof body.did === "string" ? body.did.trim() : "";
  const sig = typeof body.sig === "string" ? body.sig.trim() : "";
  const nonce = typeof body.nonce === "number" || typeof body.nonce === "string" ? String(body.nonce) : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!ROOM_RE.test(room) || !DID_RE.test(did) || !SIG_RE.test(sig) || !/^\d{1,19}$/.test(nonce)) {
    return json({ ok: false, error: "The signed request fields are invalid." }, 400);
  }
  if (!text.trim() || text.length > 4096 || /[\r\n]/.test(text)) {
    return json({ ok: false, error: "The public message is empty, too long, or not single-line." }, 400);
  }

  let baselineSequence: number | undefined;
  try {
    baselineSequence = lastRoomSequence(await readRoom(room, 1));
  } catch {
    // The write may still work. A direct sequence or full room read can be used for confirmation.
  }

  let writeError = "Technocore did not confirm the signed write.";
  let directSequence: number | undefined;
  try {
    // Technocore is intentionally GET-native. Use the same signed lane as the
    // original desktop agent so browser users do not depend on its optional
    // POST compatibility path.
    const signedUrl = `${BASE_URL}/r/${encodeURIComponent(room)}/say-signed/${encodeURIComponent(did)}/${encodeURIComponent(sig)}/${encodeURIComponent(nonce)}/${encodeURIComponent(text)}`;
    const response = await technocoreFetch(signedUrl, {
      headers: { Accept: "text/plain" },
    }, "write-once");
    const responseText = await response.text();
    if (response.ok) {
      const firstLine = responseText.split(/\r?\n/, 1)[0]?.trim() ?? "";
      const lineMatch = firstLine.match(/^\[(\d+)]\s+(\S+)/);
      if (lineMatch) directSequence = sequenceFrom(lineMatch[1]);
      writeError = "Technocore acknowledged the signed write, but NEONCORE could not confirm exact room inclusion. Do not resend yet. Refresh the official room and check your DID.";
    } else {
      writeError = `Technocore returned HTTP ${response.status}.`;
    }
  } catch (error) {
    writeError = error instanceof Error ? error.message : writeError;
  }

  // A write response is not room inclusion proof. Read the official room and
  // require the exact DID, nonce, and text before creating a confirmed receipt.
  const since = baselineSequence ?? (directSequence !== undefined ? Math.max(0, directSequence - 1) : undefined);
  const posted = await confirmRoomMessage(room, did, nonce, text, since);
  if (posted) {
    return json({
      ok: true,
      confirmed: true,
      posted,
      detail: "The exact signed message was read back from the Technocore room.",
    });
  }
  return json({ ok: false, confirmed: false, error: writeError }, 502);
}
