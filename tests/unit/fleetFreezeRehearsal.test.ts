import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The fleet freeze rehearsal runbook (#552) exists to stop an operator inventing
 * a bulk freeze during an incident. These tests pin the three promises the
 * issue names — per-guard identification, per-guard confirmation, per-guard
 * verification — plus the explicit statement that no bulk freeze is performed,
 * so a later edit cannot quietly turn the rehearsal into a one-click action.
 */
const RUNBOOK = "docs/runbooks/fleet-freeze-rehearsal.md";

function runbook(): string {
  return readFileSync(RUNBOOK, "utf8");
}

test("the runbook states plainly that bulk freeze is not performed", () => {
  const content = runbook();
  assert.match(content, /there is \*\*no bulk freeze\*\*/i);
  assert.match(content, /this runbook never performs one/i);
  assert.match(content, /one guard at a time/i);
  assert.match(content, /cannot:\*\* freeze, unfreeze, or change a policy for multiple guards/i);
  assert.match(content, /removes [_*]registry[_*] entries only/i);
});

test("every target and network is verified independently", () => {
  const content = runbook();
  const identify = content.slice(
    content.indexOf("### Step 1 — Identify the target independently"),
    content.indexOf("### Step 2"),
  );
  assert.match(identify, /character-for-character/i);
  assert.match(identify, /network pill/i);
  assert.match(identify, /Artifact identity/i);
  assert.match(identify, /Do not proceed if any of the five checks is uncertain/i);
  assert.match(content, /A guard whose\s+read failed is \*\*unknown\*\*, not frozen/i);
  assert.match(content, /Verify this guard independently/i);
});

test("confirmation is required per guard, with no reused approval", () => {
  const content = runbook();
  assert.match(content, /Tick the acknowledgement/i);
  assert.match(content, /Sign freeze/i);
  assert.match(content, /per guard because the dialog is per guard/i);
  assert.match(content, /Never reuse a confirmation/i);
  assert.match(content, /two prompts and two transactions/i);
  assert.match(content, /N confirmations and N verifications/i);
});

test("verification is a fresh on-chain read, not a fleet row", () => {
  const content = runbook();
  assert.match(content, /`admin_frozen = true` \*\*now\*\*/i);
  assert.match(content, /npm run inspect -- --guard/);
  assert.match(content, /stellar contract invoke/);
  assert.match(content, /NOT confirmed/i);
  assert.match(content, /The row is a read, not a\s+stored flag/i);
  assert.match(content, /DMS freeze, not an intrusion/i);
  assert.match(content, /diagnostic.*local to the tab/i);
});

test("the rehearsal separates tabletop, simulation and a live drill", () => {
  const content = runbook();
  assert.match(content, /Tabletop \/ read-only/i);
  assert.match(content, /Simulation mode/i);
  assert.match(content, /Live drill/i);
  assert.match(content, /render-only, with no write path reachable/i);
  assert.match(content, /A live drill that was meant to be a\s+tabletop is an outage/i);
});

test("the runbook includes an inventory and a per-guard matrix", () => {
  const content = runbook();
  assert.match(content, /Build the fleet inventory/i);
  assert.match(content, /Freeze priority/i);
  assert.match(content, /confirmation and verification matrix/i);
  assert.match(content, /Fresh `status\(\)` = frozen/i);
  assert.match(content, /after a refresh/i);
});

test("the checklist is actionable and the runbook is discoverable", () => {
  const content = runbook();
  const checks = content.match(/^- \[ \] /gm) ?? [];
  assert.ok(checks.length >= 8, `expected an inventory checklist, found ${checks.length} items`);

  const summary = readFileSync("docs/SUMMARY.md", "utf8");
  assert.match(summary, /\(runbooks\/fleet-freeze-rehearsal\.md\)/);

  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /\.\/docs\/runbooks\/fleet-freeze-rehearsal\.md/);

  const emergency = readFileSync("docs/runbooks/emergency-freeze.md", "utf8");
  assert.match(emergency, /fleet-freeze-rehearsal\.md/);
});
