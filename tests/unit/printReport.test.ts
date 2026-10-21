import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  compileDeploymentReceipt,
  compilePrintReport,
  deploymentReceiptFilename,
  formatDeploymentReceipt,
  PRINT_UNAVAILABLE_PREFIX,
  DEPLOYMENT_RECEIPT_DISCLAIMER,
  DEPLOYMENT_RECEIPT_SCHEMA_VERSION,
  type DeploymentReceiptInput,
} from "../../lib/guard/printReport.ts";
import { describePolicy } from "stellar-agent-guard-sdk";
import type { InvokeResult } from "../../lib/guard/submit.ts";
import type { WasmIdentity } from "../../lib/guard/chain.ts";
import type { GuardSnapshot } from "../../lib/guard/guardOps.ts";

test("compilePrintReport extracts correct fields from snapshot", () => {
  const mockSnapshot = {
    guard: "CABC123...",
    fetchedAt: "2026-09-25",
    status: {
      ok: true,
      value: {
        heartbeat_expired: false,
        admin_frozen: false,
        has_policy: true,
        last_heartbeat: 0n,
      },
    },
    policy: {
      ok: true,
      value: {
        per_tx_cap: 100n,
        window_cap: 1000n,
        window_secs: 60n,
        assets: ["A1"],
        recipients: ["R1"],
        protocols: [],
        paused: false,
        active_from: 0n,
        active_until: 0n,
        allow_any_recipient: false,
      },
    },
    window: { ok: true, value: null },
    identity: {
      ok: true,
      value: { reportedWasmHash: "hash123", fetchedSha256: "hash123", bytes: 1000 },
    },
  } as any;

  const report = compilePrintReport(mockSnapshot, "Testnet", "GADMIN...");

  assert.equal(report.contractId, "CABC123...");
  assert.equal(report.bytecodeHash, "hash123");
  assert.equal(report.adminKey, "GADMIN...");
  assert.equal(report.network, "Testnet");
  assert.equal(report.dmsStatus, "OK");
  assert.equal(report.allowlists.assets[0], "A1");
});

// ── Deployment verification receipt (#396, #397) ───────────────────────────

/** A syntactically valid contract address, for the prediction check. */
const PREDICTED = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const PINNED_HASH = "f47919f92e78fdd034836aa61955fc338dd56a218c448c37df1867a8c3da0f63";
const PINNED_BYTES = 39673;
const CAPTURED_AT = "2026-10-20T10:11:12.000Z";

function submitted(hash: string, ledger: number | null): InvokeResult {
  return { kind: "submitted", hash, status: "SUCCESS", ledger, events: [] };
}

function matchingIdentity(overrides: Partial<WasmIdentity> = {}): WasmIdentity {
  return {
    reportedWasmHash: PINNED_HASH,
    fetchedSha256: PINNED_HASH,
    bytes: PINNED_BYTES,
    match: true,
    ...overrides,
  };
}

function baseInput(overrides: Partial<DeploymentReceiptInput> = {}): DeploymentReceiptInput {
  return {
    network: { name: "testnet", passphrase: "Test SDF Network ; September 2015" },
    predictedAddress: PREDICTED,
    deployedAddress: PREDICTED,
    pinned: { hash: PINNED_HASH, bytes: PINNED_BYTES },
    read: { ok: true, value: matchingIdentity() },
    steps: [
      { label: "upload_contract_wasm (39673 bytes)", result: submitted("aa11", 100) },
      {
        label: `create_custom_contract (wasm ${PINNED_HASH.slice(0, 12)}…) → ${PREDICTED}`,
        result: submitted("bb22", 101),
      },
    ],
    capturedAt: CAPTURED_AT,
    ...overrides,
  };
}

