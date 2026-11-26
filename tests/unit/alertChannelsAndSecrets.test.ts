import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, before, describe, it } from "node:test";
import type { ContextType } from "react";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import { TelemetryAlerts } from "../../components/TelemetryAlerts.tsx";
import { WebhookSettingsModal } from "../../components/WebhookSettings.tsx";
import { ALERT_SETTINGS_STORAGE_KEY } from "../../lib/guard/audioAlert.ts";
import { buildAlertChannelHealthView } from "../../lib/guard/alertChannelHealth.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import {
  DEFAULT_WEBHOOK_SETTINGS,
  WEBHOOK_SETTINGS_STORAGE_KEY,
  clearLastWebhookDispatch,
  detectWebhookUrlSecretParams,
  dispatchWebhook,
  loadWebhookSettings,
  redactWebhookUrl,
  saveWebhookSettings,
  validateWebhookUrl,
  buildWebhookPayload,
} from "../../lib/guard/webhookDispatcher.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";

installDom();

type GuardContextValue = NonNullable<ContextType<typeof GuardContext>>;

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearLastWebhookDispatch();
  delete (window as unknown as { Notification?: unknown }).Notification;
});

function blockedEvent(ledger = 100): GuardEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: "event_auth_checked",
    source: "ledger",
    contractId: GUARD,
    ledger,
    ledgerClosedAt: "2026-09-25T12:00:00.000Z",
    transactionHash: String(ledger).padStart(64, "a"),
    decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "ledger" },
    data: {},
  });
}

describe("Issue #497 - prevent secret-bearing query parameters from being stored", () => {
  it("detects likely secret query parameters and Stellar secret seeds without mutating input", () => {
    const secretSeed = `S${"A".repeat(55)}`;
    assert.deepEqual(
      detectWebhookUrlSecretParams("https://hooks.example.com/hook?token=abc123&api_key=xyz"),
      ["token", "api_key"],
    );
    assert.deepEqual(
      detectWebhookUrlSecretParams(`https://hooks.example.com/hook?note=${secretSeed}`),
      ["note"],
    );
    assert.deepEqual(
      detectWebhookUrlSecretParams("https://hooks.example.com/hook?source=dashboard&env=testnet"),
      [],
    );

    const raw = "https://hooks.example.com/hook?token=supersecret123";
    const err = validateWebhookUrl(raw);
    assert.ok(err !== null);
    assert.match(err, /secret-bearing query parameter/i);
    assert.doesNotMatch(err, /supersecret123/);

    const redacted = redactWebhookUrl(raw);
    assert.equal(redacted, "https://hooks.example.com/hook?token=[redacted]");
    assert.doesNotMatch(redacted, /supersecret123/);
  });

  it("refuses to persist secret-bearing query params to storage and never silently rewrites the URL", async () => {
    const dirtyUrl = "https://hooks.example.com/hook?secret=my-secret-value";
    saveWebhookSettings({
      ...DEFAULT_WEBHOOK_SETTINGS,
      enabled: true,
      url: dirtyUrl,
    });
    assert.equal(
      window.localStorage.getItem(WEBHOOK_SETTINGS_STORAGE_KEY),
      null,
      "Secret-bearing webhook URL must not be written to localStorage",
    );

    // Mount WebhookSettingsModal, type secret-bearing URL, verify warning & non-rewriting
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const value = { guard: GUARD } as unknown as GuardContextValue;

    try {
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            { value },
            react.createElement(WebhookSettingsModal, { onClose: () => {} }),
          ),
        );
      });

      const input = container.querySelector<HTMLInputElement>('input[aria-label="Webhook URL"]');
      assert.ok(input);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, dirtyUrl);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      });

      // Destination must not be silently rewritten
      assert.equal(input.value, dirtyUrl);

      const warning = container.querySelector('[data-testid="webhook-url-secret-warning"]');
      assert.ok(warning, "Expected redacted secret warning preview");
      assert.doesNotMatch(warning.textContent ?? "", /my-secret-value/);
      assert.match(warning.textContent ?? "", /\[redacted\]/);

      const saveBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").trim() === "Save",
      );
      assert.ok(saveBtn);
      await act(async () => {
        saveBtn.click();
      });

      assert.equal(loadWebhookSettings().url, "");
    } finally {
      act(() => root.unmount());
    }
  });
});

