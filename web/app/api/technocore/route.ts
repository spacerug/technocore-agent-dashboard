import { TECHNOCORE_BASE_URL } from "../../lib/technocore-config";

const BASE_URL = TECHNOCORE_BASE_URL;
const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;
const SIG_RE = /^[A-Za-z0-9_-]{80,100}$/;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function technocoreFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": "Neon-Memory-Passport-Web/1.0",
        Accept: "application/json, text/plain",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readRoom(room: string, limit = 100): Promise<Record<string, unknown>> {
  const response = await technocoreFetch(
    `${BASE_URL}/r/${encodeURIComponent(room)}?format=json&limit=${Math.max(1, Math.min(limit, 200))}`,
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

  let writeError = "Technocore did not confirm the signed write.";
  try {
    // Technocore is intentionally GET-native. Use the same signed lane as the
    // original desktop agent so browser users do not depend on its optional
    // POST compatibility path.
    const signedUrl = `${BASE_URL}/r/${encodeURIComponent(room)}/say-signed/${encodeURIComponent(did)}/${encodeURIComponent(sig)}/${encodeURIComponent(nonce)}/${encodeURIComponent(text)}`;
    const response = await technocoreFetch(signedUrl, {
      headers: { Accept: "text/plain" },
    });
    const responseText = await response.text();
    if (response.ok) {
      const firstLine = responseText.split(/\r?\n/, 1)[0]?.trim() ?? "";
      const lineMatch = firstLine.match(/^\[(\d+)]\s+(\S+)/);
      const posted: Record<string, unknown> = { from: did, nonce, text };
      if (lineMatch) {
        posted.seq = Number(lineMatch[1]);
        posted.ts = lineMatch[2];
      }
      return json({
        ok: true,
        confirmed: true,
        posted,
        detail: "Technocore accepted the native signed write.",
      });
    } else {
      writeError = `Technocore returned HTTP ${response.status}.`;
    }
  } catch (error) {
    writeError = error instanceof Error ? error.message : writeError;
  }

  // A timeout may occur after Technocore stored the write. Read before the
  // browser suggests any retry so users cannot accidentally post duplicates.
  try {
    const payload = await readRoom(room, 200);
    const messages = payload.messages as Array<Record<string, unknown>>;
    const posted = messages.find((message) => message.from === did && String(message.nonce) === nonce);
    if (posted) {
      return json({
        ok: true,
        confirmed: true,
        posted,
        detail: "The write response failed, but the signed message was found in the room.",
      });
    }
  } catch {
    // Preserve the original write failure as the useful error message.
  }
  return json({ ok: false, confirmed: false, error: writeError }, 502);
}