describe("deployment verification receipt", () => {
  test("a successful deploy is verified only from the live read, and carries the inputs", () => {
    const receipt = compileDeploymentReceipt(baseInput());

    assert.equal(receipt.kind, "stellar-agent-guard.deployment-receipt");
    assert.equal(receipt.schemaVersion, DEPLOYMENT_RECEIPT_SCHEMA_VERSION);
    assert.equal(receipt.generator.provenance, "client-generated");
    assert.equal(receipt.disclaimer, DEPLOYMENT_RECEIPT_DISCLAIMER);
    assert.equal(receipt.capturedAt, CAPTURED_AT);
    assert.equal(receipt.network.name, "testnet");
    assert.equal(receipt.network.passphrase, "Test SDF Network ; September 2015");
    assert.equal(receipt.addresses.predicted, PREDICTED);
    assert.equal(receipt.addresses.deployed, PREDICTED);

    assert.equal(receipt.artifact.pinnedHash, PINNED_HASH);
    assert.equal(receipt.artifact.pinnedBytes, PINNED_BYTES);
    assert.equal(receipt.artifact.observedSha256, PINNED_HASH);
    assert.equal(receipt.artifact.observedBytes, PINNED_BYTES);
    assert.equal(receipt.artifact.reportedWasmHash, PINNED_HASH);

    assert.equal(receipt.verification.status, "verified");
    assert.equal(receipt.verification.verified, true);
    assert.deepEqual(
      receipt.verification.checks.map((entry) => entry.status),
      ["verified", "verified", "verified", "verified", "verified", "verified"],
    );

    // Every transaction reference is the deploy's own, in order.
    assert.deepEqual(
      receipt.transactions.map((entry) => [
        entry.operation.split(" ")[0],
        entry.hash,
        entry.ledger,
      ]),
      [
        ["upload_contract_wasm", "aa11", 100],
        ["create_custom_contract", "bb22", 101],
      ],
    );
  });

  test("a read that returns the wrong bytecode is a failure, never a success claim", () => {
    const receipt = compileDeploymentReceipt(
      baseInput({
        read: {
          ok: true,
          value: matchingIdentity({
            fetchedSha256: "deadbeef",
            bytes: 12,
            reportedWasmHash: "deadbeef",
            match: false,
          }),
        },
      }),
    );

    assert.equal(receipt.verification.status, "failed");
    assert.equal(receipt.verification.verified, false);
    assert.match(receipt.verification.summary, /does not match the pinned artifact/);

    const byId = new Map(receipt.verification.checks.map((entry) => [entry.id, entry]));
    assert.equal(byId.get("live-read")?.status, "verified");
    assert.equal(byId.get("artifact-hash")?.status, "failed");
    assert.equal(byId.get("artifact-length")?.status, "failed");
    assert.equal(byId.get("ledger-hash")?.status, "failed");
    assert.match(byId.get("artifact-hash")?.detail ?? "", /deadbeef/);
  });

  test("a failed post-deploy read is recorded explicitly and marks the receipt unavailable", () => {
    const receipt = compileDeploymentReceipt(
      baseInput({ read: { ok: false, error: "RPC timed out" } }),
    );

    assert.equal(receipt.verification.status, "unavailable");
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.artifact.observedSha256, null);
    assert.equal(receipt.artifact.observedBytes, null);
    assert.equal(receipt.artifact.reportedWasmHash, null);

    const byId = new Map(receipt.verification.checks.map((entry) => [entry.id, entry]));
    assert.equal(byId.get("live-read")?.status, "failed");
    assert.match(byId.get("live-read")?.detail ?? "", /RPC timed out/);
    assert.equal(byId.get("artifact-hash")?.status, "unavailable");
    assert.equal(byId.get("artifact-length")?.status, "unavailable");
    assert.equal(byId.get("ledger-hash")?.status, "unavailable");
  });

  test("an instance that reports no ledger hash does not manufacture one", () => {
    const receipt = compileDeploymentReceipt(
      baseInput({ read: { ok: true, value: matchingIdentity({ reportedWasmHash: null }) } }),
    );

    const ledgerHash = receipt.verification.checks.find((entry) => entry.id === "ledger-hash");
    assert.equal(ledgerHash?.status, "unavailable");
    assert.equal(receipt.artifact.reportedWasmHash, null);
    // Hash and length still matched the pin, so the read remains the evidence.
    assert.equal(receipt.verification.status, "verified");
  });

  test("a refused create never reads as verified, even though an address was predicted", () => {
    const receipt = compileDeploymentReceipt(
      baseInput({
        read: null,
        deployedAddress: null,
        steps: [
          {
            label: `create_custom_contract (wasm ${PINNED_HASH.slice(0, 12)}…) → ${PREDICTED}`,
            result: {
              kind: "refused",
              stage: "enforcement",
              detail: "host error: auth invalid",
              diagnosticEvents: [],
            },
          },
        ],
      }),
    );

    assert.equal(receipt.verification.status, "failed");
    assert.equal(receipt.verification.verified, false);
    assert.equal(receipt.transactions.length, 1);
    assert.equal(receipt.transactions[0]?.outcome, "refused");
    assert.equal(receipt.transactions[0]?.hash, null);
    assert.match(receipt.transactions[0]?.detail ?? "", /enforcement/);

    const byId = new Map(receipt.verification.checks.map((entry) => [entry.id, entry]));
    assert.equal(byId.get("contract-created")?.status, "failed");
    assert.equal(byId.get("live-read")?.status, "unavailable");
    assert.equal(byId.get("artifact-hash")?.status, "unavailable");
  });

  test("a deploy that stops before the read is unavailable, not verified", () => {
    const receipt = compileDeploymentReceipt(
      baseInput({
        read: null,
        steps: [{ label: "upload_contract_wasm (39673 bytes)", result: submitted("aa11", 100) }],
      }),
    );

    assert.equal(receipt.verification.status, "unavailable");
    assert.equal(receipt.verification.verified, false);
    assert.match(receipt.verification.summary, /no verification is claimed/);
  });

  test("redacts secret-like sentinels and never serialises signed XDR", () => {
    const SECRET_SEED = "SDBQH7YJ7J4WQ7YJ7J4WQ7YJ7J4WQ7YJ7J4WQ7YJ7J4WQ7YJ7J4WQ";
    const SIGNED_XDR = "AAAAAgAAAABzaWduZWQtZW52ZWxvcGUtc2VudGluZWw=";
    const SESSION_TOKEN = "freighter-session-token-sentinel";

    const input = {
      ...baseInput({
        steps: [
          { label: "upload_contract_wasm (39673 bytes)", result: submitted("aa11", 100) },
          {
            label: `create_custom_contract (wasm ${PINNED_HASH.slice(0, 12)}…) → ${PREDICTED}`,
            result: {
              kind: "exported",
              xdr: SIGNED_XDR,
              detail: "unsigned envelope exported for an external signer",
            },
          },
        ],
      }),
      // The receipt type has no field for any of these. They are attached here
      // the way a careless caller might attach their whole session, to prove the
      // compiler's whitelist is not bypassed by a spread.
      secretKey: SECRET_SEED,
      signedXdr: SIGNED_XDR,
      wallet: { provider: "freighter", address: PREDICTED, sessionToken: SESSION_TOKEN },
    } as unknown as DeploymentReceiptInput;

    const receipt = compileDeploymentReceipt(input);
    const serialised = formatDeploymentReceipt(receipt);

    assert.ok(!serialised.includes(SECRET_SEED), "a secret seed must never be serialised");
    assert.ok(
      !serialised.includes(SIGNED_XDR),
      "signed or unsigned envelope XDR must not be included",
    );
    assert.ok(!serialised.includes(SESSION_TOKEN), "wallet session details must not be included");
    assert.ok(
      !serialised.toLowerCase().includes("freighter"),
      "the wallet provider is not part of the record",
    );
    assert.ok(!("secretKey" in receipt));
    assert.ok(!("signedXdr" in receipt));
    assert.ok(!("wallet" in receipt));

    // The exported step is kept as an explicit "nothing was broadcast" fact.
    const exported = receipt.transactions.at(-1);
    assert.equal(exported?.outcome, "exported");
    assert.equal(exported?.hash, null);
    assert.match(exported?.detail ?? "", /exported/);
  });

  test("redacts secrets and credentials from error diagnostics and failure details", () => {
    const SECRET_KEY = "SCRUPLHP7D3DLRMTWVZUIVPHFQGSX45IXGG62LDNY2RJ4M24D4CRBYDV";
    const API_URL = "https://soroban-rpc.testnet.stellar.org?apiKey=supersecretkey123";

    const input = baseInput({
      steps: [
        {
          label: "create_custom_contract",
          result: {
            kind: "failed",
            hash: "abcd",
            detail: `Failed connecting to ${API_URL} using key ${SECRET_KEY}`,
            diagnosticEvents: [],
          },
        },
      ],
      read: {
        ok: false,
        error: `Authentication failed at https://user:secretpass@stellar.org for ${SECRET_KEY}`,
      },
    });

    const receipt = compileDeploymentReceipt(input);
    const serialised = formatDeploymentReceipt(receipt);

    assert.ok(!serialised.includes(SECRET_KEY), "secret key must not appear in receipt");
    assert.ok(
      !serialised.includes("supersecretkey123"),
      "api key query must not appear in receipt",
    );
    assert.ok(!serialised.includes("secretpass"), "url password must not appear in receipt");
    assert.ok(serialised.includes("[REDACTED]"), "redacted placeholders must be present");
  });

  test("the serialised document is stable, labelled and parseable", () => {
    const receipt = compileDeploymentReceipt(baseInput());
    const serialised = formatDeploymentReceipt(receipt);

    assert.ok(serialised.endsWith("\n"));
    const parsed = JSON.parse(serialised) as Record<string, unknown>;
    assert.equal(parsed.kind, "stellar-agent-guard.deployment-receipt");
    assert.equal(parsed.schemaVersion, DEPLOYMENT_RECEIPT_SCHEMA_VERSION);
    assert.deepEqual(parsed.generator, {
      name: "stellar-agent-guard-dashboard",
      provenance: "client-generated",
    });
    assert.match(String(parsed.disclaimer), /not a signed credential/);
    assert.match(String(parsed.disclaimer), /client-generated/i);
  });

  test("the filename identifies the network, address and capture day", () => {
    const receipt = compileDeploymentReceipt(baseInput());
    assert.equal(
      deploymentReceiptFilename(receipt),
      `deployment-receipt-testnet-${PREDICTED.slice(0, 12)}-2026-10-20.json`,
    );

    const unreached = compileDeploymentReceipt(baseInput({ read: null, deployedAddress: null }));
    assert.match(
      deploymentReceiptFilename(unreached),
      /deployment-receipt-testnet-CAYJZT4XH5SW-2026-10-20\.json/,
    );
  });
});

