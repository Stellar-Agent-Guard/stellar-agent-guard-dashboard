import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installDom, loadReact } from "./domHarness.ts";
import {
  GuardContext,
  GuardEventsContext,
  type GuardContextValue,
} from "../../components/GuardProvider.tsx";
import { WebhookAlertBridge } from "../../components/WebhookAlertBridge.tsx";
import { NETWORK } from "../../lib/guard/network.ts";
import {
  DEFAULT_WEBHOOK_SETTINGS,
  WEBHOOK_SETTINGS_STORAGE_KEY,
  createWebhookTriggerTracker,
  dispatchWebhook,
  dueWebhookEvents,
  saveWebhookSettings,
  buildWebhookPayload,
  type WebhookSettings,
} from "../../lib/guard/webhookDispatcher.ts";
import type { GuardStatus } from "stellar-agent-guard-sdk";
import type { TelemetryEvent } from "../../lib/guard/telemetry.ts";

const GUARD_A = `C${"A".repeat(55)}`;
const GUARD_B = `C${"B".repeat(55)}`;

const ENDPOINT_A = "https://hooks-a.example.test/alerts";
const ENDPOINT_B = "https://hooks-b.example.test/alerts";
const ENDPOINT_C = "https://hooks-c.example.test/alerts";

function makeStatus(overrides: Partial<GuardStatus> = {}): GuardStatus {
  return {
    admin_frozen: false,
    dms_frozen: false,
    effective_frozen: false,
    last_heartbeat: 1000n,
    now: 1100n,
    heartbeat_expired: false,
    spent_today: 0n,
    tx_count_today: 0,
    ...overrides,
  } as GuardStatus;
}

function makeBlockedEvent(id: string, ledger: number): TelemetryEvent {
  const nowIso = new Date().toISOString();
  return {
    id,
    stream: "committed",
    observedAt: nowIso,
    kind: "auth_checked",
    topic: "event_auth_checked",
    source: "ledger",
    contractId: GUARD_A,
    ledger,
    ledgerClosedAt: nowIso,
    transactionHash: id.padEnd(64, "0"),
    decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "ledger" },
    data: {},
  };
}

function makeGuardContext(status: GuardStatus, guard: string = GUARD_A): GuardContextValue {
  return {
    guard,
    setGuard: () => {},
    instances: [
      { guard, label: "Primary Guard", network: NETWORK.name, addedAt: "", provenance: "test" },
    ],
    activeInstance: {
      guard,
      label: "Primary Guard",
      network: NETWORK.name,
      addedAt: "",
      provenance: "test",
    },
    addInstance: () => {},
    removeInstance: () => {},
    renameInstance: () => {},
    wallet: null,
    connectWallet: async () => {},
    disconnectWallet: () => {},
    snapshot: {
      status: { ok: true, value: status },
      policy: { ok: false, error: "not loaded" },
      history: { ok: true, value: [] },
      fetchedAt: Date.now(),
    },
    refresh: async () => {},
    feed: {
      events: [],
      watching: true,
      error: null,
      guards: [],
      cursor: null,
      lastPolledAt: Date.now(),
      setWatching: () => {},
      addWatchedGuard: () => {},
      removeWatchedGuard: () => {},
    },
  } as unknown as GuardContextValue;
}

function makeSettings(url: string, overrides: Partial<WebhookSettings> = {}): WebhookSettings {
  return {
    ...DEFAULT_WEBHOOK_SETTINGS,
    enabled: true,
    url,
    minIntervalMs: 0,
    blockThreshold: 2,
    blockWindowSecs: 300,
    scopedGuards: { [NETWORK.name.toLowerCase()]: [GUARD_A, GUARD_B] },
    ...overrides,
  };
}

