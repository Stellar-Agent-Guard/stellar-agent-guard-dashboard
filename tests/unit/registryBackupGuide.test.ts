/**
 * Drift guard for `docs/guides/registry-backups.md` (issue #481).
 *
 * The guide is the deliverable, and its whole value is a distinction an operator
 * cannot verify from the screen: a registry backup holds addresses, not contract
 * state. prose rots; a mechanical comparison does not. Each test here takes one
 * claim the guide makes about code and checks it against the code itself, so a
 * future field on `GuardInstance`, a changed storage key or a removed section
 * fails here instead of leaving the page quietly wrong.
 *
 * The behavior itself is pinned in `tests/unit/guardRegistry.test.ts`; this file
 * only checks that the guide still describes it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  INSTANCE_LIMIT,
  INSTANCE_STORAGE_PREFIX,
  KNOWN_INSTANCES,
  looksLikeContractAddress,
  rememberInstance,
  type StorageLike,
} from "../../lib/guard/instance.ts";
import { captureRegistryBackup } from "../../lib/guard/registry.ts";

const GUIDE_PATH = "docs/guides/registry-backups.md";
const FLEET_TABLE_PATH = "components/FleetTable.tsx";
const SUMMARY_PATH = "docs/SUMMARY.md";

/**
 * The first column of the Markdown table under `heading`, as bare names.
 *
 * Mechanical on purpose: `| \`field\` | … |` is the only shape the guide uses for
 * a field list, so an editor who renames a field in the code and not the table
 * changes the list this function returns.
 */
function tableFieldNames(content: string, heading: string): string[] {
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `the guide has no heading "${heading}"`);
  const rest = content.slice(start + heading.length);
  const stop = rest.search(/^#{2,4} /m);
  const section = stop === -1 ? rest : rest.slice(0, stop);
  const names = [...section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/gm)].map(
    (match) => match[1]!,
  );
  assert.ok(names.length > 0, `no field rows found in the table under "${heading}"`);
  return names;
}

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const SAVED = "CBLQLJAG72M4XQRJMQHSKYIFVHQD7LNTNOQH2GRMCMBWMSLBSLTGTJC7";
const OTHER = "CDCYDGBGS5AZ5BZS6XY2SK2PHJHSOEGTN3N4INCK34KF6GU2BGC7Z6MB";

/** A real capture, so the field lists come from the code rather than from a type. */
function sampleBackup() {
  const storage = memoryStorage();
  rememberInstance(SAVED, "Treasury", { storage });
  rememberInstance(OTHER, "Hot wallet", { storage });
  const backup = captureRegistryBackup({ storage, activeGuard: SAVED });
  assert.equal(backup.entries.length, 2, "the fixture captured something");
  return backup;
}

