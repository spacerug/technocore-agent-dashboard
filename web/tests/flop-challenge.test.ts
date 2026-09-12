import assert from "node:assert/strict";
import test from "node:test";

import {
  createSonnetBallot,
  createSonnetRegistration,
  createSonnetRequestId,
  createSonnetTeamRequest,
  findVerifiedSonnetReceipt,
  SONNET_DEADLINE_UTC,
  SONNET_OPENING_UTC,
  SONNET_ROOMS,
  sonnetPhase,
} from "../app/lib/flop-challenge";
import { loadIdentityJson, signBytes, type BrowserIdentity } from "../app/lib/browser-crypto";

const PARTICIPANT_SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const REFEREE_SEED = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const OUTSIDER_SEED = "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f";

async function identity(seed: string, filename: string): Promise<BrowserIdentity> {
  return loadIdentityJson(JSON.stringify({ private_key_hex: seed }), filename);
}

async function signedReceipt(
  signer: BrowserIdentity,
  room: string,
  seq: number,
  payload: Record<string, unknown>,
) {
  const text = JSON.stringify(payload);
  const nonce = "9007199254740993000";
  const sig = await signBytes(signer, new TextEncoder().encode(`${room}|${nonce}|${text}`));
  return { room, seq, from: signer.did, nonce, sig, text };
}

test("creates exact official registration, team, and ballot records", async () => {
  const participant = await identity(PARTICIPANT_SEED, "participant.json");
  const registration = createSonnetRegistration({
    did: participant.did,
    role: "writer",
    xAccountUrl: "https://x.com/neoncore",
    requestId: "register-1",
  });
  assert.equal(registration.room, SONNET_ROOMS.registration);
  assert.deepEqual(JSON.parse(registration.text), {
    type: "sonnet.register.v1",
    contest_id: "sonnet-2",
    role: "writer",
    x_account_url: "https://x.com/neoncore",
    request_id: "register-1",
  });

  const team = createSonnetTeamRequest({ did: participant.did, gameId: "neoncore_1", requestId: "room-1" });
  assert.equal(team.room, SONNET_ROOMS.discovery);
  assert.equal(JSON.parse(team.text).type, "sonnet.team-request.v1");

  const ballot = createSonnetBallot({ did: participant.did, entryId: "entry:official:1", requestId: "vote-1" });
  assert.equal(ballot.room, SONNET_ROOMS.votes);
  assert.equal(JSON.parse(ballot.text).voter_did, participant.did);
});

test("enforces role-specific registration fields", async () => {
  const participant = await identity(PARTICIPANT_SEED, "participant.json");
  assert.throws(() => createSonnetRegistration({ did: participant.did, role: "writer", requestId: "r1" }), /Writers must/i);
  assert.throws(() => createSonnetRegistration({ did: participant.did, role: "voter", requestId: "r2", xAccountUrl: "https:\/\/x.com\/wrong" }), /Only writer/i);
});

test("uses stable bounded request IDs and the official contest window", () => {
  const requestId = createSonnetRequestId("register", Date.parse(SONNET_OPENING_UTC), "fixed123");
  assert.equal(requestId, `neoncore-register-${Date.parse(SONNET_OPENING_UTC)}-fixed123`);
  assert.equal(sonnetPhase(Date.parse(SONNET_OPENING_UTC) - 1), "not_open");
  assert.equal(sonnetPhase(Date.parse(SONNET_OPENING_UTC)), "open");
  assert.equal(sonnetPhase(Date.parse(SONNET_DEADLINE_UTC)), "closed");
});

test("accepts only a correctly signed referee receipt in the action room", async () => {
  const participant = await identity(PARTICIPANT_SEED, "participant.json");
  const referee = await identity(REFEREE_SEED, "referee.json");
  const outsider = await identity(OUTSIDER_SEED, "outsider.json");
  const requestId = "register-proof-1";
  const payload = {
    type: "sonnet.receipt.v1",
    contest_id: "sonnet-2",
    participant_did: participant.did,
    sender_did: participant.did,
    request_id: requestId,
    role: "voter",
    status: "accepted",
    reason: "",
  };
  const forged = await signedReceipt(outsider, SONNET_ROOMS.registration, 10, payload);
  const valid = await signedReceipt(referee, SONNET_ROOMS.registration, 11, payload);
  const receipt = await findVerifiedSonnetReceipt(
    SONNET_ROOMS.registration,
    [forged, valid],
    requestId,
    participant.did,
    referee.did,
  );
  assert.equal(receipt?.status, "accepted");
  assert.equal(receipt?.role, "voter");
  assert.equal(receipt?.seq, 11);

  const wrongRoom = await findVerifiedSonnetReceipt(
    SONNET_ROOMS.votes,
    [valid],
    requestId,
    participant.did,
    referee.did,
  );
  assert.equal(wrongRoom, null);
});

test("verifies official batched receipts without trusting unsigned fields", async () => {
  const participant = await identity(PARTICIPANT_SEED, "participant.json");
  const referee = await identity(REFEREE_SEED, "referee.json");
  const requestId = "batch-register-1";
  const batch = await signedReceipt(referee, SONNET_ROOMS.registration, 12, {
    type: "sonnet.receipts.v1",
    contest_id: "sonnet-2",
    role: "voter",
    status: "accepted",
    reason: "",
    receipts: [{ request_id: requestId, sender_did: participant.did }],
  });
  const receipt = await findVerifiedSonnetReceipt(
    SONNET_ROOMS.registration,
    [batch],
    requestId,
    participant.did,
    referee.did,
  );
  assert.equal(receipt?.status, "accepted");
  assert.equal(receipt?.role, "voter");
});