describe("Issue #501 - webhook endpoint changes do not replay old alert events", () => {
  it("does not replay already-delivered alerts when endpoint changes during fixture telemetry, and delivers only new eligible events", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const calls: Array<{ url: string; event: string; guard: string }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, event: body.event, guard: body.guard });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      saveWebhookSettings(makeSettings(ENDPOINT_A));

      // Step 1: Initial fixture telemetry triggers FREEZE_ACTIVATED -> delivered to ENDPOINT_A
      const frozenStatus = makeStatus({ admin_frozen: true });
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            { value: makeGuardContext(frozenStatus, GUARD_A) },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, ENDPOINT_A);
      assert.equal(calls[0]?.event, "FREEZE_ACTIVATED");

      // Step 2: Operator changes webhook endpoint to ENDPOINT_B while fixture telemetry still shows frozen
      await act(async () => {
        saveWebhookSettings(makeSettings(ENDPOINT_B));
      });

      // Re-poll with the same frozen status (and 1 blocked event, below threshold of 2)
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            {
              value: makeGuardContext(
                makeStatus({ admin_frozen: true, last_heartbeat: 1105n }),
                GUARD_A,
              ),
            },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [makeBlockedEvent("a", 1104)] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));

      // Old FREEZE_ACTIVATED must NOT be replayed to ENDPOINT_B
      assert.equal(
        calls.length,
        1,
        "Changing endpoint must not replay previously delivered FREEZE_ACTIVATED",
      );

      // Step 3: New eligible event (BLOCK_THRESHOLD_EXCEEDED: 2 blocked events) arrives on ENDPOINT_B
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            {
              value: makeGuardContext(
                makeStatus({ admin_frozen: true, last_heartbeat: 1110n }),
                GUARD_A,
              ),
            },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [makeBlockedEvent("a", 1104), makeBlockedEvent("b", 1109)] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(
        calls.length,
        2,
        "Only the new eligible event should deliver after endpoint switch",
      );
      assert.equal(calls[1]?.url, ENDPOINT_B);
      assert.equal(calls[1]?.event, "BLOCK_THRESHOLD_EXCEEDED");
    } finally {
      globalThis.fetch = origFetch;
      window.localStorage.removeItem(WEBHOOK_SETTINGS_STORAGE_KEY);
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });

  it("isolates delivery state when endpoint is disabled and re-enabled on a new URL", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const calls: Array<{ url: string; event: string }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, event: body.event });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      saveWebhookSettings(makeSettings(ENDPOINT_A));

      // Trigger FREEZE_ACTIVATED on ENDPOINT_A
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            { value: makeGuardContext(makeStatus({ admin_frozen: true }), GUARD_A) },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(calls.length, 1);

      // Disable webhooks, then re-enable with ENDPOINT_C
      await act(async () => {
        saveWebhookSettings(makeSettings(ENDPOINT_A, { enabled: false }));
      });
      await act(async () => {
        saveWebhookSettings(makeSettings(ENDPOINT_C, { enabled: true }));
      });

      // Re-render with same frozen state
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            {
              value: makeGuardContext(
                makeStatus({ admin_frozen: true, last_heartbeat: 1120n }),
                GUARD_A,
              ),
            },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(
        calls.length,
        1,
        "Re-enabling on ENDPOINT_C must not replay previously seen FREEZE_ACTIVATED",
      );
    } finally {
      globalThis.fetch = origFetch;
      window.localStorage.removeItem(WEBHOOK_SETTINGS_STORAGE_KEY);
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });

  it("keeps trigger tracker state isolated per guard when guard switches", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const calls: Array<{ url: string; event: string; guard: string }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, event: body.event, guard: body.guard });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      saveWebhookSettings(makeSettings(ENDPOINT_A));

      // GUARD_A frozen -> delivered to ENDPOINT_A
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            { value: makeGuardContext(makeStatus({ admin_frozen: true }), GUARD_A) },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.guard, GUARD_A);

      // Switch to GUARD_B which is also frozen, and switch endpoint to ENDPOINT_B
      await act(async () => {
        saveWebhookSettings(makeSettings(ENDPOINT_B));
        root.render(
          react.createElement(
            GuardContext.Provider,
            { value: makeGuardContext(makeStatus({ admin_frozen: true }), GUARD_B) },
            react.createElement(
              GuardEventsContext.Provider,
              { value: [] },
              react.createElement(WebhookAlertBridge),
            ),
          ),
        );
      });
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(calls.length, 2, "New guard's own freeze state must be evaluated independently");
      assert.equal(calls[1]?.url, ENDPOINT_B);
      assert.equal(calls[1]?.guard, GUARD_B);
    } finally {
      globalThis.fetch = origFetch;
      window.localStorage.removeItem(WEBHOOK_SETTINGS_STORAGE_KEY);
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });

  it("handles failed delivery on Endpoint A followed by switch to Endpoint B without replaying stale edge", async () => {
    const tracker = createWebhookTriggerTracker();
    const calls: Array<{ url: string; event: string }> = [];

    const stubFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, event: body.event });
      if (url === ENDPOINT_A) {
        return new Response("Server Error", { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const settingsA = makeSettings(ENDPOINT_A);
    const due1 = dueWebhookEvents({
      settings: settingsA,
      events: ["FREEZE_ACTIVATED"],
      guard: GUARD_A,
      network: NETWORK.name,
      nowMs: 1000,
    });
    const entered1 = tracker.entered(due1);
    assert.deepEqual(entered1, ["FREEZE_ACTIVATED"]);

    const res1 = await dispatchWebhook(
      buildWebhookPayload({ event: "FREEZE_ACTIVATED", guard: GUARD_A, network: NETWORK.name }),
      settingsA,
      { fetch: stubFetch },
    );
    assert.equal(res1.ok, false);
    assert.equal(res1.outcome, "rejected");

    // Switch to ENDPOINT_B; same condition continues
    const settingsB = makeSettings(ENDPOINT_B);
    const due2 = dueWebhookEvents({
      settings: settingsB,
      events: ["FREEZE_ACTIVATED", "BLOCK_THRESHOLD_EXCEEDED"],
      guard: GUARD_A,
      network: NETWORK.name,
      nowMs: 2000,
    });
    const entered2 = tracker.entered(due2);
    assert.deepEqual(entered2, ["BLOCK_THRESHOLD_EXCEEDED"]);

    for (const ev of entered2) {
      const res2 = await dispatchWebhook(
        buildWebhookPayload({ event: ev, guard: GUARD_A, network: NETWORK.name }),
        settingsB,
        { fetch: stubFetch },
      );
      assert.equal(res2.ok, true);
    }

    assert.deepEqual(calls, [
      { url: ENDPOINT_A, event: "FREEZE_ACTIVATED" },
      { url: ENDPOINT_B, event: "BLOCK_THRESHOLD_EXCEEDED" },
    ]);
  });
});
