export type RoomDirectoryEntry = {
  room: string;
  lastSeq: number;
  bytes: number;
  idleSeconds: number;
  topic: string;
  window: number;
  zeroResponseShare?: number;
  nickDiversity?: number;
};

export type NetworkDirectory = {
  rooms: RoomDirectoryEntry[];
  total: number;
  capacity: number;
  bytes: number;
  bytesCapacity: number;
  engagement: {
    windowCap: number;
    windowedMessages: number;
    zeroResponseShare?: number;
    nickDiversity?: number;
    noteToMessageRatio?: number;
  };
};

export type PublicRoomMessage = {
  seq?: number;
  ts?: string;
  from?: string;
  text?: string;
  nonce?: number | string;
  sig?: string;
};

export type VirtualPoint = { lat: number; lon: number };
export type SpeakerNode = VirtualPoint & { id: string; signed: boolean; messages: number };
export type SpeakerLink = { from: string; to: string; fromPoint: VirtualPoint; toPoint: VirtualPoint };

const ROOM_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{40,100}$/;

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegative(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

function share(value: unknown): number | undefined {
  const numeric = finiteNumber(value, Number.NaN);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : undefined;
}

export function normalizeNetworkDirectory(input: unknown): NetworkDirectory {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const rawRooms = Array.isArray(source.rooms) ? source.rooms : [];
  const rooms: RoomDirectoryEntry[] = [];
  for (const candidate of rawRooms.slice(0, 200)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const room = typeof record.room === "string" ? record.room.trim() : "";
    if (!ROOM_RE.test(room)) continue;
    rooms.push({
      room,
      lastSeq: Math.floor(nonNegative(record.last_seq)),
      bytes: Math.floor(nonNegative(record.bytes)),
      idleSeconds: nonNegative(record.idle_seconds),
      topic: typeof record.topic === "string" ? record.topic.slice(0, 240) : "",
      window: Math.floor(nonNegative(record.window)),
      zeroResponseShare: share(record.zero_response_share),
      nickDiversity: share(record.nick_diversity),
    });
  }
  const rawEngagement = source.engagement && typeof source.engagement === "object" && !Array.isArray(source.engagement)
    ? source.engagement as Record<string, unknown>
    : {};
  return {
    rooms,
    total: Math.floor(nonNegative(source.total)),
    capacity: Math.floor(nonNegative(source.capacity)),
    bytes: Math.floor(nonNegative(source.bytes)),
    bytesCapacity: Math.floor(nonNegative(source.bytes_capacity)),
    engagement: {
      windowCap: Math.floor(nonNegative(rawEngagement.window_cap)),
      windowedMessages: Math.floor(nonNegative(rawEngagement.windowed_messages)),
      zeroResponseShare: share(rawEngagement.zero_response_share),
      nickDiversity: share(rawEngagement.nick_diversity),
      noteToMessageRatio: nonNegative(rawEngagement.windowed_note_to_message_ratio),
    },
  };
}

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function virtualCoordinates(key: string): VirtualPoint {
  const longitudeUnit = hash32(key, 2166136261) / 0xffffffff;
  const latitudeUnit = hash32(key, 2246822519) / 0xffffffff;
  const latitude = Math.asin(Math.max(-1, Math.min(1, latitudeUnit * 2 - 1))) * 180 / Math.PI;
  return { lat: latitude, lon: longitudeUnit * 360 - 180 };
}

export function speakerNetwork(messages: PublicRoomMessage[]): { nodes: SpeakerNode[]; links: SpeakerLink[] } {
  const nodesById = new Map<string, SpeakerNode>();
  const orderedSpeakers: string[] = [];
  for (const message of messages.slice(-200)) {
    const id = typeof message.from === "string" && message.from.trim() ? message.from.trim().slice(0, 180) : "";
    if (!id) continue;
    const current = nodesById.get(id);
    if (current) current.messages += 1;
    else nodesById.set(id, { id, signed: DID_RE.test(id), messages: 1, ...virtualCoordinates(id) });
    orderedSpeakers.push(id);
  }

  const links: SpeakerLink[] = [];
  for (let index = 1; index < orderedSpeakers.length && links.length < 100; index += 1) {
    const from = orderedSpeakers[index - 1];
    const to = orderedSpeakers[index];
    if (from === to) continue;
    const fromNode = nodesById.get(from);
    const toNode = nodesById.get(to);
    if (fromNode && toNode) links.push({ from, to, fromPoint: fromNode, toPoint: toNode });
  }
  return { nodes: Array.from(nodesById.values()).slice(0, 60), links: links.slice(-80) };
}

export function isSignedDid(value: string): boolean {
  return DID_RE.test(value);
}
