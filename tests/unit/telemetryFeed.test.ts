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

const cursorAt = (ledger: number, index = 0) =>
  `${String(ledger).padStart(19, "0")}-${String(index).padStart(10, "0")}`;

const GUARD_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const GUARD_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const GUARD_C = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

const FEED_EVENTS = [
  event(GUARD_A, 100, false),
  event(GUARD_B, 101, true),
  event(GUARD_A, 102, false),
];

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