describe("the registry backup guide describes the code", () => {
  it("exists and keeps the four sections the issue asks for", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    const sections = [
      "## 2. What a backup includes",
      "## 3. What a backup excludes",
      "## 4. Network scoping",
      "## 5. Restore conflicts",
      "## 6. What a backup is not",
    ];
    let cursor = -1;
    for (const section of sections) {
      const found = content.indexOf(section);
      assert.notEqual(found, -1, `missing guide section: ${section}`);
      assert.ok(found > cursor, `guide section out of order: ${section}`);
      cursor = found;
    }
  });

  it("lists exactly the fields a captured backup actually carries", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    const backup = sampleBackup();

    assert.deepEqual(
      tableFieldNames(content, "### What the backup object holds").sort(),
      Object.keys(backup).sort(),
      "the envelope table must name the fields RegistryBackup has",
    );
    assert.deepEqual(
      tableFieldNames(content, "### What each entry holds").sort(),
      Object.keys(backup.entries[0]!).sort(),
      "the entry table must name the fields a GuardInstance has",
    );

    // The guide promises five entry fields and no more; a sixth would make the
    // "what a backup includes" claim wrong even if the table were updated late.
    assert.equal(
      tableFieldNames(content, "### What each entry holds").length,
      5,
      'the guide says "Five fields, no more"',
    );
    assert.match(content, /Five fields, no more/);
  });

  it("does not claim the backup holds data the code never stores", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    const serialized = JSON.stringify(sampleBackup());
    for (const forbidden of [
      "per_tx_cap",
      "window_cap",
      "dms_grace_secs",
      "admin_frozen",
      "last_heartbeat",
      "recipients",
      "secret",
      "private_key",
    ]) {
      assert.ok(
        !serialized.includes(forbidden),
        `a backup holds ${forbidden}; the guide's exclusion list is now wrong`,
      );
    }
    // The excluded things the issue names, each with where it really lives.
    for (const phrase of [
      "per-transaction cap",
      "rolling cap",
      "recipient allowlist",
      "protocol allowlist",
      "dead-man grace",
      "heartbeat",
      "rolling spend",
      "Secret keys",
    ]) {
      assert.ok(content.includes(phrase), `the guide never mentions the excluded ${phrase}`);
    }
    assert.match(content, /readGuardSnapshot/, "the on-chain reads are cited");
    assert.match(content, /lib\/guard\/guardOps\.ts/, "guardOps is named as the source");
    assert.match(content, /lib\/guard\/fleet\.ts/, "the fleet poller is named as the source");
    assert.match(content, /On chain/, "the excluded data is placed on chain, in words");
  });

  it("states the real storage key, the entry cap and the address form", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    assert.ok(
      content.includes(INSTANCE_STORAGE_PREFIX),
      `the guide must name the bucket prefix ${INSTANCE_STORAGE_PREFIX}`,
    );
    assert.ok(content.includes(`(${INSTANCE_LIMIT})`), "the guide must state the entry cap");
    // The validator's own source carries the pattern the guide quotes.
    const pattern = /\/(\^[^/]+)\//.exec(looksLikeContractAddress.toString());
    assert.ok(pattern, "could not read the address pattern off the validator");
    assert.ok(
      content.includes(`\`${pattern![1]}\``),
      `the guide must quote the live address form ${pattern![1]}`,
    );
  });

  it("names the two network layers and says which one the undo actually relies on", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    assert.match(content, /options\.network \?\? backup\.network/);
    assert.match(content, /defaults to the backup's own network/);
    assert.match(content, /components\/GuardProvider\.tsx/);
    assert.match(content, /restoreRegistryBackup\(backup\)` with no options at all/);
    assert.match(content, /this layer never fires/, "the pass-through must not be called a guard");
    assert.match(content, /if \(instance\.network !== network\) continue;/);
    assert.match(content, /the layer that actually keeps/);
    // A Testnet address must never reach the Mainnet list; the guide says why.
    assert.match(content, /never offered in the same list/);
  });

  it("documents the restore conflicts instead of implying a clean undo", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    assert.match(content, /\[\.\.\.entries, \.\.\.saved\]/, "the merge order is quoted");
    assert.match(content, /The \*\*backup's\*\* version wins/);
    assert.match(content, /captured label is written back over your rename/);
    assert.match(content, /No conflict is raised/);
    assert.match(content, /Dropped\.?\s*\|?\s*Silently/, "silent drops are labelled silent");
    assert.match(content, /the only reported failure/i);
    // The operator-facing remedy the guide promises.
    assert.match(content, /Re-read after restoring/);
    assert.match(content, /contract is the authority/);
  });

  it("points the reader at the non-custodial boundary rather than key recovery", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    assert.match(content, /Not key recovery/);
    assert.match(content, /adr\/003-non-custodial-wallet-model\.md/);
    assert.match(content, /non-custodial/i);
    assert.match(content, /Not a policy rollback/);
    assert.match(content, /runbooks\/policy-updates\.md/);
  });

  it("excludes build-seeded guards in words the code matches", () => {
    const content = readFileSync(GUIDE_PATH, "utf8");
    assert.match(content, /KNOWN_INSTANCES/);
    assert.match(content, /loadSavedInstances/);
    assert.match(content, /a rename of one is/, "the saved-shadow nuance is part of the claim");
    // And the constants really are the only build-seeded entries.
    assert.ok(KNOWN_INSTANCES.length >= 2, "KNOWN_INSTANCES is still the seeded list");
  });
});

describe("the guide is reachable the way the issue requires", () => {
  it("is linked from the documentation index", () => {
    const summary = readFileSync(SUMMARY_PATH, "utf8");
    assert.match(summary, /\(guides\/registry-backups\.md\)/);
  });

  it("is linked from the fleet undo notice, with the ↗ documentation idiom", () => {
    const fleet = readFileSync(FLEET_TABLE_PATH, "utf8");
    assert.match(
      fleet,
      /github\.com\/Stellar-Agent-Guard\/stellar-agent-guard-dashboard\/blob\/main\/docs\/guides\/registry-backups\.md/,
      "the undo notice links this guide on GitHub, as recoveryGuidance.ts links its pages",
    );
    assert.match(fleet, /registry-backup-docs-link/);
    assert.match(fleet, /target="_blank"/);
    assert.match(fleet, /rel="noreferrer"/);
    assert.match(fleet, /↗/);
    // The copy and test ids the existing fleet tests match are untouched.
    assert.match(fleet, /data-testid="registry-cleanup-undo"/);
    assert.match(fleet, /Restore previous registry/);
    assert.match(fleet, /Nothing on chain was touched/);
  });
});
