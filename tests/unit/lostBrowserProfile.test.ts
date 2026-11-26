import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { STORAGE_INVENTORY } from "../../lib/guard/storageInventory.ts";

/**
 * The lost-browser-profile runbook (#553) is followed after data is already
 * gone, so an omission cannot be repaired later. These assertions are the drift
 * guard for the promises it makes: profile loss is separated from guard loss,
 * every persisted key is enumerated as recoverable-or-not, reconnecting is
 * ordered, and no section claims a policy or key backup the console does not
 * have.
 */
const RUNBOOK = "docs/runbooks/lost-browser-profile.md";

function runbook(): string {
  return readFileSync(RUNBOOK, "utf8");
}

test("the runbook separates profile loss, wallet loss and guard loss", () => {
  const content = runbook();
  assert.match(
    content,
    /loses this browser's [_*]view[_*] of your[\s>]+guards, never the guards themselves/is,
  );
  assert.match(content, /wallet \/ extension, or its recovery phrase/i);
  assert.match(content, /the guard contract/i);
  assert.match(content, /per origin/i, "the per-origin scope of localStorage is stated");
});

test("the runbook covers the recovery path in order", () => {
  const content = runbook();
  const steps = [
    "Recover the wallet, or confirm it still exists",
    "Re-add each guard by address",
    "Re-read and confirm the on-chain state",
    "Restore the data you can, and record what you cannot",
    "Verification checklist",
  ];
  let cursor = -1;
  for (const step of steps) {
    const found = content.indexOf(step, cursor + 1);
    assert.notEqual(found, -1, `missing recovery step: ${step}`);
    assert.ok(found > cursor, `recovery step out of order: ${step}`);
    cursor = found;
  }
  assert.match(content, /character-for-character/);
  assert.match(content, /status\(\)/);
  assert.match(content, /npm run inspect -- --guard/);
  assert.match(content, /address book/i, "the address book restore path is named");
  assert.match(content, /export/i, "exports are the only recoverable copies");
});

test("every persisted key is enumerated, so no local data is silently omitted", () => {
  const content = runbook();
  for (const entry of STORAGE_INVENTORY) {
    assert.ok(
      content.includes(entry.key),
      `the runbook must enumerate the persisted key ${entry.key} (${entry.purpose})`,
    );
  }
  assert.match(content, /Unrecoverable/i);
  assert.match(content, /transaction record/i);
  assert.match(content, /drafts/i);
});

test("the runbook does not claim a policy, history or key backup", () => {
  const content = runbook();
  const claims = content.slice(content.indexOf("## 4. What this runbook does not claim"));
  assert.match(claims, /No policy backup/i);
  assert.match(claims, /does not store a copy of a policy/i);
  assert.match(claims, /Migration Wizard copies a policy from one [_*]live guard[_*] to another/i);
  assert.match(claims, /No address or history backup/i);
  assert.match(claims, /No key custody/i);
  assert.match(claims, /never sees, stores, or restores an admin or agent secret/i);
  assert.match(claims, /no API route/i);
});

test("the recovery checklist is actionable", () => {
  const checks = runbook().match(/^- \[ \] /gm) ?? [];
  assert.ok(checks.length >= 8, `expected a recovery checklist, found ${checks.length} items`);
});

test("the runbook is discoverable and linked from the incident path", () => {
  const summary = readFileSync("docs/SUMMARY.md", "utf8");
  assert.match(summary, /\(runbooks\/lost-browser-profile\.md\)/);

  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /\.\/docs\/runbooks\/lost-browser-profile\.md/);

  const emergency = readFileSync("docs/runbooks/emergency-freeze.md", "utf8");
  assert.match(emergency, /lost-browser-profile\.md/);
});
