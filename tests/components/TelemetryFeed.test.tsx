import assert from "node:assert/strict";
import { test, before, afterEach, describe } from "node:test";
import { installDom, loadReact } from "../unit/domHarness.ts";
import { TelemetryFeed } from "../../components/TelemetryFeed.tsx";
import type { GuardEvent, GuardContextValue } from "stellar-agent-guard-sdk";
import { GuardContext } from "../../components/GuardProvider.tsx";

describe("TelemetryFeed", () => {
  let dom: ReturnType<typeof installDom>;
  let React: Awaited<ReturnType<typeof loadReact>>["react"];
  let createRoot: Awaited<ReturnType<typeof loadReact>>["createRoot"];
  let act: Awaited<ReturnType<typeof loadReact>>["act"];
  let root: ReturnType<typeof createRoot> | null = null;

  // Mock localStorage for density store
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string): string | null => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      }
    };
  })();

  before(async () => {
    dom = installDom();
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    const reactDeps = await loadReact();
    React = reactDeps.react;
    createRoot = reactDeps.createRoot;
    act = reactDeps.act;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = null;
    }
    document.body.innerHTML = "";
    localStorageMock.clear();
  });

  function createMockGuardContextValue(overrides: Partial<any> = {}): any {
    const defaults: any = {
      server: {} as any,
      guard: "test_guard",
      startWatching: () => {},
      stopWatching: () => {},
      clearEvents: () => {},
      pushEvents: () => {},
    };
    return { ...defaults, ...overrides };
  }

  test("renders initial state with no events", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    const mockValue = createMockGuardContextValue({
      events: [],
      feed: {
        watching: false,
        latestLedger: null,
        error: null,
        lastPolledAt: null,
      },
    });

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockValue },
          React.createElement(TelemetryFeed)
        )
      );
    });

    // Check that it renders correctly
    assert.dom(document.body).containsText("Telemetry");
    assert.dom(document.body).containsText("Start watching");
    assert.dom(document.body).containsText("Clear");
    assert.dom(document.body).containsText("Refused decisions cannot reach this feed from the ledger");
    assert.dom(document.body).containsText("No events from this guard yet. Lifecycle events (policy set, frozen, heartbeat) and allowed decisions appear here as they settle.");
    assert.dom(document.body).doesNotContainText("Stop"); // Should not show stop button when not watching
  });

  test("renders watching state", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    const mockValue = createMockGuardContextValue({
      events: [],
      feed: {
        watching: true,
        latestLedger: 123456,
        error: null,
        lastPolledAt: new Date().toISOString(),
      },
    });

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockValue },
          React.createElement(TelemetryFeed)
        )
      );
    });

    // Check that it renders watching state
    assert.dom(document.body).containsText("Telemetry");
    assert.dom(document.body).containsText("Stop"); // Should show stop button when watching
    assert.dom(document.body).doesNotContainText("Start watching"); // Should not show start button when watching
    assert.dom(document.body).containsText("ledger 123456");
    assert.dom(document.body).containsText("Last poll");
  });

  test("renders events table with data", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    // Mock guard events
    const mockEvents: GuardEvent[] = [
      {
        kind: "heartbeat",
        topic: "heartbeat",
        source: "ledger",
        transactionHash: "abc123",
        ledger: 100000,
        decision: {
          result: "allowed",
        },
        data: {},
      },
      {
        kind: "frozen",
        topic: "frozen",
        source: "ledger",
        transactionHash: "def456",
        ledger: 100001,
        decision: {
          result: "blocked",
          reason: "not_authorized",
        },
        data: {},
      },
    ];

    const mockValue = createMockGuardContextValue({
      events: mockEvents,
      feed: {
        watching: true,
        latestLedger: 100001,
        error: null,
        lastPolledAt: new Date().toISOString(),
      },
    });

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockValue },
          React.createElement(TelemetryFeed)
        )
      );
    });

    // Check that it renders events table
    assert.dom(document.body).containsText("Telemetry");
    assert.dom(document.body).containsText("Authorization decision");
    assert.dom(document.body).containsText("Agent heartbeat");
    assert.dom(document.body).containsText("Admin freeze");
    assert.dom(document.body).containsText("Allowed");
    assert.dom(document.body).containsText("Blocked");
    assert.dom(document.body).containsText("ledger");
    assert.dom(document.body).containsText("100000");
    assert.dom(document.body).containsText("100001");
    assert.dom(document.body).containsText("Transaction");
    assert.dom(document.body).containsText("Source");
    // Note: Diagnostic source would show as "diagnostic" but we're not testing the exact styling
  });

  test("shows clear button when events exist", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    // Mock guard events
    const mockEvents: GuardEvent[] = [
      {
        kind: "heartbeat",
        topic: "heartbeat",
        source: "ledger",
        transactionHash: "abc123",
        ledger: 100000,
        decision: {
          result: "allowed",
        },
        data: {},
      },
    ];

    const mockValue = createMockGuardContextValue({
      events: mockEvents,
      feed: {
        watching: false,
        latestLedger: 100000,
        error: null,
        lastPolledAt: null,
      },
    });

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockValue },
          React.createElement(TelemetryFeed)
        )
      );
    });

    // Check that clear button exists and is enabled
    const clearButton = document.querySelector('button:has-text("Clear")') as HTMLButtonElement | null;
    assert.ok(clearButton, "Clear button should exist");
    assert.strictEqual(clearButton?.disabled, false, "Clear button should be enabled when events exist");
  });

  test("hides clear button when no events", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    const mockValue = createMockGuardContextValue({
      events: [],
      feed: {
        watching: false,
        latestLedger: null,
        error: null,
        lastPolledAt: null,
      },
    });

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockValue },
          React.createElement(TelemetryFeed)
        )
      );
    });

    // Check that clear button exists but is disabled
    const clearButton = document.querySelector('button:has-text("Clear")') as HTMLButtonElement | null;
    assert.ok(clearButton, "Clear button should exist");
    assert.strictEqual(clearButton?.disabled, true, "Clear button should be disabled when no events exist");
  });

  test("shows error state", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    const mockValue = createMockGuardContextValue({
      events: [],
      feed: {
        watching: false,
        latestLedger: null,
        error: "Failed to connect to RPC",
        lastPolledAt: null,
      },
    });

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockValue },
          React.createElement(TelemetryFeed)
        )
      );
    });

    // Check that it shows error state
    assert.dom(document.body).containsText("Telemetry");
    assert.dom(document.body).containsText("The event feed could not poll");
    assert.dom(document.body).containsText("Failed to connect to RPC");
  });
});