// ── Print output ↔ one explicit read snapshot (#369) ──────────────────────

/**
 * The printable report is shared as evidence, so it must prove which read it
 * came from and label every field that failed. These tests drive two full
 * snapshots through `compilePrintReport` the way the panel does — guard switch,
 * refreshes racing, some reads failing — and assert nothing ever prints as a
 * settled value that no successful read established.
 */

describe("print report binding (#369)", () => {
  const NOW = "2026-10-20T16:45:00.000Z";
  const T1 = "2026-10-20T16:40:00.000Z"; // older snapshot
  const T2 = "2026-10-20T16:42:00.000Z"; // newer snapshot
  const GUARD_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const GUARD_B = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
  const HASH_A = "hashAAA";

  function okRead(value: unknown) {
    return { ok: true as const, value };
  }
  function failedRead(error: string) {
    return { ok: false as const, error, diagnostic: `diagnostic for ${error}` };
  }

  function policyOf(assets: string[]) {
    return {
      per_tx_cap: 100n,
      window_cap: 1000n,
      window_secs: 60n,
      assets,
      recipients: ["R1"],
      protocols: [],
      paused: false,
      active_from: 0n,
      active_until: 0n,
      allow_any_recipient: false,
    };
  }

  function snapshot(
    guard: string,
    fetchedAt: string,
    fields: {
      status?: unknown;
      policy?: unknown;
      window?: unknown;
      identity?: unknown;
    } = {},
  ): GuardSnapshot {
    const base = {
      guard,
      fetchedAt,
      status: fields.status ?? okRead({
        heartbeat_expired: false,
        admin_frozen: false,
        has_policy: true,
        last_heartbeat: 0n,
        now: 1_700_000_060n,
      }),
      policy: fields.policy ?? okRead(policyOf(["A1"])),
      window: fields.window ?? okRead(null),
      identity:
        fields.identity ??
        okRead({ reportedWasmHash: HASH_A, fetchedSha256: HASH_A, bytes: 39673, match: true }),
    };
    return base as unknown as GuardSnapshot;
  }

  test("each report is bound to one network and guard read, never a blend of two", () => {
    // Two compiles the panel could make back-to-back: a snapshot of guard A,
    // then, after a switch, one of guard B whose reads landed out of order
    // (policy and identity still failing from the earlier refresh).
    const reportA = compilePrintReport(snapshot(GUARD_A, T1), "Testnet", "GADMIN...", NOW);
    const reportB = compilePrintReport(
      snapshot(GUARD_B, T2, {
        policy: failedRead("RPC rate limited"),
        identity: failedRead("RPC timed out"),
      }),
      "Testnet",
      "GADMIN...",
      NOW,
    );

    // Every report names its own guard, network and read time.
    assert.equal(reportA.contractId, GUARD_A);
    assert.equal(reportA.network, "Testnet");
    assert.equal(reportA.readAt, T1);
    assert.equal(reportB.contractId, GUARD_B);
    assert.equal(reportB.readAt, T2);

    // No value from A leaks into B's record, and nothing in A is A's.
    const serialA = JSON.stringify(reportA);
    const serialB = JSON.stringify(reportB);
    assert.ok(serialA.includes(HASH_A), "A's own identity hash is reported");
    assert.ok(serialB.includes(GUARD_B) && !serialB.includes(HASH_A));
    assert.ok(serialB.includes(GUARD_A) === false, "a guard switch must reset the contract id");

    // The read time is the snapshot's own, not the compile moment.
    assert.notEqual(reportA.readAt, reportA.timestamp);
    assert.equal(reportA.timestamp, NOW);
  });

  test("reads completing out of order keep their outcomes on a per-field basis", () => {
    // status() from an early read, policy() and window() failed, identity() succeeded
    // later — one snapshot carrying all four individual outcomes.
    const mixed = snapshot(GUARD_A, T1, {
      policy: failedRead("connection reset"),
      window: failedRead("NOT_FOUND"),
    });
    const report = compilePrintReport(mixed, "Testnet", "GADMIN...", NOW);

    const byField = new Map(report.reads.map((entry) => [entry.field, entry]));
    assert.equal(byField.get("status")?.outcome, "read");
    assert.equal(byField.get("policy")?.outcome, "unavailable");
    assert.equal(byField.get("window")?.outcome, "unavailable");
    assert.equal(byField.get("wasm identity")?.outcome, "read");
    // A failing field never downgrades its neighbours: identity still read.
    assert.match(byField.get("policy")?.detail ?? "", /connection reset/);
  });

  test("a failed policy read is labelled, never a no-policy state or a zero", () => {
    const report = compilePrintReport(
      snapshot(GUARD_B, T2, { policy: failedRead("RPC rate limited") }),
      "Testnet",
      "GADMIN...",
      NOW,
    );

    assert.match(report.policyRules, new RegExp(PRINT_UNAVAILABLE_PREFIX));
    assert.ok(
      !report.policyRules.includes("No policy installed"),
      "default-deny is a state only a successful read can establish",
    );
    // Empty arrays would print as "None" — the reassuring default the failed
    // read never earned. The unavailable marker travels into the list itself.
    assert.deepEqual(report.allowlists.assets, [
      `${PRINT_UNAVAILABLE_PREFIX} — the policy read failed`,
    ]);
    assert.ok(report.reads.find((entry) => entry.field === "policy")?.outcome === "unavailable");
  });

  test("failed status and identity reads never render as OK, zero or a placeholder", () => {
    const report = compilePrintReport(
      snapshot(GUARD_B, T2, { status: failedRead("RPC timed out"), identity: failedRead("NO CODE") }),
      "Testnet",
      "GADMIN...",
      NOW,
    );

    assert.match(report.dmsStatus, new RegExp(PRINT_UNAVAILABLE_PREFIX));
    assert.ok(!report.dmsStatus.startsWith("OK"), "a failed status() is not OK");
    assert.notEqual(report.dmsStatus, "UNKNOWN", "the old bare placeholder is gone too");
    assert.match(report.bytecodeHash, new RegExp(PRINT_UNAVAILABLE_PREFIX));
    assert.notEqual(report.bytecodeHash, "-", "a dash is not a hash failure's value");
    assert.ok(!/[0-9a-f]{16}/i.test(report.bytecodeHash), "no hash-like value is invented");
  });

  test("a successful policy-less read prints the one no-policy wording it earned", () => {
    const report = compilePrintReport(
      snapshot(GUARD_A, T1, { policy: okRead(null) }),
      "Testnet",
      "GADMIN...",
      NOW,
    );

    assert.equal(report.policyRules, "No policy installed");
    assert.deepEqual(report.allowlists.assets, []); // genuinely nothing: the read earned it
    assert.deepEqual(report.allowlists.recipients, []);
    assert.ok(report.reads.every((entry) => entry.outcome === "read"));
  });

  test("a fully successful report still carries its snapshot binding", () => {
    const policy = policyOf(["A1"]);
    const report = compilePrintReport(snapshot(GUARD_A, T1), "Testnet", "GADMIN...", NOW);

    assert.equal(report.policyRules, describePolicy(policy as never));
    assert.equal(report.dmsStatus, "OK");
    assert.equal(report.readAt, T1);
    assert.ok(report.reads.every((entry) => entry.outcome === "read"));
  });
});
