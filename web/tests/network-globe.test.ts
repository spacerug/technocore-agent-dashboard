import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNetworkDirectory, speakerNetwork, virtualCoordinates } from "../app/lib/network-globe";

const DID_A = "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf";
const DID_B = "did:key:z6MkpKQLzB516yWvDYGMzJ5TpdfSnykf35KcuoYhjxuhyZBn";

test("normalizes bounded public room metrics and rejects unsafe room labels", () => {
  const result = normalizeNetworkDirectory({
    rooms: [
      { room: "lobby", last_seq: 91, bytes: 2000, idle_seconds: 12, topic: "hello", window: 80, zero_response_share: 1.4, nick_diversity: .62 },
      { room: "../../bad", last_seq: 100 },
      { room: "also-bad!", last_seq: 100 },
    ],
    total: 50002,
    capacity: 81920,
    bytes: 690000000,
    bytes_capacity: 5368709120,
    engagement: { window_cap: 10000, windowed_messages: 7428, zero_response_share: .11, nick_diversity: .61, windowed_note_to_message_ratio: 306.48 },
  });
  assert.equal(result.rooms.length, 1);
  assert.equal(result.rooms[0].room, "lobby");
  assert.equal(result.rooms[0].zeroResponseShare, 1);
  assert.equal(result.total, 50002);
  assert.equal(result.engagement.windowedMessages, 7428);
});

test("maps the same public identifier to a stable bounded virtual location", () => {
  const first = virtualCoordinates(DID_A);
  const second = virtualCoordinates(DID_A);
  const other = virtualCoordinates(DID_B);
  assert.deepEqual(first, second);
  assert.ok(first.lat >= -90 && first.lat <= 90);
  assert.ok(first.lon >= -180 && first.lon <= 180);
  assert.notDeepEqual(first, other);
});

test("builds speaker changes without inventing self-links or treating names as signed DIDs", () => {
  const result = speakerNetwork([
    { from: DID_A, text: "one" },
    { from: DID_A, text: "two" },
    { from: "pixel-agent", text: "three" },
    { from: DID_B, text: "four" },
  ]);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.nodes.find((node) => node.id === DID_A)?.messages, 2);
  assert.equal(result.nodes.find((node) => node.id === "pixel-agent")?.signed, false);
  assert.deepEqual(result.links.map((link) => [link.from, link.to]), [[DID_A, "pixel-agent"], ["pixel-agent", DID_B]]);
});
