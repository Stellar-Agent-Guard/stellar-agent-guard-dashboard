import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import {
  WebhookDeliveryTracker,
  clearDeliveryHistory,
  MAX_QUEUE_SIZE,
  EVICTION_AGE_MS,
  WEBHOOK_DELIVERY_STORAGE_KEY,
} from "../../lib/guard/WebhookAlertBridge.tsx";
import {
  saveWebhookSettings,
  loadWebhookSettings,
  DEFAULT_WEBHOOK_SETTINGS,
  type WebhookSettings,
} from "../../lib/guard/webhookDispatcher.ts";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe("Webhook delivery history retention & clear controls", () => {
  let fakeStorage: MemoryStorage;

  beforeEach(() => {
    fakeStorage = new MemoryStorage();
  });

  test("bounds records to MAX_QUEUE_SIZE (50 records)", () => {
    const tracker = new WebhookDeliveryTracker(fakeStorage);
    for (let i = 0; i < MAX_QUEUE_SIZE + 20; i++) {
      tracker.enqueue("https://webhook.site/test", `alert-${i}`, "FREEZE_ACTIVATED");
    }

    const records = tracker.getRecords();
    assert.equal(records.length, MAX_QUEUE_SIZE);
    // Newest should be at index 0
    assert.equal(records[0]!.event, "FREEZE_ACTIVATED");
  });

  test("evicts records older than 24 hours (86,400,000 ms)", () => {
    const tracker = new WebhookDeliveryTracker(fakeStorage);
    const now = Date.now();

    // Enqueue a fresh record
    tracker.enqueue("https://webhook.site/fresh", "fresh-1", "DMS_EXPIRING");

    // Manually inject an expired record into storage (> 24 hours ago)
    const expiredRecord = {
      id: "expired-alert-1",
      url: "https://webhook.site/old",
      status: "delivered",
      timestamp: now - (EVICTION_AGE_MS + 60_000), // 24h + 1m ago
      attempts: 1,
      event: "FREEZE_ACTIVATED",
    };
    const stored = [expiredRecord, ...tracker.getRecords()];
    fakeStorage.setItem(WEBHOOK_DELIVERY_STORAGE_KEY, JSON.stringify(stored));

    // Reload tracker
    const reloaded = new WebhookDeliveryTracker(fakeStorage);
    const validRecords = reloaded.getRecords();

    assert.equal(validRecords.length, 1);
    assert.equal(validRecords[0]!.id.startsWith("fresh-1"), true);
  });

  test("persists delivery status updates in local storage", () => {
    const tracker = new WebhookDeliveryTracker(fakeStorage);
    const rec = tracker.enqueue("https://endpoint.internal/hook", "alert-99", "FREEZE_ACTIVATED");

    tracker.markDelivered(rec.id, 204);

    // Re-instantiate from storage
    const reloaded = new WebhookDeliveryTracker(fakeStorage);
    const found = reloaded.getRecords().find((r) => r.id === rec.id);

    assert.ok(found);
    assert.equal(found.status, "delivered");
    assert.equal(found.statusCode, 204);
  });

  test("clearing delivery history removes local history without altering webhook settings", () => {
    const tracker = new WebhookDeliveryTracker(fakeStorage);

    // Set custom webhook settings
    const customSettings: WebhookSettings = {
      enabled: true,
      url: "https://hooks.slack.com/services/T00/B00/X00",
      secret: "super-secret-hmac-key",
      events: ["FREEZE_ACTIVATED", "DMS_EXPIRING"],
      minIntervalMs: 15_000,
      blockThreshold: 10,
      blockWindowSecs: 600,
    };
    saveWebhookSettings(customSettings, fakeStorage as any);

    // Enqueue some deliveries
    tracker.enqueue(customSettings.url, "alert-1", "FREEZE_ACTIVATED");
    tracker.enqueue(customSettings.url, "alert-2", "DMS_EXPIRING");
    assert.equal(tracker.getRecords().length, 2);

    // Clear delivery history
    tracker.clear();

    // Delivery history is empty in memory and in storage
    assert.equal(tracker.getRecords().length, 0);
    const reloaded = new WebhookDeliveryTracker(fakeStorage);
    assert.equal(reloaded.getRecords().length, 0);

    // Webhook settings are strictly preserved and unchanged!
    const loadedSettings = loadWebhookSettings(fakeStorage as any);
    assert.equal(loadedSettings.enabled, true);
    assert.equal(loadedSettings.url, customSettings.url);
    assert.equal(loadedSettings.secret, customSettings.secret);
    assert.deepEqual(loadedSettings.events, customSettings.events);
    assert.equal(loadedSettings.minIntervalMs, customSettings.minIntervalMs);
    assert.equal(loadedSettings.blockThreshold, customSettings.blockThreshold);
    assert.equal(loadedSettings.blockWindowSecs, customSettings.blockWindowSecs);
  });
});
