import { ProofExperiment } from "./proof-lab";

export const PROOF_WATCHLIST_KEY = "neoncore-proof-watchlist:v1";
export const PROOF_LAST_ROOM_KEY = "neoncore-proof-last-room:v1";
export const MAX_WATCHED_PROOFS = 20;

export type WatchedProof = {
  schema: "neoncore/proof-watch/v1";
  room: string;
  title: string;
  requesterDid: string;
  workerDid: string | null;
  status: ProofExperiment["status"];
  passCount: number;
  failCount: number;
  requiredValidators: number;
  eventCount: number;
  latestSequence: number | null;
  deadlineAt: string;
  firstSeenAt: string;
  lastCheckedAt: string;
};

const WATCH_SCHEMA = "neoncore/proof-watch/v1" as const;
const ROOM_PATTERN = /^(?:proof|poui)-[0-9a-f]{12}$/;
const STATUSES: ProofExperiment["status"][] = [
  "empty",
  "open",
  "claimed",
  "committed",
  "revealed",
  "validated",
  "contested",
];

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isWatchedProof(value: unknown): value is WatchedProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<WatchedProof>;
  return Boolean(
    item.schema === WATCH_SCHEMA &&
    typeof item.room === "string" &&
    ROOM_PATTERN.test(item.room) &&
    typeof item.title === "string" &&
    typeof item.requesterDid === "string" &&
    (item.workerDid === null || typeof item.workerDid === "string") &&
    typeof item.status === "string" &&
    STATUSES.includes(item.status as ProofExperiment["status"]) &&
    isFiniteInteger(item.passCount) &&
    isFiniteInteger(item.failCount) &&
    isFiniteInteger(item.requiredValidators) &&
    isFiniteInteger(item.eventCount) &&
    (item.latestSequence === null || isFiniteInteger(item.latestSequence)) &&
    typeof item.deadlineAt === "string" &&
    typeof item.firstSeenAt === "string" &&
    typeof item.lastCheckedAt === "string"
  );
}

function acceptedEvents(experiment: ProofExperiment) {
  return [
    experiment.challenge,
    experiment.checkpoint,
    experiment.claim,
    experiment.commit,
    experiment.reveal,
    ...experiment.validations,
  ].filter((event) => event !== null);
}

export function watchedProofFromExperiment(
  experiment: ProofExperiment,
  previous?: WatchedProof,
  checkedAt = new Date().toISOString(),
): WatchedProof {
  if (!experiment.challenge) throw new Error("A valid Proof Lab challenge is required before it can be watched.");
  const events = acceptedEvents(experiment);
  const sequences = events
    .map((event) => event?.seq)
    .filter((sequence): sequence is number => typeof sequence === "number" && Number.isFinite(sequence));
  const createdAt = Date.parse(experiment.challenge.event.created_at_utc);
  const limitMinutes = experiment.challenge.event.definition?.time_limit_minutes ?? 0;
  const deadlineAt = Number.isFinite(createdAt) && Number.isFinite(limitMinutes)
    ? new Date(createdAt + limitMinutes * 60_000).toISOString()
    : "";
  return {
    schema: WATCH_SCHEMA,
    room: experiment.room,
    title: experiment.challenge.event.definition?.title ?? "Useful inference challenge",
    requesterDid: experiment.challenge.did,
    workerDid: experiment.claim?.did ?? null,
    status: experiment.status,
    passCount: experiment.passCount,
    failCount: experiment.failCount,
    requiredValidators: experiment.requiredValidators,
    eventCount: events.length,
    latestSequence: sequences.length > 0 ? Math.max(...sequences) : null,
    deadlineAt,
    firstSeenAt: previous?.firstSeenAt ?? checkedAt,
    lastCheckedAt: checkedAt,
  };
}

export function watchedProofChanged(previous: WatchedProof | undefined, next: WatchedProof): boolean {
  if (!previous) return false;
  return (
    previous.status !== next.status ||
    previous.eventCount !== next.eventCount ||
    previous.latestSequence !== next.latestSequence ||
    previous.passCount !== next.passCount ||
    previous.failCount !== next.failCount
  );
}

export function upsertWatchedProof(items: WatchedProof[], next: WatchedProof): WatchedProof[] {
  return [next, ...items.filter((item) => item.room !== next.room)]
    .sort((left, right) => right.lastCheckedAt.localeCompare(left.lastCheckedAt))
    .slice(0, MAX_WATCHED_PROOFS);
}

export function removeWatchedProof(items: WatchedProof[], room: string): WatchedProof[] {
  return items.filter((item) => item.room !== room);
}

export function parseWatchedProofs(text: string | null): WatchedProof[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    const unique = new Map<string, WatchedProof>();
    for (const item of value) {
      if (isWatchedProof(item) && !unique.has(item.room)) unique.set(item.room, item);
    }
    return [...unique.values()]
      .sort((left, right) => right.lastCheckedAt.localeCompare(left.lastCheckedAt))
      .slice(0, MAX_WATCHED_PROOFS);
  } catch {
    return [];
  }
}

export function serializeWatchedProofs(items: WatchedProof[]): string {
  return JSON.stringify(items.slice(0, MAX_WATCHED_PROOFS));
}
