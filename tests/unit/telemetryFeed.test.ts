import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import type { ReactElement } from "react";
import { GUARD_EVENT_TOPICS } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";
import { TelemetryFeed } from "../../components/TelemetryFeed.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import { POLL_OFF, pollHealth } from "../../lib/guard/feedHealth.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import { scopedStorageKey } from "../../lib/guard/guardScoped.ts";
import {
  BOOKMARKS_STORAGE_BASE,
  rowAnchorId,
  type BookmarkRecord,
} from "../../lib/guard/investigations.ts";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

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
    /** #488: same for the per-guard failure list and the refresh control. */
    failures: [],
    refresh: async () => null,
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
    // Two contexts, not one: the panel reads its rows through
    // `GuardEventsContext`, which the provider keeps deliberately separate from
    // the guard session. An `events` field on the guard context would look
    // right and render nothing.
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

function rows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("table.events tbody tr"));
}

test("the feed names the guards beyond the cap instead of dropping them silently", async () => {
  const rendered = await renderFeed();
  try {
    const text = rendered.container.textContent ?? "";
    assert.match(text, /1 guard beyond the 5-guard cap is not being tailed/);
    assert.match(text, /Guard C/, "the un-tailed guard is named");
  } finally {
    await rendered.unmount();
  }
});

test("every row carries a guard-attribution chip from the registry label", async () => {
  const rendered = await renderFeed();
  try {
    const table = rendered.container.querySelector("table.events");
    assert.ok(table, "the feed table renders");
    const body = rows(rendered.container);
    assert.equal(body.length, 2);
    const renderedText = body.map((row) => row.textContent ?? "").join(" | ");
    assert.match(renderedText, /Guard A/);
    assert.match(renderedText, /Guard B/);
  } finally {
    await rendered.unmount();
  }
});

