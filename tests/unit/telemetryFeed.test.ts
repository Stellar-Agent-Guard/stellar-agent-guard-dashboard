import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { TelemetryFeed } from "../../components/TelemetryFeed.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import { POLL_OFF, pollHealth } from "../../lib/guard/feedHealth.ts";

installDom();

const cursorAt = (ledger: number, index = 0) =>
  `${String(ledger).padStart(19, "0")}-${String(index).padStart(10, "0")}`;

const GUARD_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const GUARD_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const GUARD_C = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/** A pinned clock for the health cases, so "ago" wording is exact. */
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const INTERVAL = 5_000;

function isoAt(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function healthOf(overrides: Record<string, unknown> = {}) {
  return pollHealth({
    watching: true,
    polling: false,
    lastSuccessAt: isoAt(-2_000),
    lastAttemptAt: isoAt(-2_000),
    lastFailureAt: null,
    error: null,
    eventsInLastRound: 0,
    nowMs: NOW,
    intervalMs: INTERVAL,
    ...overrides,
  });
}

function event(contractId: string, ledger: number | null, blocked: boolean): GuardEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: blocked ? "diagnostic" : "ledger",
    contractId,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    transactionHash: blocked ? null : `tx-${contractId.slice(0, 4)}`,
    decision: {
      result: blocked ? "blocked" : "allowed",
      reason: blocked ? "per_tx_cap_exceeded" : null,
      source: blocked ? "diagnostic" : "ledger",
    },
    data: {},
  });
}

/**
 * The merged multi-guard tail: one allowed committed row from Guard A and one
 * blocked diagnostic row from Guard B, so attribution and the chip filter each
 * have something to discriminate.
 */
const FEED_EVENTS = [event(GUARD_A, 100, false), event(GUARD_B, null, true)];

/**
 * The feed slice of the context. Split out so a test can move one field (the
 * health reading, the tailed set) without restating the whole feed.
 */
function feedState(overrides: Record<string, unknown> = {}) {
  return {
    watching: true,
    latestLedger: 100,
    error: null,
    lastPolledAt: isoAt(-2_000),
    guards: [
      { guard: GUARD_A, label: "Guard A" },
      { guard: GUARD_B, label: "Guard B" },
    ],
    capped: 1,
    cappedLabels: ["Guard C"],
    health: POLL_OFF,
    /** #308: the panel maps this, so a fixture without it renders nothing. */
    gaps: [],
    ...overrides,
  };
}

function contextValue(
  overrides: Record<string, unknown> = {},
  feedOverrides: Record<string, unknown> = {},
) {
  return {
    server: new Proxy({}, { get: () => () => Promise.reject(new Error("no network in tests")) }),
    wallet: null,
    walletError: null,
    connecting: false,
    connect: async () => {},
    disconnect: () => {},
    signer: () => {
      throw new Error("no signing in feed tests");
    },
    instances: [
      { guard: GUARD_A, label: "Guard A", provenance: "test" },
      { guard: GUARD_B, label: "Guard B", provenance: "test" },
      { guard: GUARD_C, label: "Guard C", provenance: "test" },
    ],
    guard: GUARD_A,
    selectGuard: () => {},
    addInstance: () => {},
    snapshot: null,
    snapshotError: null,
    refreshing: false,
    refresh: async () => {},
    stream: { paused: false, pendingCount: 0, dropped: 0 },
    pauseStream: () => {},
    resumeStream: () => {},
    queryRange: async () => {},
    rangeLabel: null,
    feed: feedState(feedOverrides),
    startWatching: () => {},
    stopWatching: () => {},
    tailSelection: [],
    toggleTailedGuard: () => {},
    exportRange: null,
    clearEvents: () => {},
    pushEvents: () => {},
    notifyTabs: () => {},
    ...overrides,
  } as any;
}

