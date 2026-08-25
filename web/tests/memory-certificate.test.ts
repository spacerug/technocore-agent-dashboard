import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createMemoryCertificatePng,
  MemoryCertificateData,
  memoryCertificateFilename,
} from "../app/lib/memory-certificate";

const VALID_DATA: MemoryCertificateData = {
  passportId: "mp-8ce11e021a9e405f",
  version: 1,
  agentName: "Neon Memory",
  purpose: "Carry useful agent context safely between sessions.",
  publicSummary: "Public test profile.",
  ownerDid: "did:key:z6MkvNuQBWuTsmqZQaDPrnkWYZYvByG58a2y3GgPS3PsfCvf",
  privatePassportSha256: "c2a295040f6b771de05b27edd168534536b4556d9d946599aaa70fdee81892e6",
  publicCardSha256: "d01639e377220a0bc3e26d4a568287e34ead38abeaf520061b9dacd9742d129d",
  updatedAt: "2026-08-25T03:00:00Z",
};

test("uses a public, descriptive certificate filename", () => {
  assert.equal(memoryCertificateFilename(VALID_DATA), "mp-8ce11e021a9e405f-v1-public-certificate.png");
});

test("rejects invalid certificate fingerprints before rendering", async () => {
  await assert.rejects(
    createMemoryCertificatePng({ ...VALID_DATA, publicCardSha256: "not-a-hash" }),
    /fingerprints are invalid/i,
  );
});

test("visible application source contains no en dash or em dash characters", async () => {
  const appDirectory = path.resolve("app");
  const entries = await readdir(appDirectory, { recursive: true });
  const visibleSources = entries.filter((entry) => /\.(?:ts|tsx|css)$/.test(entry));
  const source = (await Promise.all(visibleSources.map((entry) => readFile(path.join(appDirectory, entry), "utf8")))).join("\n");
  assert.doesNotMatch(source, /[—–]/u);
});