test("the guard-chip filter narrows the merged feed without dropping the others", async () => {
  const rendered = await renderFeed();
  try {
    assert.equal(rows(rendered.container).length, 2);

    const chip = Array.from(rendered.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Guard B",
    );
    assert.ok(chip, "a filter chip for Guard B must exist");
    await act(async () => {
      chip.click();
    });

    const filtered = rows(rendered.container);
    assert.equal(filtered.length, 1);
    assert.match(filtered[0]?.textContent ?? "", /Guard B/);
    assert.equal(chip.getAttribute("aria-pressed"), "true");

    // Toggling the chip off restores the untailed rows.
    await act(async () => {
      chip.click();
    });
    assert.equal(rows(rendered.container).length, 2);
  } finally {
    await rendered.unmount();
  }
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
      // Issue #490: one field list per format, not one list for four buttons.
      // CSV and JSON share their columns; NDJSON and the audit log have their
      // own, and each line says which field carries the row's origin.
      const fieldLines = Array.from(notice.querySelectorAll("li"))
        .map((item) => item.textContent ?? "")
        .filter((line) => line.startsWith("Fields ("));
      assert.deepEqual(
        fieldLines.map((line) => line.slice(0, line.indexOf(":"))),
        ["Fields (csv, json)", "Fields (ndjson)", "Fields (audit log)"],
      );
      assert.match(fieldLines.join("\n"), /schema_version,[\s\S]*transaction_hash/);
      assert.match(text, /Not exported by CSV or JSON: data/);
      assert.match(text, /NDJSON and audit log carry it/, "and which formats do hold the payload");
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

const GAP_NOTICES = (): HTMLElement[] =>
  Array.from(document.querySelectorAll("[data-testid=feed-gap-notice]"));

test("a lost range is announced with its ledger range, and the received rows still show", async () => {
  const rendered = await renderFeed({
    feed: feedWith([
      {
        guard: GUARD_A,
        label: "Guard A",
        lost: [{ reason: "history_pruned", fromLedger: 106, toLedger: 165, detectedAtLedger: 170 }],
        unsettled: null,
      },
    ]),
  });
  try {
    const notices = GAP_NOTICES();
    assert.equal(notices.length, 1);
    const notice = notices[0]!;
    assert.equal(
      notice.getAttribute("role"),
      "alert",
      "lost events interrupt, they do not wait to be found",
    );
    const text = notice.textContent ?? "";
    assert.match(text, /Possible gaps in the feed for Guard A/);
    assert.match(text, /cannot be recovered/);
    assert.match(text, /Ledgers 106–165/);
    assert.match(text, /about 5 minutes/);
    assert.equal(
      rows(rendered.container).length,
      2,
      "the warning does not hide or discard any received row",
    );
  } finally {
    await rendered.unmount();
  }
});

test("an unsettled position says its range is unknown and that it will clear", async () => {
  const rendered = await renderFeed({
    feed: feedWith([
      {
        guard: GUARD_A,
        label: "Guard A",
        lost: [],
        unsettled: {
          reason: "cursor_regressed",
          fromLedger: null,
          toLedger: null,
          detectedAtLedger: 100,
        },
      },
    ]),
  });
  try {
    const notice = GAP_NOTICES()[0]!;
    assert.equal(notice.getAttribute("role"), "status");
    assert.doesNotMatch(notice.className, /danger/);
    const text = notice.textContent ?? "";
    assert.match(text, /range is unknown/);
    assert.match(text, /clears once a later poll is consistent/);
    assert.doesNotMatch(text, /Ledgers \d/, "no range is invented");
  } finally {
    await rendered.unmount();
  }
});

test("each affected guard gets its own notice, and a feed with none shows none", async () => {
  const two = await renderFeed({
    feed: feedWith([
      {
        guard: GUARD_A,
        label: "Guard A",
        lost: [{ reason: "history_pruned", fromLedger: 1, toLedger: 2, detectedAtLedger: 9 }],
        unsettled: null,
      },
      {
        guard: GUARD_B,
        label: "Guard B",
        lost: [{ reason: "history_pruned", fromLedger: 5, toLedger: 8, detectedAtLedger: 9 }],
        unsettled: null,
      },
    ]),
  });
  try {
    const labels = GAP_NOTICES().map((notice) => notice.textContent ?? "");
    assert.equal(labels.length, 2);
    assert.match(labels[0]!, /Guard A/);
    assert.match(labels[1]!, /Guard B/);
  } finally {
    await two.unmount();
  }

  const none = await renderFeed({ feed: feedWith([]) });
  try {
    assert.equal(GAP_NOTICES().length, 0);
  } finally {
    await none.unmount();
  }
});

// ── Manual refresh and per-guard failures (#488) ───────────────────────────

/**
 * The refresh control, found by its test id rather than its label: the label is
 * state-dependent ("Polling…" while a round is in flight), and a test that
 * located it by text would silently stop finding the very state it means to pin.
 */
function refreshButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("[data-testid=feed-refresh]");
}

const FAILURE_BLOCK = (): HTMLElement | null =>
  document.querySelector("[data-testid=feed-guard-failures]");

test("a watching feed offers a refresh that asks for the window again", async () => {
  let pressed = 0;
  const rendered = await renderFeed(
    {},
    {
      refresh: async () => {
        pressed += 1;
        return { coalesced: false, rounds: 1, events: 2, failedGuards: 0 };
      },
    },
  );
  try {
    const button = refreshButton(rendered.container);
    assert.ok(button, "the panel exposes the refresh control while watching");
    assert.equal(button.textContent?.trim(), "Refresh now", "between rounds it says refresh");
    assert.equal(button.disabled, false, "and it is usable between rounds");
    await act(async () => {
      button.click();
    });
    assert.equal(pressed, 1, "one press is one request for a round");
    // The two controls mean different things and stay separate: refresh re-reads
    // the window, `Clear buffer` empties the table and keeps the cursor.
    assert.ok(buttonByText(rendered.container, "Clear buffer"), "the buffer control is its own");
  } finally {
    await rendered.unmount();
  }
});

test("a refresh is not offered while a round is in flight, and says what it is waiting on", async () => {
  let pressed = 0;
  const rendered = await renderFeed(
    {},
    {
      health: healthOf({ polling: true }),
      refresh: async () => {
        pressed += 1;
        return { coalesced: true, rounds: 0, events: 0, failedGuards: 0 };
      },
    },
  );
  try {
    const button = refreshButton(rendered.container);
    assert.ok(button, "the control is still shown, so its state is readable");
    assert.equal(button.disabled, true, "but it cannot start a second overlapping round");
    assert.equal(button.textContent?.trim(), "Polling…");
    await act(async () => {
      button.click();
    });
    assert.equal(pressed, 0, "a disabled control pressed anyway polls nothing");
  } finally {
    await rendered.unmount();
  }
});

test("there is nothing to refresh when the tail is stopped or a range is on screen", async () => {
  const stopped = await renderFeed({}, { watching: false });
  try {
    assert.equal(
      refreshButton(stopped.container),
      null,
      "a stopped tail has no live cursor to re-read",
    );
  } finally {
    await stopped.unmount();
  }
});

test("every guard whose poll failed is named, alongside how many answered", async () => {
  const rendered = await renderFeed(
    {},
    {
      guards: [
        { guard: GUARD_A, label: "Guard A" },
        { guard: GUARD_B, label: "Guard B" },
      ],
      failures: [{ guard: GUARD_A, label: "Guard A", error: "getEvents timed out" }],
    },
  );
  try {
    const block = FAILURE_BLOCK();
    assert.ok(block, "a partial failure has its own block");
    assert.equal(block.getAttribute("role"), "alert", "a failed poll interrupts");
    const text = block.textContent ?? "";
    assert.match(text, /The event feed could not poll Guard A/);
    assert.match(text, /getEvents timed out/);
    assert.match(
      text,
      /1 of 2 tailed guards answered/,
      "and it says the others still answered, which is not a dead endpoint",
    );
    assert.equal(
      block.querySelectorAll(".tiny").length,
      2,
      "one line per failure plus the count, with no invented third line",
    );
  } finally {
    await rendered.unmount();
  }
});

test("all guards failing is said differently from one guard failing", async () => {
  const rendered = await renderFeed(
    {},
    {
      failures: [
        { guard: GUARD_A, label: "Guard A", error: "timed out" },
        { guard: GUARD_B, label: "Guard B", error: "429" },
      ],
    },
  );
  try {
    const text = FAILURE_BLOCK()?.textContent ?? "";
    assert.match(text, /could not poll 2 of its tailed guards/);
    assert.match(text, /Guard B: 429/, "the second failure is listed, not dropped");
    assert.match(text, /No tailed guard answered/);
  } finally {
    await rendered.unmount();
  }
});

test("a round that never reached a guard keeps its own single error, with no failure list", async () => {
  const rendered = await renderFeed({}, { error: "RPC host is unreachable" });
  try {
    assert.match(rendered.container.textContent ?? "", /could not poll/);
    assert.equal(FAILURE_BLOCK(), null, "no guard failed, so none is named as having failed");
  } finally {
    await rendered.unmount();
  }
});

// ── The investigation timeline (#489) ─────────────────────────────────────

/*
 * A bookmark is the part of the feed an operator keeps when the table stops
 * being enough: the tail holds a window, and the buffer, the filter, the tailed
 * set and the guard on screen all change underneath it. So these cases pin what
 * the panel claims out loud — that the sequence is placed by a time it can name,
 * that an item reaches the row it came from or says the row is gone, and that
 * taking a bookmark off takes it off for good.
 */

function bookmarkKey(guard: string): string {
  return scopedStorageKey(BOOKMARKS_STORAGE_BASE, NETWORK.name, guard);
}

/** Seed one guard's bucket straight into storage, as an earlier session left it. */
function seedBookmarks(
  guard: string,
  entries: Array<Partial<BookmarkRecord> & { eventId: string }>,
): void {
  const records: BookmarkRecord[] = entries.map((entry) => ({
    network: NETWORK.name,
    guard,
    kind: "auth_checked" as const,
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "ledger" as const,
    contractId: guard,
    ledger: null,
    ledgerClosedAt: null,
    observedAt: null,
    transactionHash: null,
    decision: "allowed",
    reason: null,
    bookmarkedAt: "2026-10-21T09:00:00.000Z",
    ...entry,
  }));
  window.localStorage.setItem(bookmarkKey(guard), JSON.stringify(records));
}

function storedBookmarks(guard: string): BookmarkRecord[] {
  const raw = window.localStorage.getItem(bookmarkKey(guard));
  return raw === null ? [] : (JSON.parse(raw) as BookmarkRecord[]);
}

function clearBookmarks(): void {
  for (const guard of [GUARD_A, GUARD_B, GUARD_C]) {
    window.localStorage.removeItem(bookmarkKey(guard));
  }
}

function timelineSection(container: HTMLElement): Element | null {
  return container.querySelector("[data-testid=investigation-timeline]");
}

function timelineItems(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll("[data-testid=timeline-item]"));
}

