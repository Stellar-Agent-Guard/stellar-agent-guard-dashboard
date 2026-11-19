/**
 * Downloaded artifacts stay public-data-only (issue #547).
 *
 * Every file the console lets an operator download is produced by one of the
 * writers below. This suite seeds each writer with secret-shaped values — a
 * Stellar secret seed, a credential in a URL, a bearer token — wherever an
 * input can carry free text, then scans the generated artifact for anything
 * secret-shaped. It also asserts the opposite: public identifiers (`G…`
 * accounts, `C…` contracts, transaction hashes) survive, so the guarantee is
 * not bought by masking everything.
 *
 * Writers covered (and the download that uses each):
 *   - telemetry CSV / JSON   `eventsToCsv`, `eventsToJson` (serialized) (TelemetryFeed)
 *   - telemetry CSV / NDJSON `telemetryToCsv`, `telemetryToNdjson`
 *   - audit log NDJSON       `telemetryToAuditLog`               (TelemetryFeed)
 *   - deployment receipt     `compileDeploymentReceipt` + `formatDeploymentReceipt` (DeployPanel)
 *   - address book JSON      `exportAddressBook`                 (AddressBookModal)
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GUARD_EVENT_TOPICS, type GuardEvent } from "stellar-agent-guard-sdk";
import { withIdentity } from "../mocks/eventFixtures.ts";
import { eventsToCsv, eventsToJson } from "../../lib/guard/eventExport.ts";
import { telemetryToCsv, telemetryToNdjson } from "../../lib/guard/telemetryExport.ts";
import { telemetryToAuditLog } from "../../lib/guard/exportFormats.ts";
import { EMPTY_TELEMETRY_FILTER } from "../../lib/guard/telemetryExport.ts";
import { compileDeploymentReceipt, formatDeploymentReceipt } from "../../lib/guard/printReport.ts";
import { exportAddressBook } from "../../lib/guard/addressBook.ts";

/** A syntactically valid Stellar secret seed (never a real key). */
const SECRET_SEED = "SBEZM7Q5NNFDA7HEDPJ7QXSDRWVIOFBLYACN5RW4JCDXZ6HNVXRQRCVO";
const URL_WITH_CREDENTIAL = "https://rpc.example.com/?api_key=sk_live_51HyperSecretValue&x=1";
const BEARER = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.signature";

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const RECIPIENT = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";
const TX_HASH = "aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44";

/** Patterns that must never appear in a downloaded artifact. */
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["Stellar secret seed", /S[A-Z2-7]{55}/],
  ["credential query parameter", /api_key=sk_live/i],
  ["bearer token", /Bearer\s+eyJ/],
];

function assertNoSecrets(name: string, artifact: string): void {
  for (const [label, pattern] of SECRET_PATTERNS) {
    assert.doesNotMatch(artifact, pattern, `${name} contains a ${label}`);
  }
}

/** An event whose free-text fields all carry secret-shaped values. */
function hostileEvent(): GuardEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "ledger",
    contractId: GUARD,
    ledger: 2_000_000,
    ledgerClosedAt: "2026-11-19T10:00:00.000Z",
    transactionHash: TX_HASH,
    decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "ledger" },
    data: {
      recipient: RECIPIENT,
      memo: SECRET_SEED,
      note: URL_WITH_CREDENTIAL,
      header: BEARER,
      nested: { deeper: [SECRET_SEED] },
    },
    observedAt: "2026-11-19T10:00:01.000Z",
  });
}

describe("downloaded artifacts carry no secret-shaped values", () => {
  test("telemetry exports omit the decoded payload, so seeded secrets never reach the file", () => {
    const events = [hostileEvent()];
    const artifacts: Record<string, string> = {
      "events CSV": eventsToCsv(events, GUARD),
      "events JSON": JSON.stringify(eventsToJson(events, GUARD)),
      "telemetry CSV": telemetryToCsv(events),
      "telemetry NDJSON": telemetryToNdjson(events),
      "audit log": telemetryToAuditLog({
        events,
        bufferedCount: events.length,
        guard: GUARD,
        network: "testnet",
        filter: EMPTY_TELEMETRY_FILTER,
        latestLedger: 2_000_001,
        demo: false,
        exportedAt: new Date("2026-11-19T10:05:00.000Z"),
      }),
    };
    for (const [name, artifact] of Object.entries(artifacts)) {
      assert.ok(artifact.length > 0, `${name} is empty`);
      assertNoSecrets(name, artifact);
      // Public identifiers are kept, so redaction is not over-broad.
      assert.match(artifact, new RegExp(GUARD), `${name} lost the guard address`);
    }
    // The ones that carry the transaction keep its hash too.
    assert.match(artifacts["events CSV"] ?? "", new RegExp(TX_HASH));
    assert.match(artifacts["audit log"] ?? "", new RegExp(TX_HASH));
  });

  test("the deployment receipt redacts secrets from failure details and keeps addresses", () => {
    const receipt = compileDeploymentReceipt({
      network: { name: "testnet", passphrase: "Test SDF Network ; September 2015" },
      predictedAddress: GUARD,
      deployedAddress: GUARD,
      pinned: { hash: "f".repeat(64), bytes: 1 },
      read: { ok: false, error: `read failed via ${URL_WITH_CREDENTIAL} with ${SECRET_SEED}` },
      steps: [
        {
          label: "upload_contract_wasm",
          result: { kind: "submitted", hash: TX_HASH, status: "SUCCESS", ledger: 100, events: [] },
        },
        {
          label: "create_custom_contract",
          result: { kind: "rejected", error: `${BEARER} ${SECRET_SEED}` } as never,
        },
      ],
      capturedAt: "2026-11-19T10:00:00.000Z",
    });
    const artifact = formatDeploymentReceipt(receipt);
    assertNoSecrets("deployment receipt", artifact);
    assert.match(artifact, new RegExp(GUARD));
    assert.match(artifact, new RegExp(TX_HASH));
  });

  test("the address book export holds addresses and labels only", () => {
    const artifact = exportAddressBook(
      [
        { address: RECIPIENT, label: "Treasury", addedAt: "2026-11-19T10:00:00.000Z" },
        { address: GUARD, label: "Main guard", addedAt: "2026-11-19T10:00:00.000Z" },
      ],
      new Date("2026-11-19T10:05:00.000Z"),
    );
    assertNoSecrets("address book", artifact);
    assert.match(artifact, new RegExp(RECIPIENT));
    assert.match(artifact, new RegExp(GUARD));
  });

  test("the scanner itself catches each seeded value", () => {
    // Guard against a scanner that silently matches nothing.
    for (const value of [SECRET_SEED, URL_WITH_CREDENTIAL, BEARER]) {
      assert.throws(() => assertNoSecrets("probe", `prefix ${value} suffix`));
    }
    // ...and against one that flags public identifiers.
    assertNoSecrets("public", `${GUARD} ${RECIPIENT} ${TX_HASH}`);
  });
});