async function renderFeed(
  overrides: Record<string, unknown> = {},
  feedOverrides: Record<string, unknown> = {},
  events = FEED_EVENTS,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    const element: ReactElement = react.createElement(TelemetryFeed);
    root.render(
      react.createElement(
        GuardContext.Provider,
        { value: contextValue(overrides, feedOverrides) },
        react.createElement(GuardEventsContext.Provider, { value: events }, element),
      ),
    );
  });
  await act(async () => {
    await sleep(40);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

/*
 * ---------------------------------------------------------------------------
 * Issues #309, #310 and #311 — the panel's own behaviour on top of the three
 * new modules. The modules are unit-tested directly; these cases pin that the
 * operator actually sees the distinction each one computes.
 * ---------------------------------------------------------------------------
 */

function textOf(container: HTMLElement, selector: string): string {
  return container.querySelector(selector)?.textContent ?? "";
}

function healthLine(container: HTMLElement): Element | null {
  return container.querySelector('[aria-label="Telemetry poll health"]');
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
}

function tailCheckbox(container: HTMLElement, label: string): HTMLInputElement | undefined {
  return (
    container.querySelector<HTMLInputElement>(`input[aria-label="Tail ${label}"]`) ?? undefined
  );
}

describe("poll health is shown apart from event activity (issue #311)", () => {
  test("a failed poll is named as a failure and never as a quiet guard", async () => {
    const rendered = await renderFeed(
      {},
      {
        error: "getEvents timed out",
        lastPolledAt: isoAt(-5_000),
        health: healthOf({
          lastSuccessAt: isoAt(-60_000),
          lastAttemptAt: isoAt(-5_000),
          lastFailureAt: isoAt(-5_000),
          error: "getEvents timed out",
        }),
      },
    );
    try {
      const line = healthLine(rendered.container);
      assert.ok(line, "the panel must state poll liveness in its own element");
      assert.equal(line.getAttribute("aria-label"), "Telemetry poll health");
      assert.match(line.textContent ?? "", /last poll failed/);
      assert.doesNotMatch(line.textContent ?? "", /which is normal for a quiet guard/);
      assert.match(
        textOf(rendered.container, '[aria-label="Telemetry poll health"] .pill'),
        /poll failing/,
      );
      assert.equal(line.querySelector(".pill")?.className, "pill danger");
      assert.match(
        rendered.container.textContent ?? "",
        /could not poll/,
        "the error block is shown too",
      );
    } finally {
      await rendered.unmount();
    }
  });

  test("an empty table under a healthy poll is explained as a quiet guard, not a fault", async () => {
    const rendered = await renderFeed({}, { health: healthOf({ eventsInLastRound: 0 }) });
    try {
      const text = healthLine(rendered.container)?.textContent ?? "";
      assert.match(text, /returned no events/);
      assert.match(text, /normal for a quiet guard/);
      assert.doesNotMatch(text, /failed|not updating|No poll has landed/);
      assert.equal(healthLine(rendered.container)?.querySelector(".pill")?.className, "pill ok");
    } finally {
      await rendered.unmount();
    }
  });

  test("a feed that stopped answering says so, and says it while the table still looks empty", async () => {
    const rendered = await renderFeed(
      {},
      { health: healthOf({ lastSuccessAt: isoAt(-90_000) }) },
      [],
    );
    try {
      assert.equal(rows(rendered.container).length, 0, "the table is empty either way");
      assert.match(healthLine(rendered.container)?.textContent ?? "", /No poll has landed for/);
    } finally {
      await rendered.unmount();
    }
  });

  test("the last attempt is shown separately from the last success, and only when they differ", async () => {
    const diverging = await renderFeed(
      {},
      {
        lastPolledAt: isoAt(-5_000),
        health: healthOf({
          lastSuccessAt: isoAt(-90_000),
          lastFailureAt: isoAt(-5_000),
          error: "500",
        }),
      },
    );
    try {
      assert.match(
        diverging.container.textContent ?? "",
        /Last attempt/,
        "an attempt stamp is offered because it is not the success stamp",
      );
    } finally {
      await diverging.unmount();
    }

    const agreeing = await renderFeed(
      {},
      { lastPolledAt: isoAt(-2_000), health: healthOf({ lastSuccessAt: isoAt(-2_000) }) },
    );
    try {
      assert.doesNotMatch(
        agreeing.container.textContent ?? "",
        /Last attempt/,
        "when the last round both started and succeeded, one sentence is enough",
      );
    } finally {
      await agreeing.unmount();
    }
  });

  test("a stopped feed says it is not watching, and the live pill leaves the header", async () => {
    const rendered = await renderFeed(
      {},
      { watching: false, health: POLL_OFF, guards: [], capped: 0, cappedLabels: [] },
    );
    try {
      assert.match(healthLine(rendered.container)?.textContent ?? "", /Not watching this feed/);
      const header = Array.from(rendered.container.querySelectorAll("h2"))
        .find((heading) => heading.textContent === "Telemetry")
        ?.closest("div");
      assert.ok(header);
      assert.doesNotMatch(header.textContent ?? "", /stopped|polling|poll failing/);
      assert.ok(buttonByText(rendered.container, "Start watching"), "and the control says so too");
    } finally {
      await rendered.unmount();
    }
  });
});

describe("the operator chooses which guards spend feed capacity (issue #310)", () => {
  test("every saved guard is offered a slot, and the one outside the tail is unchecked", async () => {
    const rendered = await renderFeed({ tailSelection: [GUARD_B] });
    try {
      const a = tailCheckbox(rendered.container, "Guard A");
      const b = tailCheckbox(rendered.container, "Guard B");
      const c = tailCheckbox(rendered.container, "Guard C");
      assert.ok(a && b && c, "each registry guard gets a control");

      // The active guard is pinned by rule (#23), so it is shown as such rather
      // than as a choice the operator could lose.
      assert.equal(a.checked, true);
      assert.equal(a.disabled, true);
      assert.match(a.parentElement?.textContent ?? "", /on screen/);
      assert.doesNotMatch(c.parentElement?.textContent ?? "", /on screen/);

      assert.equal(b.checked, true, "a tailed, selected guard reads as checked");
      assert.equal(c.checked, false, "the guard outside the cap reads as unchecked, not missing");
      assert.match(
        textOf(rendered.container, "fieldset legend"),
        /Guards to tail \(2 of 5 slots used\)/,
      );
    } finally {
      await rendered.unmount();
    }
  });

  test("ticking a guard hands the choice to the provider instead of the registry deciding", async () => {
    const chosen: string[] = [];
    const rendered = await renderFeed({ toggleTailedGuard: (guard: string) => chosen.push(guard) });
    try {
      const c = tailCheckbox(rendered.container, "Guard C");
      assert.ok(c);
      await act(async () => {
        c.click();
      });
      assert.deepEqual(chosen, [GUARD_C], "one call, for the guard that was clicked");
    } finally {
      await rendered.unmount();
    }
  });

  test("the cap notice names the untailed guards and points at the chooser", async () => {
    const rendered = await renderFeed();
    try {
      const notices = Array.from(rendered.container.querySelectorAll('[role="status"]')).map(
        (node) => node.textContent ?? "",
      );
      const capped = notices.find((text) => /beyond the 5-guard cap/.test(text));
      assert.ok(capped, "the cap is announced as a status, not as silent truncation");
      assert.match(capped, /Guard C/, "named, not counted");
      assert.match(capped, /Choose which[\s\S]*tail/);
      assert.ok(tailCheckbox(rendered.container, "Guard C"), "and the choice is actually offered");
    } finally {
      await rendered.unmount();
    }
  });

  test("the panel says which guards are live, so the count cannot be read as the registry size", async () => {
    const rendered = await renderFeed();
    try {
      assert.match(
        rendered.container.textContent ?? "",
        /Tailing 2 guards simultaneously, up to the 5-guard cap/,
      );
      assert.match(
        rendered.container.textContent ?? "",
        /remembered for .* only/i,
        "selection is per network, and the panel says so",
      );
    } finally {
      await rendered.unmount();
    }
  });
});

describe("the export is previewed before it is downloaded (issue #309)", () => {
  const scopeNotice = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("div.notice")).find(
      (notice) => notice.querySelector("strong")?.textContent === "Export scope",
    );

  test("the live tail's scope names the range, the count and the diagnostics", async () => {
    const rendered = await renderFeed();
    try {
      const notice = scopeNotice(rendered.container);
      assert.ok(notice, "the panel shows an export preview at all");
      const text = notice.textContent ?? "";
      assert.match(text, /Time range: Live tail — no time bound/);
      assert.match(text, /2 of 2 event\(s\) in scope/);
      assert.match(text, /Diagnostics: included \(1 row\(s\)\)/);
      assert.match(text, /Fields: schema_version,[\s\S]*transaction_hash/);
      assert.match(text, /Not exported: data/, "the payload field is named as omitted");
    } finally {
      await rendered.unmount();
    }
  });

  test("a historical range in force is the range the preview states", async () => {
    const rendered = await renderFeed({
      exportRange: { fromUnixSecs: 100, toUnixSecs: 200 },
      rangeLabel: "Last 24 Hours",
    });
    try {
      const text = scopeNotice(rendered.container)?.textContent ?? "";
      assert.match(text, /Time range: Last 24 Hours/);
      assert.match(text, /0 of 2 event\(s\) in scope/);
      assert.match(text, /2 outside the range excluded/);
    } finally {
      await rendered.unmount();
    }
  });

  test("nothing can be exported from an empty scope, so the number cannot surprise the operator", async () => {
    const rendered = await renderFeed({ exportRange: { fromUnixSecs: 100, toUnixSecs: 200 } });
    try {
      for (const label of ["Export CSV", "Export JSON", "Export NDJSON", "Export audit log"]) {
        const button = buttonByText(rendered.container, label);
        assert.ok(button, `${label} exists`);
        assert.equal(button.disabled, true, `${label} is disabled when the preview has no rows`);
      }
    } finally {
      await rendered.unmount();
    }
  });

  test("the buttons enable exactly when the preview has rows", async () => {
    const rendered = await renderFeed();
    try {
      const button = buttonByText(rendered.container, "Export CSV");
      assert.ok(button);
      assert.equal(button.disabled, false);
      assert.equal(rows(rendered.container).length, 2, "the same rows the preview counted");
    } finally {
      await rendered.unmount();
    }
  });
});

// ── Coverage warnings (#308) ───────────────────────────────────────────────

function feedWith(gaps: unknown[]) {
  return feedState({
    guards: [{ guard: GUARD_A, label: "Guard A" }],
    capped: 0,
    cappedLabels: [],
    gaps,
  });
}

function event(contractId: string, ledger: number | null, blocked: boolean): GuardEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: blocked ? "diagnostic" : "ledger",
    contractId,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    transactionHash: blocked ? null : `tx-${contractId.slice(0, 4)}`,
    decision: {
      result: blocked ? "blocked" : "allowed",
      reason: blocked ? "per_tx_cap_exceeded" : null,
      source: blocked ? "diagnostic" : "ledger",
    },
    data: {},
  });
}

