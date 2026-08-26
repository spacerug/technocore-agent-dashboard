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
