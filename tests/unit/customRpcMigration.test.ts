import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NETWORK, TESTNET } from "../../lib/guard/network.ts";

/**
 * The custom-RPC migration runbook (#554) is an operational sequence: a wrong
 * endpoint, a stale node or a mismatched passphrase changes what the operator
 * believes about a live guard. These tests pin the acceptance criteria — the
 * pre-change checks, endpoint-vs-network distinction, identity confirmation,
 * post-change read verification and rollback — and keep the documented defaults
 * in step with `lib/guard/network.ts`.
 */
const RUNBOOK = "docs/runbooks/custom-rpc-migration.md";

function runbook(): string {
  return readFileSync(RUNBOOK, "utf8");
}

test("the runbook distinguishes the endpoint from the network, explicitly", () => {
  const content = runbook();
  assert.match(content, /The endpoint is not the network/i);
  assert.match(content, /two different migrations/i);
  assert.match(content, /passphrase/i, "network identity is the passphrase, not the URL");
  assert.match(content, /Guard addresses\s+\| Unchanged/i);
  assert.match(content, /not portable/i);
});

test("it documents the actual build-time configuration, not an in-app switcher", () => {
  const content = runbook();
  for (const variable of [
    "NEXT_PUBLIC_RPC_URL",
    "NEXT_PUBLIC_NETWORK_PASSPHRASE",
    "NEXT_PUBLIC_NETWORK_NAME",
    "NEXT_PUBLIC_ARTIFACT_SOURCE_CONTRACT_ID",
    "NEXT_PUBLIC_GUARD_CONTRACT_ID",
  ]) {
    assert.ok(content.includes(variable), `missing configuration variable: ${variable}`);
  }
  assert.match(content, /build time/i);
  assert.match(content, /rebuild/i);
  assert.match(content, /no runtime/i);
  assert.match(content, /rpcPool\.ts/);
  // The documented defaults must match the code, or a reader is misled.
  assert.ok(content.includes(TESTNET.rpcUrl), "documented default RPC URL matches network.ts");
  assert.ok(
    content.includes(TESTNET.passphrase),
    "documented default passphrase matches network.ts",
  );
  assert.ok(content.includes(NETWORK.name), "the current network name is referenced");
});

test("the pre-checks cover reachability, identity and capability", () => {
  const content = runbook();
  for (const probe of [
    "getHealth",
    "getNetwork",
    "getLatestLedger",
    "getEvents",
    "getLedgerEntries",
    "simulateTransaction",
    "sendTransaction",
  ]) {
    assert.ok(content.includes(probe), `missing endpoint capability check: ${probe}`);
  }
  assert.match(content, /CORS/);
  assert.match(content, /event retention/i);
  assert.match(content, /never gains the ability to sign|never gains the ability/i);
  assert.match(content, /Never\*{0,2}\s+put an API token/i);
});

test("identity confirmation covers guard, network and artifact", () => {
  const content = runbook();
  assert.match(content, /Guard address.*character-for-character/is);
  assert.match(content, /wallet passphrase must equal/i);
  assert.match(content, /is Phase 1 artifact/);
  assert.match(content, /Endpoint reachability is not guard health/i);
  assert.match(content, /`status\(\)`, `policy\(\)` and `window\(\)`/i);
});

test("the sequence and verification checklist include the cursor and rollback caveats", () => {
  const content = runbook();
  const sections = [
    "Pre-checks",
    "Identity confirmation",
    "Migration sequence",
    "Post-change verification checklist",
    "Cursors, gaps and event retention",
    "Rollback",
    "Failure modes",
  ];
  let cursor = -1;
  for (const section of sections) {
    const found = content.indexOf(section, cursor + 1);
    assert.notEqual(found, -1, `missing section: ${section}`);
    assert.ok(found > cursor, `section out of order: ${section}`);
    cursor = found;
  }
  assert.match(content, /cursor_regressed|ledger gap/i);
  assert.match(
    content,
    /not undone by pointing back/i,
    "rollback does not pretend to undo a write",
  );
  assert.match(
    content,
    /A restart alone does not change an inlined|restart alone does not change/i,
  );
  assert.match(content, /429/);
  assert.match(content, /Do not resend/i);
});

test("the post-change checklist is actionable", () => {
  const section = runbook().slice(runbook().indexOf("## 6. Post-change verification checklist"));
  const checks = section.match(/^- \[ \] /gm) ?? [];
  assert.ok(checks.length >= 8, `expected a verification checklist, found ${checks.length} items`);
});

test("the runbook is discoverable from SUMMARY, README and the FAQ", () => {
  const summary = readFileSync("docs/SUMMARY.md", "utf8");
  assert.match(summary, /\(runbooks\/custom-rpc-migration\.md\)/);

  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /\.\/docs\/runbooks\/custom-rpc-migration\.md/);

  const faq = readFileSync("docs/faq.md", "utf8");
  assert.match(faq, /custom-rpc-migration\.md/);
});