describe("TelemetryFeed component", () => {
  it("renders events in rows with attribution chips and severity badges", async () => {
    const { container, unmount } = await renderFeed();
    const trs = rows(container);
    assert.equal(trs.length, 3);
    await unmount();
  });

  it("renders history pruning and cursor regression gaps warning notices", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 200,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [{ guard: GUARD_A, label: "Guard A" }],
        capped: 0,
        cappedLabels: [],
        gaps: [
          {
            reason: "history_pruned",
            fromLedger: 100,
            toLedger: 150,
            heldCursor: cursorAt(99),
            receivedCursor: cursorAt(151),
            at: new Date().toISOString(),
          },
          {
            reason: "cursor_regressed",
            fromLedger: null,
            toLedger: null,
            heldCursor: cursorAt(200),
            receivedCursor: cursorAt(180),
            at: new Date().toISOString(),
          },
        ],
      },
    });
    const banner = container.querySelector("[data-tier]");
    assert.ok(banner);
    assert.match(banner.textContent || "", /history pruned|coverage gap|cursor regressed/i);
    await unmount();
  });

  it("detects cursor discontinuity and displays feed gap warning", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 150,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [{ guard: GUARD_A, label: "Guard A" }],
        capped: 0,
        cappedLabels: [],
        gaps: [
          {
            reason: "history_pruned",
            fromLedger: 101,
            toLedger: 140,
            heldCursor: cursorAt(100),
            receivedCursor: cursorAt(141),
            at: new Date().toISOString(),
          },
        ],
      },
    });
    const notice = container.querySelector(".notice");
    assert.ok(notice);
    assert.match(notice.textContent || "", /pruned|gap/i);
    await unmount();
  });
});
