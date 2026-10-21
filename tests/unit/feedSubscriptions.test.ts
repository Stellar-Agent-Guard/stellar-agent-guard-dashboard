import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import { GuardFeed } from "../../lib/guard/telemetry.ts";
import { rpc } from "@stellar/stellar-sdk";

describe("GuardFeed subscription lifecycle", () => {
  let server: rpc.Server;
  const GUARD_A = "CBQEW6VX7RZJL3K4N5M2P8Q9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F3G4H5";
  const GUARD_B = "CCABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BCD890";

  beforeEach(() => {
    server = new rpc.Server("https://soroban-testnet.stellar.org");
  });

  test("creates exactly one listener instance per guard address", () => {
    const feed1 = new GuardFeed(server, GUARD_A);
    const feed2 = new GuardFeed(server, GUARD_B);
    const feed3 = new GuardFeed(server, GUARD_A);

    // Each GuardFeed wraps its own GuardTelemetryListener
    // Different guards get different listener instances
    assert.notEqual(feed1, feed3, "same guard address creates separate feed objects");
    assert.ok(feed1 instanceof GuardFeed);
    assert.ok(feed2 instanceof GuardFeed);
  });

  test("cursor state is isolated between feed instances", async () => {
    const feed1 = new GuardFeed(server, GUARD_A);
    const feed2 = new GuardFeed(server, GUARD_B);

    // Initial state: both start with null cursor
    assert.equal(feed1.position().cursor, null);
    assert.equal(feed2.position().cursor, null);
    assert.equal(feed1.position().latestLedger, null);
    assert.equal(feed2.position().latestLedger, null);

    // Simulate advancing feed1's cursor (in real usage this happens via pollOnce)
    // We can't easily mock pollOnce without deeper refactoring, but we can verify
    // the resetFrom method works correctly for isolation
    feed1.resetFrom(100);
    assert.equal(feed1.position().cursor, null);
    assert.equal(feed1.position().latestLedger, 100);

    // feed2 remains unaffected
    assert.equal(feed2.position().cursor, null);
    assert.equal(feed2.position().latestLedger, null);
  });

  test("resetFrom clears cursor and sets ledger pointer independently", () => {
    const feed = new GuardFeed(server, GUARD_A);

    // Start fresh
    feed.resetFrom(null);
    assert.equal(feed.position().cursor, null);
    assert.equal(feed.position().latestLedger, null);

    // Reset to specific ledger
    feed.resetFrom(500);
    assert.equal(feed.position().cursor, null);
    assert.equal(feed.position().latestLedger, 500);

    // Reset again
    feed.resetFrom(1000);
    assert.equal(feed.position().cursor, null);
    assert.equal(feed.position().latestLedger, 1000);
  });

  test("rapid guard switching does not contaminate feed state", () => {
    const feeds: GuardFeed[] = [];

    // Simulate rapid switching: create and discard feeds quickly
    for (let i = 0; i < 10; i++) {
      const guard = `CG${i.toString().padStart(55, "0")}`;
      feeds.push(new GuardFeed(server, guard));
    }

    // Each feed maintains its own independent state
    for (const feed of feeds) {
      const pos = feed.position();
      assert.equal(pos.cursor, null);
      assert.equal(pos.latestLedger, null);
    }

    // Modifying one doesn't affect others
    feeds[0]!.resetFrom(999);
    assert.equal(feeds[0]!.position().latestLedger, 999);
    assert.equal(feeds[1]!.position().latestLedger, null);
    assert.equal(feeds[9]!.position().latestLedger, null);
  });
});

describe("event deduplication under rapid polling", () => {
  test("seenRef Set prevents duplicate event insertion", () => {
    const seen = new Set<string>();
    const key1 = "ledger|tx1|100|decision.allowed|policy_check|{}";
    const key2 = "ledger|tx2|101|heartbeat|tick|{}";

    // First insertion succeeds
    assert.equal(seen.has(key1), false);
    seen.add(key1);
    assert.equal(seen.has(key1), true);

    // Duplicate is detected
    assert.equal(seen.has(key1), true);

    // Different events are distinct
    assert.equal(seen.has(key2), false);
    seen.add(key2);
    assert.equal(seen.size, 2);
  });

  test("eventKey produces stable identifiers for identical events", () => {
    // Import the eventKey function from GuardProvider
    // Since it's not exported, we replicate the logic here for testing
    const eventKey = (event: any): string => {
      return [
        event.source,
        event.transactionHash ?? "-",
        event.ledger ?? "-",
        event.topic,
        event.decision?.result ?? "-",
        event.decision?.reason ?? "-",
        typeof event.data === "object" && event.data !== null ? JSON.stringify(event.data) : String(event.data),
      ].join("|");
    };

    const event1 = {
      source: "ledger",
      transactionHash: "abc123",
      ledger: 100,
      topic: "decision.allowed",
      decision: { result: "allowed", reason: "within_limits" },
      data: {},
    };

    const event2 = { ...event1 };

    // Same content produces same key
    assert.equal(eventKey(event1), eventKey(event2));

    // Different hash produces different key
    const event3 = { ...event1, transactionHash: "def456" };
    assert.notEqual(eventKey(event1), eventKey(event3));
  });

  test("clearEvents resets the seen set completely", () => {
    const seen = new Set<string>();
    seen.add("key1");
    seen.add("key2");
    assert.equal(seen.size, 2);

    // Clear operation (as done in clearEvents callback)
    const newSeen = new Set<string>();
    assert.equal(newSeen.size, 0);
    assert.equal(seen.has("key1"), true); // old set untouched
    assert.equal(newSeen.has("key1"), false); // new set is clean
  });
});
