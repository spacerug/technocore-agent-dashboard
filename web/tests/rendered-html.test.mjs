import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("defines NEONCORE metadata without starter markers", () => {
  const source = readFileSync("app/layout.tsx", "utf8");
  assert.match(source, /NEONCORE \| Sovereign Agent Console/i);
  assert.doesNotMatch(source, /Starter Project/i);
  assert.doesNotMatch(source, /codex-preview/i);
});

test("renders the owner transcript and uses lobby for public conversation defaults", () => {
  const agent = readFileSync("app/components/LiveAgent.tsx", "utf8");
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  const config = readFileSync("app/lib/technocore-config.ts", "utf8");
  assert.match(agent, /OWNER CONVERSATION TRANSCRIPT/);
  assert.match(agent, /INCOMING MESSAGE/);
  assert.match(agent, /NEONCORE RESPONSE/);
  assert.match(config, /TECHNOCORE_MAIN_ROOM = "lobby"/);
  assert.match(dashboard, /setSendRoom\] = useState\(TECHNOCORE_MAIN_ROOM\)/);
  assert.match(dashboard, /setRoomName\] = useState\(TECHNOCORE_MAIN_ROOM\)/);
  assert.match(agent, /setRoom\] = useState\(TECHNOCORE_MAIN_ROOM\)/);
  assert.doesNotMatch(dashboard, /publishSigned\("technocore"/);
  assert.doesNotMatch(dashboard, /setSendRoom\("technocore"/);
});

test("brands agent operation as a single owner Control Chamber", () => {
  const agent = readFileSync("app/components/LiveAgent.tsx", "utf8");
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  assert.match(dashboard, /label: "Control Chamber", note: "Owner DID only"/);
  assert.match(agent, /Public conversation\. Private control\./);
  assert.match(agent, /Creating a new DID will not grant access/);
  assert.match(agent, /OWNER DID VERIFIED/);
  assert.match(agent, /Activate NEONCORE/);
  assert.match(agent, /Emergency stop/);
  assert.match(agent, /if \(!ownerAuthorized\) return/);
});

test("separates development inference from announced FLOP testnet spend", () => {
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  const readiness = readFileSync("app/components/FlopReadiness.tsx", "utf8");
  const agent = readFileSync("app/components/LiveAgent.tsx", "utf8");
  assert.match(dashboard, /label: "FLOP Readiness", note: "Inference meter"/);
  assert.match(dashboard, /not an announced FLOP airdrop metric/);
  assert.match(readiness, /OFFICIAL TEASER \/ SECTION 04/);
  assert.match(readiness, /ELIGIBLE FLOP SPEND/);
  assert.match(readiness, /off-network development activity/);
  assert.match(readiness, /3 spent unlocks 1/);
  assert.match(agent, /Measured model use, not FLOP testnet spend/);
});

test("uses the readable NEONCORE pixel console visual system", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  assert.match(css, /NEONCORE PIXEL CONSOLE/);
  assert.match(css, /--pixel-font:/);
  assert.match(css, /--read-font:/);
  assert.match(css, /repeating-linear-gradient\(180deg/);
  assert.match(css, /text-shadow: 3px 3px 0/);
  assert.match(css, /focus-visible/);
  assert.match(dashboard, /WEB 2\.5\.0 · PIXEL CONSOLE/);
});
