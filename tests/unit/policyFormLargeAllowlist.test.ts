/**
 * Policy editor with large allowlists (issue #548).
 *
 * Operators import recipient and protocol lists from spreadsheets; the editor
 * re-validates the whole draft on every keystroke, so validation latency at
 * realistic list sizes is what decides whether typing stays responsive.
 *
 * This benchmark builds synthetic drafts (deterministic, checksummed `G…`
 * recipients and `C…` protocol contracts with per-function lists) at the sizes
 * documented in `docs/guides/large-allowlists.md`, and measures the two
 * functions the form runs on each edit: `validatePolicyDraftFields` (the
 * inline field errors) and `buildPolicyConfig` (the submit-ready config).
 * Each size is timed as the median of several runs to damp runner noise, and
 * asserted against a budget sized for a shared CI runner: an order of
 * magnitude above what a developer machine measures, so a failure means a
 * real regression (an accidentally quadratic check), not a busy runner.
 *
 * It also checks the results are right at scale — every entry kept, one bad
 * line among thousands still reported — so a "fast" result cannot come from
 * skipping work.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StrKey } from "@stellar/stellar-sdk";
import {
  EMPTY_DRAFT,
  buildPolicyConfig,
  validatePolicyDraftFields,
  type PolicyDraft,
} from "../../lib/guard/policyForm.ts";

/** Documented sizes and their median-latency budgets, in milliseconds. */
export const ALLOWLIST_BENCHMARK: ReadonlyArray<{ entries: number; budgetMs: number }> = [
  { entries: 100, budgetMs: 100 },
  { entries: 1_000, budgetMs: 250 },
  { entries: 5_000, budgetMs: 1_000 },
];

const RUNS = 5;

function keyBytes(i: number, salt: number): Uint8Array {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, i);
  bytes[31] = salt;
  return bytes;
}

function recipients(n: number): string[] {
  return Array.from({ length: n }, (_, i) => StrKey.encodeEd25519PublicKey(keyBytes(i, 1)));
}

function protocols(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const contract = StrKey.encodeContract(keyBytes(i, 2));
    return i % 3 === 0 ? `${contract}:swap,deposit` : contract;
  });
}

function draftOf(n: number): PolicyDraft {
  return {
    ...EMPTY_DRAFT,
    perTxCap: "1000",
    windowCap: "5000",
    windowSecs: "86400",
    assets: StrKey.encodeContract(keyBytes(0, 3)),
    recipients: recipients(n).join("\n"),
    protocols: protocols(Math.max(1, Math.floor(n / 10))).join("\n"),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(fn: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    fn();
    times.push(performance.now() - started);
  }
  return median(times);
}

describe("policy form validation with large allowlists", () => {
  const report: Array<{ entries: number; fieldsMs: number; buildMs: number; budgetMs: number }> =
    [];

  for (const { entries, budgetMs } of ALLOWLIST_BENCHMARK) {
    test(`${entries} recipients validate within ${budgetMs}ms`, () => {
      const draft = draftOf(entries);
      // Warm the JIT so the first size is not charged for compilation.
      validatePolicyDraftFields(draft);

      const fieldsMs = time(() => validatePolicyDraftFields(draft));
      const buildMs = time(() => buildPolicyConfig(draft));
      report.push({ entries, fieldsMs, buildMs, budgetMs });

      assert.ok(
        fieldsMs < budgetMs,
        `field validation of ${entries} took ${fieldsMs.toFixed(1)}ms`,
      );
      assert.ok(
        buildMs < budgetMs,
        `building the config for ${entries} took ${buildMs.toFixed(1)}ms`,
      );

      const result = buildPolicyConfig(draft);
      assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues.slice(0, 3)));
      assert.equal(result.config.recipients.length, entries, "every recipient is kept");
    });
  }

  test("one malformed line among 5,000 is still reported", () => {
    const lines = recipients(5_000);
    lines[2_500] = "GNOTANADDRESS";
    const draft = { ...draftOf(0), recipients: lines.join("\n") };
    const started = performance.now();
    const errors = validatePolicyDraftFields(draft);
    const ms = performance.now() - started;
    assert.ok(errors.recipients, "the bad recipient is flagged");
    assert.ok(ms < 1_000, `validating took ${ms.toFixed(1)}ms`);
  });

  test("report", () => {
    console.log(`policy allowlist benchmark: ${JSON.stringify(report)}`);
    assert.equal(report.length, ALLOWLIST_BENCHMARK.length);
  });
});