function timelineText(container: HTMLElement): string {
  return timelineSection(container)?.textContent ?? "";
}

function bookmarkOf(row: Element | undefined): HTMLButtonElement | null {
  return row?.querySelector<HTMLButtonElement>("[data-testid=feed-bookmark]") ?? null;
}

/**
 * jsdom has no `scrollIntoView`, and the link handler would throw before it
 * could be observed. Recording which element was asked to scroll is also the
 * only way to tell the row's own id apart from a decoded fragment.
 */
function stubScrollIntoView(): { ids: string[]; restore: () => void } {
  const ids: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element): void {
    ids.push(this.id);
  };
  return {
    ids,
    restore: () => {
      if (original === undefined) {
        delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      } else {
        Element.prototype.scrollIntoView = original;
      }
    },
  };
}

describe("the investigation timeline (issue #489)", () => {
  beforeEach(clearBookmarks);

  test("a row is bookmarked from the row, and the timeline appears below the table", async () => {
    const rendered = await renderFeed();
    try {
      assert.equal(timelineSection(rendered.container), null, "nothing is bookmarked yet");
      assert.match(
        rendered.container.textContent ?? "",
        /Bookmark a row to keep it/,
        "the empty state says how to start one",
      );

      const row = rows(rendered.container)[0];
      assert.ok(row, "the committed row is on screen");
      const button = bookmarkOf(row);
      assert.ok(button, "the row itself carries the bookmark control");
      assert.equal(button.getAttribute("aria-pressed"), "false");
      assert.equal(button.textContent?.trim(), "bookmark");

      await act(async () => {
        button.click();
      });

      assert.equal(button.getAttribute("aria-pressed"), "true", "the row says it is being held");
      assert.equal(button.textContent?.trim(), "bookmarked");
      const section = timelineSection(rendered.container);
      assert.ok(section, "the timeline appears");
      assert.equal(section.getAttribute("aria-label"), "Investigation timeline");
      assert.match(timelineText(rendered.container), /1 bookmarked/);
      assert.deepEqual(
        storedBookmarks(GUARD_A).map((record) => record.eventId),
        [FEED_EVENTS[0]?.id],
        "the bookmark is written into the guard's own bucket",
      );
    } finally {
      await rendered.unmount();
    }
  });

  test("pressing the same control again takes the row out of the timeline", async () => {
    const rendered = await renderFeed();
    try {
      const button = bookmarkOf(rows(rendered.container)[0]);
      assert.ok(button);
      await act(async () => {
        button.click();
      });
      assert.equal(timelineItems(rendered.container).length, 1);

      await act(async () => {
        button.click();
      });
      assert.equal(timelineSection(rendered.container), null);
      assert.equal(button.getAttribute("aria-pressed"), "false");
      assert.deepEqual(storedBookmarks(GUARD_A), [], "the removal is written, not just hidden");
    } finally {
      await rendered.unmount();
    }
  });

  test("the sequence is placed by time, and every item names the time that placed it", async () => {
    seedBookmarks(GUARD_A, [
      {
        eventId: "ledger:tx-1001:event_auth_checked",
        ledger: 1001,
        ledgerClosedAt: "2026-10-21T10:00:00.000Z",
      },
    ]);
    seedBookmarks(GUARD_B, [
      {
        eventId: "diag:earlier",
        source: "diagnostic",
        observedAt: "2026-10-20T10:00:00.000Z",
      },
    ]);
    seedBookmarks(GUARD_C, [
      { eventId: "diag:undated", source: "diagnostic", decision: null, bookmarkedAt: "" },
    ]);

    const rendered = await renderFeed();
    try {
      const items = timelineItems(rendered.container);
      assert.equal(items.length, 3, "bookmarks from guards nobody is watching join the sequence");
      assert.match(timelineText(rendered.container), /3 bookmarked/);
      // The diagnostic row observed a day before the committed one closed sorts
      // first: the sequence is chronological, and the label — not the position —
      // is what tells the operator which of the two clocks it came from.
      assert.deepEqual(
        items.map((item) => item.getAttribute("data-ordering")),
        ["observed", "ledger", "missing"],
      );
      const text = items.map((item) => item.textContent ?? "");
      assert.match(text[0] ?? "", /observed locally/);
      assert.match(text[1] ?? "", /ledger time/);
      assert.match(text[2] ?? "", /no ordering data/);
      assert.match(text[2] ?? "", /no time recorded/, "an undated item is given no fake instant");
    } finally {
      await rendered.unmount();
    }
  });

  test("a bookmark on another guard's row is filed under that guard, not the one on screen", async () => {
    const rendered = await renderFeed();
    try {
      // The guard on screen is Guard A; this row came from Guard B.
      const row = rows(rendered.container)[1];
      assert.ok(row, "the second guard's row is in the merged table");
      const button = bookmarkOf(row);
      assert.ok(button);
      await act(async () => {
        button.click();
      });

      const item = timelineItems(rendered.container)[0];
      const text = item?.textContent ?? "";
      assert.match(text, /Guard B/, "attributed to the guard that emitted the event");
      assert.doesNotMatch(
        text,
        /Guard A/,
        "not to the guard the operator happens to be looking at",
      );
      assert.equal(item?.getAttribute("data-stream"), "diagnostic");
      assert.equal(storedBookmarks(GUARD_B).length, 1);
      assert.deepEqual(
        storedBookmarks(GUARD_A),
        [],
        "nothing is filed under the on-screen guard, so deleting it cannot erase this bookmark",
      );
    } finally {
      await rendered.unmount();
    }
  });

  test("an item links to its row, and following the link moves the table to it", async () => {
    const scroll = stubScrollIntoView();
    const rendered = await renderFeed();
    try {
      const row = rows(rendered.container)[0];
      assert.ok(row);
      const button = bookmarkOf(row);
      assert.ok(button);
      await act(async () => {
        button.click();
      });

      const link = rendered.container.querySelector<HTMLAnchorElement>(
        "[data-testid=timeline-source-link]",
      );
      assert.ok(link, "a row that is on screen is reachable from the timeline");
      assert.equal(link.getAttribute("href"), `#${row.id}`);
      assert.match(
        row.id,
        /%3A/,
        "the anchor is percent-encoded, so a fragment decoded by the browser could never match it",
      );

      await act(async () => {
        link.click();
      });
      assert.deepEqual(scroll.ids, [row.id], "the click resolved the id itself");
      assert.equal(document.activeElement, row, "and the reader lands on the row, not near it");
    } finally {
      await rendered.unmount();
      scroll.restore();
    }
  });

  test("a bookmark outlives the row it came from instead of vanishing with the view", async () => {
    const rendered = await renderFeed();
    try {
      const button = bookmarkOf(rows(rendered.container)[0]);
      assert.ok(button);
      await act(async () => {
        button.click();
      });
      assert.equal(timelineItems(rendered.container).length, 1);

      const chip = buttonByText(rendered.container, "Guard B");
      assert.ok(chip, "the feed's own guard filter");
      await act(async () => {
        chip.click();
      });

      assert.equal(rows(rendered.container).length, 1, "the table now shows only Guard B's row");
      const items = timelineItems(rendered.container);
      assert.equal(items.length, 1, "the timeline kept the bookmark the table lost");
      assert.match(items[0]?.textContent ?? "", /its row is not in this table/);
      assert.equal(
        rendered.container.querySelector("[data-testid=timeline-source-link]"),
        null,
        "and it does not link to a row that is not there",
      );

      const remove = items[0]?.querySelector<HTMLButtonElement>("[data-testid=timeline-remove]");
      assert.ok(remove, "an item you cannot reach is still an item you can take off");
      await act(async () => {
        remove.click();
      });
      assert.equal(timelineSection(rendered.container), null);
      assert.deepEqual(storedBookmarks(GUARD_A), [], "the removal reaches the bucket");
    } finally {
      await rendered.unmount();
    }
  });

  test("a bookmark removed from the timeline stays removed after the panel reloads", async () => {
    // Guard C is saved but not tailed, so its row can never appear in this
    // table: the timeline is the only place its bookmarks can be managed.
    seedBookmarks(GUARD_C, [
      {
        eventId: "ledger:tx-9999:event_auth_checked",
        ledger: 9999,
        ledgerClosedAt: "2026-10-21T10:00:00.000Z",
      },
    ]);

    const first = await renderFeed();
    try {
      const remove = first.container.querySelector<HTMLButtonElement>(
        "[data-testid=timeline-remove]",
      );
      assert.ok(remove, "the item whose row is gone offers removal");
      await act(async () => {
        remove.click();
      });
      assert.equal(timelineSection(first.container), null);
    } finally {
      await first.unmount();
    }

    const again = await renderFeed();
    try {
      assert.equal(
        timelineSection(again.container),
        null,
        "a fresh read of storage finds the bookmark gone, not waiting to come back",
      );
    } finally {
      await again.unmount();
    }
  });
});

