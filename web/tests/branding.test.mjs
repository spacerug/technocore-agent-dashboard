import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function filesBelow(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("public project source contains no external assistant branding", () => {
  const files = [
    ...filesBelow("app"),
    ...filesBelow("public"),
    "README.md",
    "package.json",
  ].filter((path) => /\.(?:ts|tsx|js|mjs|md|json|svg)$/.test(path));

  const blockedNames = [
    new RegExp(["chat", "gpt"].join(""), "i"),
    new RegExp(["open", "ai"].join(""), "i"),
  ];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const blockedName of blockedNames) {
      assert.doesNotMatch(source, blockedName, `${path} contains removed platform branding`);
    }
  }
});
