/**
 * The read-panel contract (issue #556).
 *
 * `docs/guides/adding-a-read-panel.md` defines what a new dashboard read panel
 * owes the operator: typed outcomes, freshness, cancellation, accessible errors
 * and tests. This suite keeps that page honest in two directions:
 *
 *   1. **The page against the code.** Every obligation section is present, and
 *      every file and exported symbol the page cites as the reference
 *      implementation still exists — so a rename fails here instead of leaving
 *      contributors copying a pattern that is gone.
 *   2. **The behaviour the page promises.** Each obligation is re-asserted
 *      against the shared primitives a new panel is told to reuse (`readPhase`,
 *      `<Read>`, `<ReadWithRetry>`, `valueInScope`, `runScopedWrite`,
 *      `withTimeout`, `readAccountSigners`), including the edge cases the page
 *      calls out: a genuine zero, a stale response, a hung read, partial data.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import type { Horizon } from "@stellar/stellar-sdk";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { Read, ReadWithRetry, RetryableRead } from "../../components/bits.tsx";
import type { ReadResult } from "../../lib/guard/chain.ts";
import { readPhase } from "../../lib/guard/statusReadState.ts";
import {
  bindToScope,
  guardScope,
  runScopedWrite,
  valueInScope,
} from "../../lib/guard/guardScoped.ts";
import { DashboardReadError, withTimeout } from "../../lib/guard/timeout.ts";
import { readAccountSigners } from "../../lib/guard/multisigRead.ts";

installDom();

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GUIDE_PATH = "docs/guides/adding-a-read-panel.md";

function repoFile(path: string): string {
  return readFileSync(`${ROOT}${path}`, "utf8");
}

const guide = repoFile(GUIDE_PATH);

const GUARD_A = "CBLQLJAG72M4XQRJMQHSKYIFVHQD7LNTNOQH2GRMCMBWMSLBSLTGTJC7";
const GUARD_B = "CDCYDGBGS5AZ5BZS6XY2SK2PHJHSOEGTN3N4INCK34KF6GU2BGC7Z6MB";
const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

beforeEach(() => {
  document.body.innerHTML = "";
});

async function render(
  element: ReactElement,
): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(host);
    root.render(element);
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

// ── 1. The page against the code ────────────────────────────────────────────

test("the guide defines all five obligations as sections", () => {
  for (const heading of [
    "## 1. Typed outcomes",
    "## 2. Freshness",
    "## 3. Cancellation and identity",
    "## 4. Accessible errors",
    "## 5. Tests",
  ]) {
    assert.ok(guide.includes(`\n${heading}\n`), `missing section: ${heading}`);
  }
  assert.match(guide, /client-only and non-custodial/);
  assert.match(guide, /## Checklist for the PR description/);
});

test("the guide includes the existing-code example it names, and that code still matches", () => {
  // The quoted epoch guard must be present in the guide *and* in GuardProvider,
  // so the example cannot drift from the code it claims to show.
  const provider = repoFile("components/GuardProvider.tsx");
  for (const line of [
    "const epoch = readEpochRef.current;",
    "if (epoch !== readEpochRef.current) return;",
    "setSnapshot(null);",
  ]) {
    assert.ok(guide.includes(line), `guide no longer quotes: ${line}`);
    assert.ok(provider.includes(line), `GuardProvider no longer contains: ${line}`);
  }
  const wizard = repoFile("components/SetupWizard.tsx");
  for (const line of [
    "const verified = verification.guard === guard ? verification.value : null;",
    "if (!cancelled) setInitializedState({ guard, value });",
    "const activeSnapshot = snapshot?.guard === guard ? snapshot : null;",
  ]) {
    assert.ok(guide.includes(line), `guide no longer quotes: ${line}`);
    assert.ok(wizard.includes(line), `SetupWizard no longer contains: ${line}`);
  }
});

test("every repository path the guide cites exists", () => {
  const cited = new Set(
    [...guide.matchAll(/`((?:lib|components|tests|scripts)\/[\w./-]+\.(?:ts|tsx|mjs))`/g)].map(
      (match) => match[1]!,
    ),
  );
  assert.ok(cited.size >= 10, `expected the guide to cite reference files, found ${cited.size}`);
  for (const path of cited) {
    assert.ok(existsSync(`${ROOT}${path}`), `${GUIDE_PATH} cites ${path}, which does not exist`);
  }
});

test("every reference symbol the guide names is still exported or defined where it says", () => {
  const symbols: Array<[file: string, pattern: RegExp]> = [
    ["lib/guard/chain.ts", /export type ReadResult<T>/],
    ["lib/guard/chain.ts", /readAt\?: string/],
    ["lib/guard/chain.ts", /function readFailure\(/],
    ["lib/guard/chain.ts", /export function readPolicy\(/],
    ["lib/guard/statusReadState.ts", /export function readPhase</],
    ["lib/guard/statusReadState.ts", /export function balanceText\(/],
    ["components/bits.tsx", /export function Read</],
    ["components/bits.tsx", /export function ReadWithRetry</],
    ["components/bits.tsx", /export const RetryableRead = ReadWithRetry/],
    ["components/bits.tsx", /export function ErrorBlock\(/],
    ["components/bits.tsx", /export function TimeAgo\(/],
    ["components/StatusPanel.tsx", /<TimeAgo iso=\{snapshot\.fetchedAt\} \/>/],
    ["components/GuardProvider.tsx", /const readEpochRef = useRef\(0\)/],
    ["components/GuardProvider.tsx", /const retryRead = useCallback/],
    ["lib/guard/guardScoped.ts", /export function valueInScope</],
    ["lib/guard/guardScoped.ts", /export function bindToScope</],
    ["lib/guard/guardScoped.ts", /export async function runScopedWrite</],
    ["lib/guard/timeout.ts", /export async function withTimeout</],
    ["lib/guard/timeout.ts", /export class DashboardReadError/],
    ["lib/guard/multisigRead.ts", /export async function readAccountSigners\(/],
    ["lib/guard/multisigRead.ts", /incompleteReasons: string\[\]/],
    ["lib/guard/feedHealth.ts", /lastSuccessAt: string \| null/],
    ["lib/guard/feedHealth.ts", /lastAttemptAt: string \| null/],
    ["lib/rpc/timeouts.ts", /export function redactDiagnosticText\(/],
    ["lib/rpc/timeouts.ts", /export function buildReadDiagnostic\(/],
  ];
  for (const [file, pattern] of symbols) {
    assert.match(repoFile(file), pattern, `${file} no longer matches ${pattern}`);
  }
});

test("the guide is reachable from CONTRIBUTING, the architecture page, the widget guide and the GitBook summary", () => {
  const linkers: Array<[file: string, href: string]> = [
    ["CONTRIBUTING.md", "docs/guides/adding-a-read-panel.md"],
    ["docs/architecture.md", "guides/adding-a-read-panel.md"],
    ["docs/guides/contributing-widgets.md", "adding-a-read-panel.md"],
    ["docs/SUMMARY.md", "guides/adding-a-read-panel.md"],
  ];
  for (const [file, href] of linkers) {
    assert.ok(
      repoFile(file).includes(`(${href}`) || repoFile(file).includes(`(./${href}`),
      `${file} does not link ${href}`,
    );
  }
});

// ── 2. The behaviour the page promises ──────────────────────────────────────

// §1 Typed outcomes

test("typed outcomes: three phases, decided in one place", () => {
  assert.equal(readPhase(null), "pending");
  assert.equal(readPhase(undefined), "pending");
  assert.equal(readPhase({ ok: false, error: "rpc down" }), "failed");
  assert.equal(readPhase({ ok: true, value: 0n }), "resolved");
  // An empty resolved value (no policy installed) is resolved, not failed.
  assert.equal(readPhase<null>({ ok: true, value: null }), "resolved");
});

function readOf(result: ReadResult<bigint | null> | null): ReactElement {
  return react.createElement(Read<bigint | null>, {
    result,
    label: "policy()",
    render: (value) => (value === null ? "No policy installed" : `cap ${value.toString()}`),
  });
}

test("typed outcomes: pending is aria-busy and shows no number", async () => {
  const view = await render(readOf(null));
  try {
    const busy = view.host.querySelector('[aria-busy="true"]');
    assert.ok(busy, "pending must mark the slot aria-busy");
    assert.ok(
      view.host.querySelector('.skeleton[aria-hidden="true"]'),
      "skeleton bars are hidden from AT",
    );
    assert.doesNotMatch(view.host.textContent ?? "", /\d/);
  } finally {
    await view.unmount();
  }
});

test("typed outcomes: a failure names the read and is never rendered as zero or empty", async () => {
  const view = await render(readOf({ ok: false, error: "RPC unreachable" }));
  try {
    const text = view.host.textContent ?? "";
    assert.match(text, /policy\(\): read failed/);
    assert.match(text, /RPC unreachable/);
    assert.doesNotMatch(text, /No policy installed|cap 0/);
    assert.equal(view.host.querySelector('[aria-busy="true"]'), null);
  } finally {
    await view.unmount();
  }
});

test("typed outcomes: a genuine zero and a genuine empty render as facts, distinct from failure", async () => {
  const zero = await render(readOf({ ok: true, value: 0n }));
  const empty = await render(readOf({ ok: true, value: null }));
  try {
    assert.equal(zero.host.textContent, "cap 0");
    assert.equal(empty.host.textContent, "No policy installed");
    assert.equal(zero.host.querySelector(".error"), null);
    assert.equal(empty.host.querySelector(".error"), null);
  } finally {
    await zero.unmount();
    await empty.unmount();
  }
});

// §2 Freshness

function fakeHorizon(call: () => Promise<unknown>): Horizon.Server {
  return { accounts: () => ({ accountId: () => ({ call }) }) } as unknown as Horizon.Server;
}

test("freshness: a resolved read carries the time it was observed, from the injected clock", async () => {
  const at = new Date("2026-11-20T10:00:00.000Z");
  const result = await readAccountSigners(
    fakeHorizon(async () => ({
      signers: [{ key: ACCOUNT, weight: 1, type: "ed25519_public_key" }],
      thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 1 },
    })),
    ACCOUNT,
    () => at,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.observedAt, at.toISOString());
});

test("freshness: a failed read carries no timestamp and no substitute value", async () => {
  const result = await readAccountSigners(
    fakeHorizon(async () => {
      throw new Error("Horizon 503");
    }),
    ACCOUNT,
  );
  assert.deepEqual(result, { ok: false, error: "Horizon 503" });
});

test("typed outcomes: partial source data is reported, not defaulted", async () => {
  const result = await readAccountSigners(
    fakeHorizon(async () => ({ signers: [{ key: ACCOUNT, weight: 1 }] })),
    ACCOUNT,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.thresholds, null, "missing thresholds must not become zeros");
  assert.ok(result.value.incompleteReasons.some((reason) => /thresholds/.test(reason)));
});

// §3 Cancellation and identity

test("cancellation: a value read for one guard or network is unavailable under another", () => {
  const held = bindToScope(guardScope(GUARD_A, "testnet"), { hasPolicy: true });
  assert.deepEqual(valueInScope(held, guardScope(GUARD_A, "testnet")), { hasPolicy: true });
  assert.equal(valueInScope(held, guardScope(GUARD_B, "testnet")), null);
  assert.equal(valueInScope(held, guardScope(GUARD_A, "mainnet")), null);
  assert.equal(valueInScope(null, guardScope(GUARD_A, "testnet")), null);
});

test("cancellation: work approved for a guard the operator has left is not started", async () => {
  let ran = false;
  const outcome = await runScopedWrite({
    approval: guardScope(GUARD_A, "testnet"),
    activeScope: () => guardScope(GUARD_B, "testnet"),
    write: async () => {
      ran = true;
      return "done";
    },
  });
  assert.equal(outcome.kind, "stale");
  assert.equal(ran, false);
});

test("cancellation: a context switch while in flight is reported so the result is not painted", async () => {
  let active = guardScope(GUARD_A, "testnet");
  const outcome = await runScopedWrite({
    approval: guardScope(GUARD_A, "testnet"),
    activeScope: () => active,
    write: async (guard) => {
      active = guardScope(GUARD_B, "testnet"); // the operator switches mid-flight
      return guard;
    },
  });
  assert.equal(outcome.kind, "done");
  if (outcome.kind !== "done") return;
  assert.equal(outcome.result, GUARD_A, "the call ran for the approved guard only");
  assert.equal(outcome.stillActive, false);
});

test("cancellation: a hung read fails with a named error and aborts its signal", async () => {
  let seen: AbortSignal | undefined;
  await assert.rejects(
    withTimeout((signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    }, 5),
    (error: unknown) =>
      error instanceof DashboardReadError && /timed out after 5ms/.test(error.message),
  );
  assert.equal(seen?.aborted, true);
});

// §4 Accessible errors

function retryOf(retrying: boolean, onRetry: () => void = () => {}): ReactElement {
  return react.createElement(ReadWithRetry<bigint>, {
    result: { ok: false, error: "simulation failed" },
    label: "window",
    onRetry,
    retrying,
    render: (value) => value.toString(),
  });
}

test("accessible errors: a failed read is an alert with a labelled retry for that read", async () => {
  let retries = 0;
  const view = await render(retryOf(false, () => (retries += 1)));
  try {
    const alert = view.host.querySelector('[role="alert"]');
    assert.ok(alert, "the failure must be announced as an alert");
    assert.match(alert?.textContent ?? "", /window: read failed/);
    assert.match(alert?.textContent ?? "", /simulation failed/);
    const button = view.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry window fetch"]',
    );
    assert.ok(button, "the retry's accessible name must name the read");
    await act(async () => button!.click());
    assert.equal(retries, 1);
  } finally {
    await view.unmount();
  }
});

test("accessible errors: while retrying, the button becomes a status line — and comes back", async () => {
  const retrying = await render(retryOf(true));
  try {
    assert.equal(retrying.host.querySelector("button"), null);
    assert.match(retrying.host.querySelector('[role="status"]')?.textContent ?? "", /Retrying…/);
  } finally {
    await retrying.unmount();
  }
  const settled = await render(retryOf(false));
  try {
    assert.ok(settled.host.querySelector("button"), "a failing retry is never a dead end");
  } finally {
    await settled.unmount();
  }
});

test("accessible errors: RetryableRead is the same component, so call sites cannot diverge", () => {
  assert.equal(RetryableRead, ReadWithRetry);
});
