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

test("prepares FLOP testnet activity without claiming development spend", () => {
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  const readiness = readFileSync("app/components/FlopReadiness.tsx", "utf8");
  const agent = readFileSync("app/components/LiveAgent.tsx", "utf8");
  assert.match(dashboard, /label: "FLOP Testnet", note: "Mission control"/);
  assert.match(dashboard, /not an announced FLOP airdrop metric/);
  assert.match(readiness, /OFFICIAL TEASER \/ SECTION 04/);
  assert.match(readiness, /ELIGIBLE FLOP SPEND/);
  assert.match(readiness, /off-network development activity/);
  assert.match(readiness, /3 spent unlocks 1/);
  assert.match(readiness, /90-DAY FAUCET SPEND PLANNER/);
  assert.match(readiness, /SESSION REQUEST PREPARATION/);
  assert.match(readiness, /Download testnet preparation kit/);
  assert.match(readiness, /planning_only_not_submitted/);
  assert.match(agent, /Measured model use, not FLOP testnet spend/);
});

test("uses the readable NEONCORE Matrix Command Center visual system", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  assert.match(css, /NEONCORE PIXEL CONSOLE/);
  assert.match(css, /NEONCORE MATRIX COMMAND CENTER/);
  assert.match(css, /--pixel-font:/);
  assert.match(css, /--read-font:/);
  assert.match(css, /--ui-font:/);
  assert.match(css, /repeating-linear-gradient\(180deg/);
  assert.match(css, /\.identity-hero/);
  assert.match(css, /\.primary-nav/);
  assert.match(css, /focus-visible/);
  assert.match(dashboard, /WEB 2\.9\.0 · TCLK DEAL LAB/);
  assert.match(dashboard, /Your agent has a DID/);
  assert.match(dashboard, /Current session status/);
  assert.match(css, /@media \(max-width: 1680px\)/);
  assert.match(css, /grid-row: 2/);
});

test("renders accessible DID filtering above a motion-safe Matrix background", () => {
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  const matrix = readFileSync("app/components/MatrixRain.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(dashboard, /className="check pixel-check"/);
  assert.match(dashboard, /className="pixel-check-box"/);
  assert.match(dashboard, /WEB 2\.9\.0 · TCLK DEAL LAB/);
  assert.match(matrix, /prefers-reduced-motion: reduce/);
  assert.match(matrix, /aria-hidden="true"/);
  assert.match(css, /\.matrix-rain/);
  assert.match(css, /\.app-shell::before/);
  assert.match(css, /pixel-check input:focus-visible \+ \.pixel-check-box/);
});

test("retries temporary Technocore outages after a DID loads", () => {
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  assert.match(dashboard, /connectAfterIdentityLoad/);
  assert.match(dashboard, /const delays = \[0, 2_500, 6_000, 12_000\]/);
  assert.match(dashboard, /Automatic retry/);
  assert.match(dashboard, /You do not need to reload the DID/);
});

test("shows the owner quality firewall and bounded reliability controls", () => {
  const agent = readFileSync("app/components/LiveAgent.tsx", "utf8");
  const quality = readFileSync("app/lib/live-agent-quality.ts", "utf8");
  const route = readFileSync("app/api/technocore/route.ts", "utf8");
  assert.match(agent, /Quality firewall/);
  assert.match(agent, /15 minutes per sender/);
  assert.match(agent, /RECOVERING/);
  assert.match(agent, /MAX_PENDING_TRIGGERS = 5/);
  assert.match(quality, /generic_engagement/);
  assert.match(quality, /repetitive/);
  assert.match(route, /type FetchMode = "safe-read" \| "write-once"/);
  assert.match(route, /An uncertain publish stops the session|write-once/);
});

test("renders a fail-closed TCLK Deal Lab with private recovery gating", () => {
  const dashboard = readFileSync("app/components/NeonDashboard.tsx", "utf8");
  const dealLab = readFileSync("app/components/TclkDealLab.tsx", "utf8");
  const protocol = readFileSync("app/lib/tclk-deal.ts", "utf8");
  const route = readFileSync("app/api/technocore/route.ts", "utf8");
  assert.match(dashboard, /label: "TCLK Deal Lab", note: "Alpha simulation"/);
  assert.match(dashboard, /tclk1:paper/);
  assert.match(dealLab, /ALPHA SIMULATION ONLY/);
  assert.match(dealLab, /PaperRail holds no funds/);
  assert.match(dealLab, /I stored the private recovery file safely/);
  assert.match(dealLab, /RECEIPT OUTCOME GUARD/);
  assert.match(protocol, /claims .* state is/);
  assert.match(route, /paperNoteAuthorizationText/);
  assert.match(route, /if_absent=1/);
});