describe("Issue #498 - verify notification preferences after permission revocation", () => {
  it("reflects external permission revocation from granted to denied without prompting or keeping stale delivery success", async () => {
    let prompts = 0;
    const shownTitles: string[] = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission(): Promise<string> {
        prompts += 1;
        return Promise.resolve(FakeNotification.permission);
      }
      constructor(title: string) {
        shownTitles.push(title);
      }
    }
    (window as unknown as { Notification?: unknown }).Notification = FakeNotification;
    window.localStorage.setItem(
      ALERT_SETTINGS_STORAGE_KEY,
      JSON.stringify({ audio: false, desktop: true, volume: 0.4 }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ctx = {
      guard: GUARD,
      instances: [],
      feed: {
        watching: true,
        latestLedger: 1000,
        error: null,
        lastPolledAt: null,
        guards: [{ guard: GUARD, label: GUARD }],
        capped: 0,
        cappedLabels: [],
      },
    } as unknown as GuardContextValue;

    const renderWith = async (events: GuardEvent[]) => {
      await act(async () => {
        root.render(
          react.createElement(
            GuardContext.Provider,
            { value: ctx },
            react.createElement(
              GuardEventsContext.Provider,
              { value: events },
              react.createElement(TelemetryAlerts),
            ),
          ),
        );
      });
      await act(async () => {
        await sleep(0);
      });
    };

    try {
      await renderWith([blockedEvent(100)]);
      assert.equal(shownTitles.length, 1);
      assert.equal(prompts, 0);
      assert.match(
        container.querySelector('[data-testid="channel-health-browser-status"]')?.textContent ?? "",
        /ready/i,
      );

      // External permission revocation in site settings
      FakeNotification.permission = "denied";
      await renderWith([blockedEvent(101)]);

      assert.equal(prompts, 0, "Revocation must never trigger an automatic re-prompt");
      assert.equal(shownTitles.length, 1, "No notification may be constructed after revocation");
      assert.match(
        container.querySelector('[data-testid="desktop-alert-state"]')?.textContent ?? "",
        /blocked by the browser/i,
      );
      assert.match(
        container.querySelector('[data-testid="channel-health-browser-status"]')?.textContent ?? "",
        /blocked/i,
      );
      // Stale delivery success banner must be cleared
      const deliveryText =
        container.querySelector('[data-testid="notification-delivery"]')?.textContent ?? "";
      assert.doesNotMatch(deliveryText, /delivered/i);

      // Revocation back to "default"
      FakeNotification.permission = "default";
      await renderWith([blockedEvent(102)]);
      assert.equal(prompts, 0);
      assert.match(
        container.querySelector('[data-testid="channel-health-browser-status"]')?.textContent ?? "",
        /needs permission/i,
      );

      // Unsupported Notification API
      delete (window as unknown as { Notification?: unknown }).Notification;
      await renderWith([blockedEvent(103)]);
      assert.equal(prompts, 0);
    } finally {
      act(() => root.unmount());
    }
  });
});

describe("Issue #499 - consolidated alert-channel health view", () => {
  it("reports browser, audio, and webhook readiness independently with explicit failure and recovery", async () => {
    const failedWebhook = await dispatchWebhook(
      buildWebhookPayload({ event: "FREEZE_ACTIVATED", guard: GUARD, network: NETWORK.name }),
      {
        ...DEFAULT_WEBHOOK_SETTINGS,
        enabled: true,
        url: "https://hooks.example.com/alert",
        scopedGuards: { [NETWORK.name.toLowerCase()]: [GUARD] },
      },
      {
        fetch: async () => new Response("Bad Gateway", { status: 502 }),
      },
    );

    const view = buildAlertChannelHealthView({
      desktopEnabled: true,
      permission: "granted",
      lastDelivery: null,
      audioEnabled: true,
      lastPlay: null,
      webhookSettings: {
        ...DEFAULT_WEBHOOK_SETTINGS,
        enabled: true,
        url: "https://hooks.example.com/alert",
        scopedGuards: { [NETWORK.name.toLowerCase()]: [GUARD] },
      },
      network: NETWORK.name,
      lastWebhookDispatch: failedWebhook,
    });

    assert.equal(view.length, 3);
    const browser = view.find((c) => c.channel === "browser");
    const audio = view.find((c) => c.channel === "audio");
    const webhook = view.find((c) => c.channel === "webhook");

    assert.equal(browser?.status, "ready");
    assert.equal(browser?.recovery, null);

    assert.equal(audio?.status, "needs-action");
    assert.match(audio?.recovery ?? "", /Enable chime/i);

    assert.equal(webhook?.status, "failed");
    assert.equal(webhook?.statusLabel, "rejected");
    assert.match(webhook?.detail ?? "", /502/);
    assert.match(webhook?.recovery ?? "", /Test webhook/i);
  });
});

describe("Issue #500 - alert delivery guarantees and non-guarantees documentation", () => {
  it("documents browser lifecycle, permissions, webhook requirements, missed notifications, and verification steps", () => {
    const docPath = path.resolve("docs/screens/telemetry-feed.md");
    const content = fs.readFileSync(docPath, "utf8");
    assert.match(content, /Alert Delivery Guarantees & Non-Guarantees/i);
    assert.match(content, /Browser Lifecycle/i);
    assert.match(content, /Browser Permissions/i);
    assert.match(content, /Webhook Requirements/i);
    assert.match(content, /Operator Verification Steps/i);
  });
});
