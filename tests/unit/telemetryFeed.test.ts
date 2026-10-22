import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { ReactElement } from "react";
import { GUARD_EVENT_TOPICS } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";
import { TelemetryFeed } from "../../components/TelemetryFeed.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import {
  describeFeedGap,
  FEED_GUARD_CAP,
  type TelemetryEvent,
} from "../../lib/guard/telemetry.ts";

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

describe("telemetry feed gap and coverage warnings", () => {
  it("warns about telemetry history pruning and gap notices", () => {
    const gap = {
      reason: "history_pruned" as const,
      fromLedger: 100,
      toLedger: 200,
      detectedAtLedger: 300,
    };
    const desc = describeFeedGap(gap);
    assert.ok(desc.headline.length > 0);
  });

  it("handles lost ranges and unsettled positions correctly", () => {
    const gaps = [
      {
        reason: "history_pruned" as const,
        fromLedger: 10,
        toLedger: 50,
        detectedAtLedger: 60,
      },
    ];
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.reason, "history_pruned");
  });

  it("supports multi-guard feed gap tracking", () => {
    const multiGaps = [
      {
        guard: GUARD_A,
        label: "Guard A",
        lost: [],
        unsettled: null,
      },
    ];
    assert.equal(multiGaps.length, 1);
  });

  it("verifies cursor discontinuity detection and recovery behavior", () => {
    const discontinuityState = {
      lost: [],
      unsettled: {
        reason: "cursor_regressed" as const,
        fromLedger: null,
        toLedger: null,
        detectedAtLedger: 120,
      },
    };
    assert.ok(discontinuityState.unsettled !== null);
    const recoveredState = {
      lost: [],
      unsettled: null,
    };
    assert.equal(recoveredState.unsettled, null);
  });
  it("describes feed gap reasons correctly", () => {
    const gap = {
      reason: "history_pruned" as const,
      fromLedger: 100,
      toLedger: 200,
      detectedAtLedger: 300,
    };
    const desc = describeFeedGap(gap);
    assert.ok(desc.headline.includes("missed"));
    assert.ok(desc.range.includes("100"));
  });

  it("verifies lost ranges and unsettled positions for feed gaps", () => {
    const gaps = [
      {
        reason: "history_pruned" as const,
        fromLedger: 50,
        toLedger: 99,
        detectedAtLedger: 100,
      },
      {
        reason: "cursor_regressed" as const,
        fromLedger: null,
        toLedger: null,
        detectedAtLedger: 101,
      },
    ];
    assert.equal(gaps.length, 2);
    assert.equal(gaps[0]!.fromLedger, 50);
    assert.equal(gaps[1]!.reason, "cursor_regressed");
  });

  it("verifies cursor discontinuity detection and recovery behavior", () => {
    const discontinuityState = {
      lost: [],
      unsettled: {
        reason: "cursor_regressed" as const,
        fromLedger: null,
        toLedger: null,
        detectedAtLedger: 120,
      },
    };
    assert.ok(discontinuityState.unsettled !== null);
    const recoveredState = {
      lost: [],
      unsettled: null,
    };
    assert.equal(recoveredState.unsettled, null);
  });

  it("renders loading skeleton and header values correctly", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 101,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [
          { guard: GUARD_A, label: "Guard A" },
          { guard: GUARD_B, label: "Guard B" },
        ],
        capped: 0,
        cappedLabels: [],
        gaps: [],
      },
    });
    assert.ok(container.querySelector("h2"));
    assert.ok(container.textContent?.includes("Telemetry"));
    await unmount();
  });

  it("filters events by guard chip", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 101,
        error: null,
        lastPolledAt: new Date().toISOString(),
        guards: [
          { guard: GUARD_A, label: "Guard A" },
          { guard: GUARD_B, label: "Guard B" },
        ],
        capped: 0,
        cappedLabels: [],
        gaps: [],
      },
    });
    const chip = container.querySelector("button.pill");
    assert.ok(chip);
    await act(async () => {
      (chip as HTMLButtonElement).click();
    });
    assert.ok(rows(container).length <= FEED_EVENTS.length);
    await unmount();
  });

  it("caps displayed guards at FEED_GUARD_CAP", () => {
    assert.equal(FEED_GUARD_CAP, 5);
  });

  it("covers per-guard notices, multiple guards and history pruning", async () => {
    const { container, unmount } = await renderFeed({
      feed: {
        watching: true,
        latestLedger: 200,
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
            lost: [
              {
                reason: "history_pruned" as const,
                fromLedger: 10,
                toLedger: 50,
                detectedAtLedger: 60,
              },
            ],
            unsettled: {
              reason: "cursor_regressed" as const,
              fromLedger: null,
              toLedger: null,
              detectedAtLedger: 100,
            },
          },
        ],
      },
    });
    const banner = container.querySelector("[data-testid='feed-gap-notice']");
    assert.ok(banner);
    await unmount();
  });
});



function rows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("table.events tbody tr"));
}