import type { GuardSnapshot } from "./guardOps.ts";
import { describePolicy, isDeadManFrozen } from "stellar-agent-guard-sdk";
import type { ReadResult, WasmIdentity } from "./chain.ts";
import type { InvokeResult } from "./submit.ts";
import { looksLikeContractAddress } from "./instance.ts";
import { redactDiagnostics } from "./inputSanitizer.ts";

export interface AuditReport {
  contractId: string;
  bytecodeHash: string;
  policyRules: string;
  allowlists: {
    assets: string[];
    recipients: string[];
    protocols: string[];
  };
  adminKey: string;
  dmsStatus: string;
  network: string;
  /**
   * The compiled report's own generation time, distinct from the read below.
   * Every *value* in this report comes from the read stamped in `readAt`.
   */
  timestamp: string;
  /**
   * The snapshot's own fetch time (#369). Together with `contractId` and
   * `network` this binds each value to exactly one live read of one guard on
   * one network — a report can never blend two guards or two reads.
   */
  readAt: string;
  /** Per-field read outcome, so a failed read is named, never defaulted. */
  reads: PrintFieldReport[];
}

/** A single read in the snapshot: did it succeed, and what happened. */
export interface PrintFieldReport {
  field: string;
  outcome: "read" | "unavailable";
  detail: string;
}

/** The wording a failed field read must keep — never a settled-looking value. */
export const PRINT_UNAVAILABLE_PREFIX = "UNAVAILABLE";

/**
 * Build a per-field read report from the snapshot's own `ReadResult`s.
 *
 * The labels match the UI (`ReadWithRetry` renders the same distinction per
 * field), and the details carry the read's own error text — redacted upstream.
 * A successful read of a null policy is a *state* the read established
 * (default-deny); a failed read is declared `unavailable` because it
 * established nothing.
 */
function reportFieldReads(snapshot: GuardSnapshot): PrintFieldReport[] {
  const entry = (field: string, result: { ok: boolean; error?: string }): PrintFieldReport =>
    result.ok
      ? { field, outcome: "read", detail: "read live from the chain for this report" }
      : {
          field,
          outcome: "unavailable",
          detail: `${PRINT_UNAVAILABLE_PREFIX} — the read failed: ${result.error ?? "unknown error"}`,
        };
  return [
    entry("status", snapshot.status),
    entry("policy", snapshot.policy),
    entry("window", snapshot.window),
    entry("wasm identity", snapshot.identity),
  ];
}

/**
 * Compile the printable compliance report from exactly one guard snapshot.
 *
 * Deliberately no field of this report is invented:
 *   - every value comes from the one snapshot passed in — the report's
 *     `readAt`/`contractId`/`network` name the read they came from, so two
 *     reports of two guards (or a refresh between reads) can never blend;
 *   - a field whose read failed is labelled `UNAVAILABLE (...)` and contributes
 *     no value at all: no "No policy installed", no zero, no "-" dressed up as
 *     a state. Whether the account is unprotected is a *chain* fact only a
 *     successful read can establish.
 */
export function compilePrintReport(
  snapshot: GuardSnapshot,
  networkName: string,
  adminKey: string,
  /** Injected clock for deterministic tests; defaults to now. */
  generatedAt: string = new Date().toISOString(),
): AuditReport {
  const policy = snapshot.policy.ok ? snapshot.policy.value : null;
  const status = snapshot.status.ok ? snapshot.status.value : null;
  const policyReadFailed = !snapshot.policy.ok;
  const unavailableLists = (): AuditReport["allowlists"] => {
    const missing = `${PRINT_UNAVAILABLE_PREFIX} — the policy read failed`;
    return {
      assets: [missing],
      recipients: [missing],
      protocols: [missing],
    };
  };

  return {
    contractId: snapshot.guard,
    bytecodeHash: snapshot.identity.ok
      ? (snapshot.identity.value.reportedWasmHash ?? "none reported by the ledger")
      : `${PRINT_UNAVAILABLE_PREFIX} — the wasm identity read failed`,
    policyRules: policy
      ? describePolicy(policy)
      : policyReadFailed
        ? `${PRINT_UNAVAILABLE_PREFIX} — the policy read failed`
        : // A successful read that found none installed: the one "no policy"
          // wording a report is allowed to use, because the read established it.
          "No policy installed",
    allowlists: policy
      ? {
          assets: policy.assets,
          recipients: policy.allow_any_recipient ? ["* (Any)"] : policy.recipients,
          protocols: policy.protocols.map(
            (p) => `${p.contract} ${p.fns ? `(${p.fns.join(", ")})` : "(Any)"}`,
          ),
        }
      : policyReadFailed
        ? // Not []: an empty list would print as "None" — a reassuring default
          // the failed read never established.
          unavailableLists()
        : { assets: [], recipients: [], protocols: [] },
    adminKey,
    dmsStatus: status
      ? isDeadManFrozen(status)
        ? "FIRED"
        : status.heartbeat_expired
          ? "EXPIRED"
          : "OK"
      : `${PRINT_UNAVAILABLE_PREFIX} — the status read failed`,
    network: networkName,
    timestamp: generatedAt,
    readAt: snapshot.fetchedAt,
    reads: reportFieldReads(snapshot),
  };
}