// ── Availability guidance (#491) ───────────────────────────────────────────
//
// The panel reports absence in four different shapes — a health line, a gap
// notice, an empty table, an empty filtered view — and all four can be misread
// as "nothing happened on chain". Each one now carries the link to the document
// that says what it can and cannot prove, with wording specific to that absence.
// These tests pin that the link is present where the operator is staring at the
// missing rows, and that it points at a page this repository actually ships.

const AVAILABILITY_DOC =
  "https://github.com/Stellar-Agent-Guard/stellar-agent-guard-dashboard/blob/main/docs/concepts/historical-event-availability.md";

const availabilityLinks = (root: ParentNode): HTMLAnchorElement[] =>
  Array.from(root.querySelectorAll<HTMLAnchorElement>("[data-testid=feed-availability-doc]"));

test("the health line links what an empty table can and cannot prove", async () => {
  const rendered = await renderFeed();
  try {
    const line = rendered.container.querySelector('[aria-label="Telemetry poll health"]');
    assert.ok(line);
    const link = availabilityLinks(line)[0];
    assert.ok(link, "the absence the health line describes is explained somewhere");
    assert.equal(link.getAttribute("href"), AVAILABILITY_DOC);
    assert.match(link.textContent ?? "", /empty table is not proof of no activity/);
    assert.match(link.getAttribute("rel") ?? "", /noreferrer/);
  } finally {
    await rendered.unmount();
  }
});

