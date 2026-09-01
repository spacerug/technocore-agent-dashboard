export type ReplyQualityCode =
  | "accepted"
  | "empty"
  | "too_short"
  | "question_only"
  | "generic_engagement"
  | "unrelated"
  | "repetitive";

export type ReplyQualityResult = {
  ok: boolean;
  code: ReplyQualityCode;
  reason: string;
};

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "could", "does", "from",
  "have", "into", "just", "more", "neoncore", "neoncore.space", "please", "reply", "should",
  "some", "that", "their", "there", "these", "they", "this", "through", "what", "when", "where",
  "which", "while", "with", "would", "your",
]);

const GENERIC_ENGAGEMENT = [
  /^interesting[.!]?\s+(?:what|how|why)\b/i,
  /^good (?:point|perspective|question|idea)[.!]?\s+(?:what|how|why)\b/i,
  /^great (?:point|perspective|question|idea)[.!]?\s+(?:what|how|why)\b/i,
  /^that(?:'|’)s (?:interesting|great)[.!]?\s+(?:what|how|why)\b/i,
  /\bhow (?:does|would) (?:this|that|it) scale (?:long term|in practice)\??$/i,
  /\bwhat(?:'|’)s your (?:take|view|opinion)\??$/i,
  /\b(?:any )?thoughts\??$/i,
];

function withoutSignoff(value: string): string {
  return value.replace(/\|\s*(?:https?:\/\/)?(?:www\.)?neoncore\.space\/?\s*$/i, "").trim();
}

function normalized(value: string): string {
  return withoutSignoff(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string): string[] {
  return normalized(value)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !word.startsWith("did"));
}

function similarity(left: string, right: string): number {
  const leftWords = new Set(meaningfulWords(left));
  const rightWords = new Set(meaningfulWords(right));
  if (leftWords.size === 0 || rightWords.size === 0) return normalized(left) === normalized(right) ? 1 : 0;
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  return shared / new Set([...leftWords, ...rightWords]).size;
}

export function evaluateReplyQuality(
  reply: string,
  trigger: string,
  recentReplies: string[] = [],
): ReplyQualityResult {
  const cleanReply = withoutSignoff(String(reply ?? ""));
  if (!cleanReply) return { ok: false, code: "empty", reason: "The generated reply was empty." };

  const replyWords = meaningfulWords(cleanReply);
  const triggerWords = new Set(meaningfulWords(trigger));
  const overlap = replyWords.filter((word) => triggerWords.has(word)).length;

  if (GENERIC_ENGAGEMENT.some((pattern) => pattern.test(cleanReply)) && overlap < 2) {
    return { ok: false, code: "generic_engagement", reason: "The generated reply was a generic engagement prompt." };
  }

  if (/\?\s*$/.test(cleanReply) && !/[.!]\s+[^?]+\?\s*$/.test(cleanReply)) {
    return { ok: false, code: "question_only", reason: "The generated reply only pushed a question back to the sender." };
  }

  if (cleanReply.length < 28 || replyWords.length < 4) {
    return { ok: false, code: "too_short", reason: "The generated reply did not contain enough useful detail." };
  }

  if (triggerWords.size >= 2 && overlap === 0) {
    return { ok: false, code: "unrelated", reason: "The generated reply did not address the sender's subject." };
  }

  if (recentReplies.some((recent) => normalized(recent) === normalized(cleanReply) || similarity(recent, cleanReply) >= 0.72)) {
    return { ok: false, code: "repetitive", reason: "The generated reply was too similar to a recent NEONCORE response." };
  }

  return { ok: true, code: "accepted", reason: "The reply is specific, substantive, and distinct." };
}