// ── Deployment verification receipt (#396, #397) ───────────────────────────

/**
 * A handoff record for one browser deploy.
 *
 * This is deliberately *not* a signed credential and *not* a proof of chain
 * state. It is the console's own account of what it asked the chain to do and
 * what it then read back, generated in the browser that did the signing. Two
 * rules make it safe to paste into a support channel:
 *
 *   1. It is built from an explicit whitelist of fields. Secret keys, signed
 *      envelopes, wallet providers and every other session detail have no field
 *      to travel in, so they cannot leak by accident. Each transaction is
 *      re-shaped from `InvokeResult` rather than spread, because an exported
 *      envelope carries its XDR.
 *   2. `verified` is true only when the post-deploy read actually succeeded and
 *      its bytes matched the pin. A refused deploy, a failed read, or a read
 *      that never happened yields `failed`/`unavailable`, never a success claim.
 */

/** The receipt format's own version, so a shared file can be read later. */
export const DEPLOYMENT_RECEIPT_SCHEMA_VERSION = 1;

/** The line every shared receipt carries, in the record itself. */
export const DEPLOYMENT_RECEIPT_DISCLAIMER =
  "Client-generated record from the Stellar Agent Guard dashboard. It is not a signed credential, not a substitute for chain data, and proves nothing on its own: re-read the contract from the network before relying on it.";

/** Where a verification check landed. `unavailable` never means "fine". */
export type ReceiptCheckStatus = "verified" | "failed" | "unavailable";

export type ReceiptCheckId =
  | "predicted-address"
  | "contract-created"
  | "live-read"
  | "artifact-hash"
  | "artifact-length"
  | "ledger-hash";

export interface DeploymentReceiptCheck {
  id: ReceiptCheckId;
  label: string;
  status: ReceiptCheckStatus;
  /** A sentence an operator can read without the console in front of them. */
  detail: string;
}

export type ReceiptTransactionOutcome = InvokeResult["kind"];

export interface DeploymentReceiptTransaction {
  /** The operation's label as the deploy flow wrote it. */
  operation: string;
  outcome: ReceiptTransactionOutcome;
  /** The hash the network accepted, or null when nothing was broadcast. */
  hash: string | null;
  ledger: number | null;
  /** Why it did not land, or the exported-envelope note. Never an envelope. */
  detail: string | null;
}

export interface DeploymentReceiptInput {
  network: { name: string; passphrase: string };
  /** The address computed locally before the wallet was asked to sign. */
  predictedAddress: string;
  /** The address the deploy targeted; null when nothing was created. */
  deployedAddress: string | null;
  /** The artifact this build is pinned to, in hash and byte length. */
  pinned: { hash: string; bytes: number };
  /**
   * The post-deploy read of the new instance. `null` means the flow never got
   * that far; `{ ok: false }` means it tried and the read failed. Both are
   * recorded explicitly rather than collapsed into the generic failure.
   */
  read: ReadResult<WasmIdentity> | null;
  /** The deploy's recorded steps, in order. Only their summary is kept. */
  steps: ReadonlyArray<{ label: string; result: InvokeResult }>;
  /** Injected clock for deterministic tests; defaults to now. */
  capturedAt?: string;
}

export interface DeploymentReceipt {
  kind: "stellar-agent-guard.deployment-receipt";
  schemaVersion: number;
  generator: { name: "stellar-agent-guard-dashboard"; provenance: "client-generated" };
  disclaimer: string;
  capturedAt: string;
  network: { name: string; passphrase: string };
  addresses: { predicted: string; deployed: string | null };
  artifact: {
    pinnedHash: string;
    pinnedBytes: number;
    observedSha256: string | null;
    observedBytes: number | null;
    reportedWasmHash: string | null;
  };
  verification: {
    status: ReceiptCheckStatus;
    /** True only when the live read succeeded and matched the pin. */
    verified: boolean;
    summary: string;
    checks: DeploymentReceiptCheck[];
  };
  transactions: DeploymentReceiptTransaction[];
}

