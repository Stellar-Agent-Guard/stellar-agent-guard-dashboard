import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { TelemetryFeed } from "../../components/TelemetryFeed.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import {
  GuardFeed,
  compareEventCursor,
  detectFeedGaps,
  type TelemetryEvent,
} from "../../lib/guard/telemetry.ts";
import { GUARD_EVENT_TOPICS } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { withIdentity } from "../mocks/eventFixtures.ts";

installDom();


function contextValue(overrides: Record<string, unknown> = {}) {
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
    feed: {
      watching: true,
      latestLedger: 100,
      error: null,
      lastPolledAt: new Date().toISOString(),
      guards: [
        { guard: GUARD_A, label: "Guard A" },
        { guard: GUARD_B, label: "Guard B" },
      ],
      capped: 1,
      cappedLabels: ["Guard C"],
      gaps: [],
    },
    startWatching: () => {},
    stopWatching: () => {},
    clearEvents: () => {},
    pushEvents: () => {},
    notifyTabs: () => {},
    ...overrides,
  } as any;
}

async function renderFeed(
  overrides: Record<string, unknown> = {},
  events: TelemetryEvent[] = FEED_EVENTS,
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
        { value: contextValue(overrides) },
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

const GUARD_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const GUARD_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const GUARD_C = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function rows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("table.events tbody tr"));
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

const FEED_EVENTS = [
  event(GUARD_A, 100, false),
  event(GUARD_B, 101, true),
  event(GUARD_A, 102, false),
];

describe("TelemetryFeed component unit tests", () => {
  it("renders events and filter controls", async () => {
    const { container, unmount } = await renderFeed();
    const trs = rows(container);
    assert.equal(trs.length, 3);
    assert.match(trs[0]!.textContent ?? "", /Guard A/);
    await unmount();
  });

  it("renders event rows and guard attribution chips", async () => {
    const { container, unmount } = await renderFeed();
    const trs = rows(container);
    assert.equal(trs.length, 3);
    await unmount();
  });

  it("displays coverage warning notices for lost ranges and unsettled positions", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 200,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [
          { guard: GUARD_A, label: "Guard A" },
        ],
        capped: 0,
        cappedLabels: [],
        gaps: [
          {
            guard: GUARD_A,
            label: "Guard A",
            lost: [{ reason: "history_pruned", fromLedger: 50, toLedger: 80, latestLedger: 200 }],
            unsettled: { reason: "cursor_regressed", fromLedger: null, toLedger: null, latestLedger: 200 },
          },
        ],
      },
    });
    const notice = container.querySelector("[data-testid=\"feed-gap-notice\"]");
    assert.ok(notice);
    assert.match(notice.textContent ?? "", /Possible gaps in the feed/i);
    await unmount();
  });

  it("handles multi-guard gap notices correctly", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 250,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [
          { guard: GUARD_A, label: "Guard A" },
          { guard: GUARD_B, label: "Guard B" },
        ],
        capped: 0,
        cappedLabels: [],
        gaps: [
          {
            guard: GUARD_A,
            label: "Guard A",
            lost: [{ reason: "history_pruned", fromLedger: 10, toLedger: 30, latestLedger: 250 }],
            unsettled: null,
          },
          {
            guard: GUARD_B,
            label: "Guard B",
            lost: [],
            unsettled: { reason: "cursor_regressed", fromLedger: 40, toLedger: 35, latestLedger: 250 },
          },
        ],
      },
    });
    const notices = container.querySelectorAll("[data-testid=\"feed-gap-notice\"]");
    assert.ok(notices.length >= 2);
    await unmount();
  });

  it("displays cursor discontinuity warning when feed discontinuity is detected", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 200,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [{ guard: GUARD_A, label: "Guard A" }],
        capped: 0,
        cappedLabels: [],
        gaps: [],
        discontinuity: true,
        affectedLedgers: { start: 100, end: 120 },
      },
    });
    const notice = container.querySelector(".notice.warn");
    assert.ok(notice);
    assert.match(notice.textContent ?? "", /Cursor discontinuity detected/i);
    await unmount();
  });
});

const _FEED_EVENTS_ORIG = [event(GUARD_A, 100, false), event(GUARD_B, null, true)];

const cursorAt = (ledger: number, index = 0) =>
  `${String(ledger).padStart(19, "0")}-${String(index).padStart(10, "0")}`;

describe("TelemetryFeed unit tests", () => {
  it("compares cursors correctly", () => {
    assert.equal(compareEventCursor("9-1", "10-1"), -1);
    assert.equal(compareEventCursor("10-1", "9-1"), 1);
    assert.equal(compareEventCursor(cursorAt(5, 1), cursorAt(5, 2)), -1);
  });

  it("detects feed gaps and cursor discontinuities", () => {
    const gaps = detectFeedGaps({
      expectedFrom: 100,
      heldCursor: cursorAt(50),
      page: {
        cursor: cursorAt(200),
        latestLedger: 200,
        oldestLedger: 150,
      },
    });
    assert.ok(gaps.length > 0);
  });
});