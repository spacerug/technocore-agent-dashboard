import assert from "node:assert/strict";
import test from "node:test";

import { createArtifactPackage, verifyArtifact } from "../app/lib/artifact";
import {
  loadIdentityJson,
  signTechnocoreMessage,
  verifyBytes,
} from "../app/lib/browser-crypto";
import {
  createMemoryPassport,
  openMemoryPassport,
  verifyPublicCard,
} from "../app/lib/memory-passport";

const seedHex = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0")).join("");
const password = "correct horse battery staple";
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

test("loads a desktop identity and signs the Technocore canonical message", async () => {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex }), "test.json");
  const signed = await signTechnocoreMessage(identity, "technocore", 1234, "hello\nworld");
  assert.equal(signed.text, "hello world");
  assert.equal(
    await verifyBytes(
      identity.did,
      signed.sig,
      new TextEncoder().encode("technocore|1234|hello world"),
    ),
    true,
  );
});

test("creates, restores, updates, and independently verifies a Memory Passport", async () => {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex }), "test.json");
  const first = await createMemoryPassport({
    identity,
    agentName: "Test Agent",
    purpose: "Carry useful context.",
    capabilities: "signed messages, portable handoffs",
    publicSummary: "Public test summary.",
    privateMemory: "Private checkpoint one.",
    password,
  });
  assert.doesNotMatch(first.passportText, /Private checkpoint one/);
  assert.doesNotMatch(first.publicCardText, /ciphertext_base64url/);
  assert.doesNotMatch(first.publicCardText, /Private checkpoint one/);
  const opened = await openMemoryPassport(first.passportText, first.passportFilename, password);
  assert.equal(opened.privateMemory, "Private checkpoint one.");
  assert.equal(opened.version, 1);
  const publicResult = await verifyPublicCard(first.publicCardText);
  assert.equal(publicResult.profile.agent_name, "Test Agent");

  const second = await createMemoryPassport({
    identity,
    agentName: "Test Agent",
    purpose: "Carry useful context.",
    capabilities: "signed messages, portable handoffs",
    publicSummary: "Public test summary.",
    privateMemory: "Private checkpoint two.",
    password: "a different strong password",
    previous: opened,
  });
  assert.equal(second.opened.version, 2);
  assert.equal(second.opened.previousPassportSha256, first.passportSha256);
  await assert.rejects(
    () => openMemoryPassport(first.passportText, first.passportFilename, "this password is wrong"),
    /incorrect/,
  );
});

test("rejects a changed public Memory Passport card", async () => {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex }), "test.json");
  const created = await createMemoryPassport({
    identity,
    agentName: "Test Agent",
    purpose: "Carry useful context.",
    capabilities: "signed messages",
    publicSummary: "Original summary.",
    privateMemory: "Private checkpoint.",
    password,
  });
  const changed = JSON.parse(created.publicCardText);
  changed.public_profile.public_summary = "Changed after signing.";
  await assert.rejects(() => verifyPublicCard(JSON.stringify(changed)), /signature is invalid/);
});

test("creates and verifies an exact artwork package", async () => {
  const identity = await loadIdentityJson(JSON.stringify({ private_key_hex: seedHex }), "test.json");
  const file = new File([png], "artwork.png", { type: "image/png" });
  const created = await createArtifactPackage({
    identity,
    file,
    title: "Neon Operator #001",
    sourceUrl: "https://github.com/example/artifacts",
  });
  const verified = await verifyArtifact(created.certificateText, file);
  assert.equal(verified.artworkSha256, created.artworkSha256);
  assert.equal(verified.creatorDid, identity.did);
  const changed = new File([png, new Uint8Array([1])], "changed.png", { type: "image/png" });
  await assert.rejects(() => verifyArtifact(created.certificateText, changed), /fingerprint/);
});
