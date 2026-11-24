import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import {
  acknowledgeAlert,
  unacknowledgeAlert,
  isAlertAcknowledged,
  loadAcknowledgedAlerts,
  clearAcknowledgedAlerts,
  alertEventKey,
  ALERT_ACKS_LIMIT,
} from "../../lib/guard/audioAlert.ts";
import type { GuardEvent } from "stellar-agent-guard-sdk";

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

describe("Alert Operator Acknowledgement State", () => {
  let fakeStorage: MemoryStorage;

  beforeEach(() => {
    fakeStorage = new MemoryStorage();
  });

  const sampleEvent1: GuardEvent = {
    id: "tx-123:auth_checked",
    kind: "auth_checked",
    topic: "auth_checked",
    source: "diagnostic",
    decision: { result: "blocked", reason: "unauthorized" },
    contractId: "CGUARD_VAULT",
  } as any;

  const sampleEvent2: GuardEvent = {
    id: "tx-456:frozen",
    kind: "frozen",
    topic: "frozen",
    source: "ledger",
    contractId: "CGUARD_VAULT",
  } as any;

  test("allows local acknowledgement per alert identity and checks state", () => {
    const key1 = alertEventKey(sampleEvent1);
    const key2 = alertEventKey(sampleEvent2);

    assert.equal(isAlertAcknowledged(key1, fakeStorage), false);
    assert.equal(isAlertAcknowledged(key2, fakeStorage), false);

    acknowledgeAlert(key1, { reason: "blocked", guard: "CGUARD_VAULT" }, fakeStorage);

    assert.equal(isAlertAcknowledged(key1, fakeStorage), true);
    assert.equal(
      isAlertAcknowledged(key2, fakeStorage),
      false,
      "Peer alert remains unacknowledged",
    );

    const acks = loadAcknowledgedAlerts(fakeStorage);
    const item1 = acks.get(key1);
    assert.ok(item1);
    assert.equal(item1.reason, "blocked");
    assert.equal(item1.guard, "CGUARD_VAULT");
    assert.ok(item1.acknowledgedAt > 0);
  });

  test("retains underlying event completely untouched", () => {
    const key = alertEventKey(sampleEvent1);
    const beforeKind = sampleEvent1.kind;
    const beforeDecision = sampleEvent1.decision?.result;

    acknowledgeAlert(key, { reason: "blocked" }, fakeStorage);

    assert.equal(sampleEvent1.kind, beforeKind, "Underlying event kind must remain untouched");
    assert.equal(
      sampleEvent1.decision?.result,
      beforeDecision,
      "Underlying event decision must remain untouched",
    );
  });

  test("unacknowledgeAlert removes acknowledgement", () => {
    const key = alertEventKey(sampleEvent1);
    acknowledgeAlert(key, { reason: "blocked" }, fakeStorage);
    assert.equal(isAlertAcknowledged(key, fakeStorage), true);

    unacknowledgeAlert(key, fakeStorage);
    assert.equal(isAlertAcknowledged(key, fakeStorage), false);
  });

  test("clearAcknowledgedAlerts clears all acknowledgements", () => {
    const key1 = alertEventKey(sampleEvent1);
    const key2 = alertEventKey(sampleEvent2);

    acknowledgeAlert(key1, { reason: "blocked" }, fakeStorage);
    acknowledgeAlert(key2, { reason: "frozen" }, fakeStorage);

    assert.equal(loadAcknowledgedAlerts(fakeStorage).size, 2);

    clearAcknowledgedAlerts(fakeStorage);
    assert.equal(loadAcknowledgedAlerts(fakeStorage).size, 0);
    assert.equal(isAlertAcknowledged(key1, fakeStorage), false);
    assert.equal(isAlertAcknowledged(key2, fakeStorage), false);
  });

  test("caps acknowledgement storage at ALERT_ACKS_LIMIT", () => {
    for (let i = 0; i < ALERT_ACKS_LIMIT + 50; i++) {
      acknowledgeAlert(`alert-key-${i}`, { reason: "blocked" }, fakeStorage);
    }

    const acks = loadAcknowledgedAlerts(fakeStorage);
    assert.equal(acks.size, ALERT_ACKS_LIMIT);
    // Oldest should have been evicted
    assert.equal(isAlertAcknowledged("alert-key-0", fakeStorage), false);
    assert.equal(isAlertAcknowledged(`alert-key-${ALERT_ACKS_LIMIT + 49}`, fakeStorage), true);
  });
});
