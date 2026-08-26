export type LiveAgentTranscriptEntry = {
  id: string;
  room: string;
  sender_did: string;
  incoming_text: string;
  reply_text: string;
  asked_at: string;
  responded_at: string;
  proof_id: string;
  room_sequence?: number;
};

export const MAX_LIVE_AGENT_TRANSCRIPT_ENTRIES = 50;

function safeText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ").slice(0, maximum) : "";
}

export function liveAgentTranscriptKey(did: string, room: string): string {
  return `neoncore:live-agent-transcript:${did}:${room}`;
}

export function parseLiveAgentTranscript(value: string | null): LiveAgentTranscriptEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): LiveAgentTranscriptEntry[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const entry: LiveAgentTranscriptEntry = {
        id: safeText(record.id, 160),
        room: safeText(record.room, 48),
        sender_did: safeText(record.sender_did, 150),
        incoming_text: safeText(record.incoming_text, 800),
        reply_text: safeText(record.reply_text, 600),
        asked_at: safeText(record.asked_at, 40),
        responded_at: safeText(record.responded_at, 40),
        proof_id: safeText(record.proof_id, 160),
      };
      const sequence = Number(record.room_sequence);
      if (Number.isFinite(sequence) && sequence >= 0) entry.room_sequence = sequence;
      if (!entry.id || !entry.room || !entry.sender_did || !entry.incoming_text || !entry.reply_text || !entry.proof_id) return [];
      return [entry];
    }).slice(0, MAX_LIVE_AGENT_TRANSCRIPT_ENTRIES);
  } catch {
    return [];
  }
}

export function addLiveAgentTranscriptEntry(
  entries: LiveAgentTranscriptEntry[],
  entry: LiveAgentTranscriptEntry,
): LiveAgentTranscriptEntry[] {
  return [entry, ...entries.filter((item) => item.id !== entry.id)].slice(0, MAX_LIVE_AGENT_TRANSCRIPT_ENTRIES);
}