/** The prefix of the deploy flow's create step, as `deployGuard` labels it. */
const CREATE_STEP_PREFIX = "create_custom_contract";

/**
 * Re-shape one submit result into the receipt's transaction reference.
 *
 * Written as an exhaustive switch over a freshly built object on purpose: an
 * `exported` result carries the unsigned XDR and a `failed` one carries raw
 * diagnostic material, and neither belongs in a record meant for sharing.
 */
function receiptTransaction(label: string, result: InvokeResult): DeploymentReceiptTransaction {
  switch (result.kind) {
    case "submitted":
      return {
        operation: label,
        outcome: "submitted",
        hash: result.hash,
        ledger: result.ledger,
        detail: null,
      };
    case "failed":
      return {
        operation: label,
        outcome: "failed",
        hash: result.hash,
        ledger: null,
        detail: result.detail ? redactDiagnostics(result.detail) : result.detail,
      };
    case "refused":
      return {
        operation: label,
        outcome: "refused",
        hash: null,
        ledger: null,
        detail: redactDiagnostics(`${result.stage}: ${result.detail}`),
      };
    case "exported":
      return {
        operation: label,
        outcome: "exported",
        hash: null,
        ledger: null,
        detail: redactDiagnostics(
          result.detail ?? "an unsigned transaction was exported; nothing was broadcast",
        ),
      };
  }
}

function check(
  id: ReceiptCheckId,
  label: string,
  status: ReceiptCheckStatus,
  detail: string,
): DeploymentReceiptCheck {
  return { id, label, status, detail };
}

function observed(read: ReadResult<WasmIdentity> | null): WasmIdentity | null {
  return read !== null && read.ok ? read.value : null;
}

/**
 * Compile the receipt from the deploy's own facts.
 *
 * The verification checks are independent so a shared record shows *which*
 * fact failed, not just that something did. The overall status is derived from
 * the live read alone: without a successful read, `verified` stays false even
 * when every transaction was submitted.
 */