test("a failing feed says the same thing as a quiet one, so the link is not conditional on health", async () => {
  const rendered = await renderFeed(
    {},
    {
      health: pollHealth({
        watching: true,
        polling: false,
        lastSuccessAt: isoAt(-120_000),
        lastAttemptAt: isoAt(-5_000),
        lastFailureAt: isoAt(-5_000),
        error: "getEvents failed: connection refused",
        eventsInLastRound: 0,
        nowMs: NOW,
        intervalMs: INTERVAL,
      }),
      error: "getEvents failed: connection refused",
    },
  );
  try {
    const line = rendered.container.querySelector('[aria-label="Telemetry poll health"]');
    assert.ok(availabilityLinks(line ?? rendered.container).length >= 1);
  } finally {
    await rendered.unmount();
  }
});

test("each gap notice carries the availability guidance for the range it lost", async () => {
  const rendered = await renderFeed({
    feed: feedWith([
      {
        guard: GUARD_A,
        label: "Guard A",
        lost: [{ reason: "history_pruned", fromLedger: 106, toLedger: 165, detectedAtLedger: 170 }],
        unsettled: null,
      },
      {
        guard: GUARD_B,
        label: "Guard B",
        lost: [],
        unsettled: {
          reason: "cursor_regressed",
          fromLedger: null,
          toLedger: null,
          detectedAtLedger: 170,
        },
      },
    ]),
  });
  try {
    const notices = GAP_NOTICES();
    assert.equal(notices.length, 2);
    for (const notice of notices) {
      const link = availabilityLinks(notice)[0];
      assert.ok(link, "a hole in coverage is where the reader needs the limits written down");
      assert.equal(link.getAttribute("href"), AVAILABILITY_DOC);
      assert.match(link.textContent ?? "", /How far back this endpoint can go/);
    }
    assert.equal(
      availabilityLinks(notices[0]!).length,
      1,
      "one link per notice, not one per lost range",
    );
  } finally {
    await rendered.unmount();
  }
});

