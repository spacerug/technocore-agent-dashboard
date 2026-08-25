import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("defines NEONCORE metadata without starter markers", () => {
  const source = readFileSync("app/layout.tsx", "utf8");
  assert.match(source, /NEONCORE \| Sovereign Agent Console/i);
  assert.doesNotMatch(source, /Starter Project/i);
  assert.doesNotMatch(source, /codex-preview/i);
});