export function compileDeploymentReceipt(input: DeploymentReceiptInput): DeploymentReceipt {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const identity = observed(input.read);
  const createStep = input.steps.find((step) => step.label.startsWith(CREATE_STEP_PREFIX));

  const checks: DeploymentReceiptCheck[] = [];

  checks.push(
    looksLikeContractAddress(input.predictedAddress)
      ? check(
          "predicted-address",
          "Predicted address",
          "verified",
          `The address was computed from the deployer and salt before signing: ${input.predictedAddress}.`,
        )
      : check(
          "predicted-address",
          "Predicted address",
          "unavailable",
          "No valid contract address was predicted, so the deploy could not have targeted one.",
        ),
  );

  if (!createStep) {
    checks.push(
      check(
        "contract-created",
        "Create transaction",
        "unavailable",
        "No create transaction was recorded; the deploy did not reach the chain.",
      ),
    );
  } else if (createStep.result.kind === "submitted") {
    checks.push(
      check(
        "contract-created",
        "Create transaction",
        "verified",
        `The network accepted the create transaction ${createStep.result.hash}${
          createStep.result.ledger === null ? "" : ` in ledger ${createStep.result.ledger}`
        }.`,
      ),
    );
  } else if (createStep.result.kind === "exported") {
    checks.push(
      check(
        "contract-created",
        "Create transaction",
        "unavailable",
        "The create transaction was exported unsigned; nothing was broadcast.",
      ),
    );
  } else {
    checks.push(
      check(
        "contract-created",
        "Create transaction",
        "failed",
        redactDiagnostics(
          createStep.result.kind === "refused"
            ? `The create transaction was refused before broadcast (${createStep.result.stage}): ${createStep.result.detail}`
            : `The create transaction was broadcast and rejected: ${createStep.result.detail}`,
        ),
      ),
    );
  }

  if (input.read === null) {
    checks.push(
      check(
        "live-read",
        "Post-deploy read",
        "unavailable",
        "The deployed instance was never read back, so nothing about its bytecode is claimed.",
      ),
    );
  } else if (input.read.ok) {
    checks.push(
      check(
        "live-read",
        "Post-deploy read",
        "verified",
        `The instance at ${input.deployedAddress ?? input.predictedAddress} was read live and returned its identity.`,
      ),
    );
  } else {
    checks.push(
      check(
        "live-read",
        "Post-deploy read",
        "failed",
        redactDiagnostics(`Reading the deployed instance failed: ${input.read.error}`),
      ),
    );
  }

  checks.push(
    identity === null
      ? check(
          "artifact-hash",
          "Artifact hash",
          "unavailable",
          "There is no live bytecode hash to compare with the pin.",
        )
      : identity.fetchedSha256 === input.pinned.hash
        ? check(
            "artifact-hash",
            "Artifact hash",
            "verified",
            `The fetched bytecode hashes to the pinned ${input.pinned.hash}.`,
          )
        : check(
            "artifact-hash",
            "Artifact hash",
            "failed",
            `The fetched bytecode hashes to ${identity.fetchedSha256}, not the pinned ${input.pinned.hash}.`,
          ),
  );

  checks.push(
    identity === null
      ? check(
          "artifact-length",
          "Artifact length",
          "unavailable",
          "There is no live byte length to compare with the pin.",
        )
      : identity.bytes === input.pinned.bytes
        ? check(
            "artifact-length",
            "Artifact length",
            "verified",
            `The fetched bytecode is ${identity.bytes} bytes, matching the pin.`,
          )
        : check(
            "artifact-length",
            "Artifact length",
            "failed",
            `The fetched bytecode is ${identity.bytes} bytes, not the pinned ${input.pinned.bytes}.`,
          ),
  );

  checks.push(
    identity === null
      ? check(
          "ledger-hash",
          "Ledger-declared hash",
          "unavailable",
          "The instance's declared WASM hash was not read.",
        )
      : identity.reportedWasmHash === input.pinned.hash
        ? check(
            "ledger-hash",
            "Ledger-declared hash",
            "verified",
            "The ledger declares the same WASM hash this build pins.",
          )
        : identity.reportedWasmHash === null
          ? check(
              "ledger-hash",
              "Ledger-declared hash",
              "unavailable",
              "The instance did not report a WASM hash, so this check could not be made.",
            )
          : check(
              "ledger-hash",
              "Ledger-declared hash",
              "failed",
              `The ledger declares ${identity.reportedWasmHash}, not the pinned ${input.pinned.hash}.`,
            ),
  );

  const hashCheck = checks.find((entry) => entry.id === "artifact-hash");
  const lengthCheck = checks.find((entry) => entry.id === "artifact-length");
  const createCheck = checks.find((entry) => entry.id === "contract-created");

  let status: ReceiptCheckStatus;
  let summary: string;
  if (input.read === null) {
    status = createCheck?.status === "failed" ? "failed" : "unavailable";
    summary =
      status === "failed"
        ? "The deploy did not complete, and the new instance was never read, so no verification is claimed."
        : "The deploy stopped before the post-deploy read, so no verification is claimed.";
  } else if (!input.read.ok) {
    status = "unavailable";
    summary = "The post-deploy read failed, so no verification is claimed.";
  } else if (hashCheck?.status === "verified" && lengthCheck?.status === "verified") {
    status = "verified";
    summary =
      "A live read of the deployed instance matched the pinned artifact by hash and length.";
  } else {
    status = "failed";
    summary = "A contract exists at the target address, but it does not match the pinned artifact.";
  }

  return {
    kind: "stellar-agent-guard.deployment-receipt",
    schemaVersion: DEPLOYMENT_RECEIPT_SCHEMA_VERSION,
    generator: { name: "stellar-agent-guard-dashboard", provenance: "client-generated" },
    disclaimer: DEPLOYMENT_RECEIPT_DISCLAIMER,
    capturedAt,
    network: { name: input.network.name, passphrase: input.network.passphrase },
    addresses: { predicted: input.predictedAddress, deployed: input.deployedAddress },
    artifact: {
      pinnedHash: input.pinned.hash,
      pinnedBytes: input.pinned.bytes,
      observedSha256: identity?.fetchedSha256 ?? null,
      observedBytes: identity?.bytes ?? null,
      reportedWasmHash: identity?.reportedWasmHash ?? null,
    },
    verification: { status, verified: status === "verified", summary, checks },
    transactions: input.steps.map((step) => receiptTransaction(step.label, step.result)),
  };
}

/** The receipt as a shareable, human-diffable JSON document. */
export function formatDeploymentReceipt(receipt: DeploymentReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

/** A filename that identifies the network and address without a path separator. */
export function deploymentReceiptFilename(receipt: DeploymentReceipt): string {
  const address = receipt.addresses.deployed ?? receipt.addresses.predicted;
  const day = receipt.capturedAt.slice(0, 10);
  const safeNetwork = receipt.network.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const safeAddress = address.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "unknown";
  return `deployment-receipt-${safeNetwork}-${safeAddress}-${day}.json`;
}