test("a watched-but-empty table links why nothing appears, and a stopped one does not claim to", async () => {
  const watched = await renderFeed({}, {}, []);
  try {
    const labels = availabilityLinks(watched.container).map((link) => link.textContent ?? "");
    assert.deepEqual(
      labels,
      ["Why an empty table is not proof of no activity ↗", "Why nothing appears here ↗"],
      "the health line and the empty table each say their own piece",
    );
  } finally {
    await watched.unmount();
  }

  const stopped = await renderFeed({}, { watching: false }, []);
  try {
    const labels = availabilityLinks(stopped.container).map((link) => link.textContent ?? "");
    assert.deepEqual(
      labels,
      ["Why an empty table is not proof of no activity ↗"],
      "a table nobody is polling needs the operator to start watching, not a lecture about retention",
    );
    assert.match(
      stopped.container.textContent ?? "",
      /Start watching to tail these guards' events\./,
    );
  } finally {
    await stopped.unmount();
  }
});

test("a filtered-out table links what the feed held before the filter was applied", async () => {
  // The verdict filter is shareable URL state, which the panel reads on mount,
  // so this is the one filter the component can be started with rather than
  // driven through. `allowed` against a single blocked row leaves zero rows
  // over two held events: the filtered-empty branch, not the empty-feed one.
  window.history.replaceState(null, "", "/?filter=allowed");
  const blockedOnly = [event(GUARD_A, 100, true)];
  const rendered = await renderFeed({}, {}, blockedOnly);
  try {
    const text = rendered.container.textContent ?? "";
    assert.match(text, /No events match the current filter/);
    const link = availabilityLinks(rendered.container).at(-1);
    assert.ok(link);
    assert.match(link.textContent ?? "", /What the feed held before the filter was applied/);
    assert.equal(link.getAttribute("href"), AVAILABILITY_DOC);
  } finally {
    await rendered.unmount();
    window.history.replaceState(null, "", "/");
  }
});
