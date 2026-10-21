/**
 * The error runbook cannot be allowed to drift from the console's own labels.
 *
 * `docs/runbooks/errors.md` is the operator-facing mapping from a dashboard
 * failure to a safe next step. Its promise — "every label below is one the
 * console actually produces" — is exactly the kind of promise that fails quietly
 * when a component's wording changes. These tests hold the document to it, and
 * to the two rules the issue was written against: never advise blind retries
 * for writes, and never treat a failed read as data about the chain.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { retryAfterHint } from "../../lib/rpc/backoff.ts";

const DOC_PATH = "docs/runbooks/errors.md";
const doc = readFileSync(DOC_PATH, "utf8");

function assertMentions(label: string, because: string): void {
  assert.ok(doc.includes(label), `${DOC_PATH} must mention ${JSON.stringify(label)}: ${because}`);
}

test("the runbook names every retryable signal the read path actually produces", () => {
  // These are the exact strings `withBackoff` treats as retryable, so an
  // operator told to match on them must find them spelled the same way.
  assertMentions("TIMEOUT", "lib/guard/retry.ts classifies timeouts as retryable");
  assertMentions("429", "lib/guard/retry.ts classifies rate limits as retryable");
  assertMentions("NOT_FOUND", "lib/guard/retry.ts classifies not-found as retryable");
  assertMentions("TRY_AGAIN_LATER", "lib/guard/submit.ts raises it while awaiting inclusion");
  assertMentions(
    `Read timed out after`,
    "DashboardReadError's user-facing prefix in lib/guard/timeout.ts",
  );
});

test("the runbook names the console's post-write and read-failure verdicts", () => {
  assertMentions("NOT confirmed", "PanicPanel's post-freeze verification verdict");
  assertMentions("the guard's state could not be read", "StatusPanel's snapshot-failure copy");
  assertMentions("Wallet connection", "WalletBar's connect-failure panel");
  assertMentions("UNRECOGNIZED BYTECODE", "wasmInspector's unreadable-artifact verdict");
  assertMentions("No policy installed", "the default-deny wording the console and SDK share");
});

test("the runbook never advises a write retry without a ledger check first", () => {
  // The dangerous failure mode: a "NOT confirmed" badge inviting a re-broadcast
  // of a write that may have landed. The doc must forbid it explicitly.
  assert.match(
    doc,
    /Never\*\*[^]*?re-broadcast/i,
    "the doc must forbid re-broadcasting on 'NOT confirmed'",
  );
  assert.match(
    doc,
    /do \*\*not\*\* retry the same transaction blind/i,
    "simulation refusals must not be met with blind retries",
  );
});

test("the runbook refuses to read a failed read as chain state", () => {
  // A failed policy() read must not be described as "no policy" anywhere in the
  // doc: absence of data is not default-deny.
  assert.match(
    doc,
    /a failed\s+read is an\s+absence of data, not a state/i,
    "the governing rule must be stated",
  );
  assert.match(
    doc,
    /never as "No policy installed"/i,
    "failed policy reads must not be equated with no policy",
  );
});

test("every section gives an uncertain part and a read-only next step", () => {
  const sections = doc
    .split(/\n(?=## \d)/)
    .filter((section) => /^\d+\./.test(section.replace(/^#*\s*/, "")));
  assert.ok(sections.length >= 7, "each documented failure has its own section");
  for (const section of sections) {
    assert.match(section, /What stays uncertain/i, "each section states the uncertainty");
    assert.match(section, /Safe next step/i, "each section names the safe next step");
  }
});

test("the retry guidance matches what withBackoff and the hint clamp actually do", () => {
  // The doc claims reads honour a capped provider hint; keep that honest against
  // the real helper, so a reader cannot be told a promise the code never made.
  const hint = retryAfterHint("120", { maxDelayMs: 1000 });
  assert.equal(hint?.requestedMs, 120_000, "the provider's raw hint is kept for the display");
  assert.equal(hint?.clamped, true, "the hint is capped by the client before it is used");
  assert.match(
    doc,
    /Retry-After/i,
    "the doc should explain the provider-hint behaviour the retry code implements",
  );
});
