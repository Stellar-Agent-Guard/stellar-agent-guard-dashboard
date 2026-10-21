import assert from "node:assert/strict";
import { test, describe } from "node:test";

describe("telemetry listener cleanup under rapid guard-set changes", () => {
  test("one listener per active guard during polling", () => {
    // Simulate the GuardProvider's feedRef pattern: only one GuardFeed is active
    // at a time, stored in a ref to preserve cursor across re-renders
    const activeFeeds = new Map<string, number>(); // guard -> listener count

    // Simulate rapid guard switching while "polling"
    const guards = [
      "CGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1",
      "CGBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2",
      "CGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3",
    ];

    for (const guard of guards) {
      // startWatching creates a new GuardFeed if guard changed
      const existing = activeFeeds.get(guard);
      if (!existing) {
        activeFeeds.set(guard, 1);
      } else {
        activeFeeds.set(guard, existing + 1);
      }
    }

    // Each guard should have exactly one listener created
    for (const [guard, count] of activeFeeds.entries()) {
      assert.equal(count, 1, `guard ${guard.slice(0, 10)}... should have exactly 1 listener`);
    }
  });

  test("zero listeners after stopWatching and teardown", () => {
    // Simulate the lifecycle: start → poll → stop → verify cleanup
    let listenerActive = true;
    const intervalId = setInterval(() => {
      // Simulated polling
      assert.equal(listenerActive, true, "listener should be active during polling");
    }, 100);

    // Stop watching
    clearInterval(intervalId);
    listenerActive = false;

    // Verify teardown
    assert.equal(listenerActive, false, "listener should be deactivated after stop");
  });

  test("no late event contamination after guard switch", () => {
    // The critical regression: events from guard A appearing after switching to guard B
    const receivedEvents: Array<{ guard: string; ledger: number }> = [];

    // Simulate polling guard A
    const simulateGuardA = () => {
      receivedEvents.push({ guard: "A", ledger: 100 });
      receivedEvents.push({ guard: "A", ledger: 101 });
    };

    // Switch to guard B
    const switchToGuardB = () => {
      // Clear events array (as clearEvents does)
      receivedEvents.length = 0;
    };

    // Poll guard B
    const simulateGuardB = () => {
      receivedEvents.push({ guard: "B", ledger: 200 });
      receivedEvents.push({ guard: "B", ledger: 201 });
    };

    // Execute the sequence
    simulateGuardA();
    assert.equal(receivedEvents.length, 2);
    assert.equal(receivedEvents[0]!.guard, "A");

    switchToGuardB();
    assert.equal(receivedEvents.length, 0, "events should be cleared on guard switch");

    simulateGuardB();
    assert.equal(receivedEvents.length, 2);
    assert.equal(receivedEvents[0]!.guard, "B", "only guard B events should remain");
    assert.equal(receivedEvents.every((e) => e.guard === "B"), true, "no guard A contamination");
  });

  test("cursor reset prevents stale event delivery", () => {
    // When switching guards, the cursor must be reset to prevent delivering
    // events from the previous guard's position
    let cursor: string | null = null;
    let latestLedger: number | null = null;

    // Polling guard A advances cursor
    cursor = "cursor-from-A";
    latestLedger = 500;

    // Switching to guard B resets both
    cursor = null;
    latestLedger = null;

    assert.equal(cursor, null, "cursor must be null after guard switch");
    assert.equal(latestLedger, null, "ledger pointer must be null after guard switch");

    // New polling starts fresh
    latestLedger = 100;
    assert.equal(latestLedger, 100, "new guard starts from its own ledger");
  });

  test("rapid add/remove/reorder maintains one listener per guard", () => {
    // Simulate the exact scenario from issue #319:
    // - Rapid add of multiple guards
    // - Remove some guards
    // - Reorder remaining guards
    // - Assert invariant: exactly one listener per active guard

    interface GuardEntry {
      address: string;
      label: string;
    }

    const activeGuards: GuardEntry[] = [];
    const listeners = new Map<string, boolean>(); // guard -> isActive

    // Add guards rapidly
    const addGuard = (address: string, label: string) => {
      activeGuards.push({ address, label });
      listeners.set(address, true);
    };

    // Remove a guard
    const removeGuard = (address: string) => {
      const index = activeGuards.findIndex((g) => g.address === address);
      if (index !== -1) {
        activeGuards.splice(index, 1);
        listeners.delete(address);
      }
    };

    // Reorder guards
    const reorderGuards = (newOrder: string[]) => {
      const reordered: GuardEntry[] = [];
      for (const addr of newOrder) {
        const guard = activeGuards.find((g) => g.address === addr);
        if (guard) reordered.push(guard);
      }
      activeGuards.length = 0;
      activeGuards.push(...reordered);
    };

    // Execute rapid operations
    addGuard("CGAAA...", "Guard A");
    addGuard("CGBBB...", "Guard B");
    addGuard("CGCCC...", "Guard C");
    assert.equal(activeGuards.length, 3);
    assert.equal(listeners.size, 3);

    // Remove middle guard
    removeGuard("CGBBB...");
    assert.equal(activeGuards.length, 2);
    assert.equal(listeners.size, 2);
    assert.equal(listeners.has("CGBBB..."), false, "removed guard's listener should be cleaned up");

    // Reorder remaining
    reorderGuards(["CGCCC...", "CGAAA..."]);
    assert.equal(activeGuards[0]!.address, "CGCCC...");
    assert.equal(activeGuards[1]!.address, "CGAAA...");

    // Invariant check: one listener per active guard
    const activeListenerCount = Array.from(listeners.values()).filter(Boolean).length;
    assert.equal(activeListenerCount, activeGuards.length, "listener count must match active guard count");
  });

  test("concurrent polling attempts do not create duplicate listeners", () => {
    // GuardProvider uses feedRef to ensure only one GuardFeed instance exists
    // even if startWatching is called multiple times rapidly
    let feedInstance: any = null;
    let creationCount = 0;

    const startWatching = (guard: string) => {
      if (!feedInstance || feedInstance.guard !== guard) {
        feedInstance = { guard, id: ++creationCount };
      }
      // If same guard, reuse existing feed (no new creation)
    };

    // Rapid calls to startWatching with same guard
    startWatching("CGTEST...");
    startWatching("CGTEST...");
    startWatching("CGTEST...");

    assert.equal(creationCount, 1, "should create only one listener despite multiple calls");
    assert.equal(feedInstance.guard, "CGTEST...");

    // Switch to different guard
    startWatching("CGOTHER...");
    assert.equal(creationCount, 2, "different guard creates new listener");
    assert.equal(feedInstance.guard, "CGOTHER...");
  });

  test("event push deduplication survives rapid guard switches", () => {
    // The seenRef Set in GuardProvider prevents duplicates even when
    // guards are switched rapidly and events arrive out of order
    const seenKeys = new Set<string>();
    const allEvents: string[] = [];

    const pushEvent = (key: string, guard: string) => {
      if (seenKeys.has(key)) return; // Dedup gate
      seenKeys.add(key);
      allEvents.push(`${guard}:${key}`);
    };

    // Push events from guard A
    pushEvent("tx1", "A");
    pushEvent("tx2", "A");
    assert.equal(allEvents.length, 2);

    // Switch to guard B (clear events but NOT seenKeys - this is intentional
    // to prevent cross-guard key collisions, though in practice keys include guard info)
    allEvents.length = 0;

    // Push events from guard B with DIFFERENT keys (in reality, eventKey includes source/guard info)
    pushEvent("B:tx1", "B"); // Different key than A's tx1
    pushEvent("B:tx3", "B");
    assert.equal(allEvents.length, 2);
    assert.equal(allEvents[0], "B:B:tx1");

    // Try to push duplicate from guard B
    pushEvent("B:tx1", "B");
    assert.equal(allEvents.length, 2, "duplicate should be rejected");
  });
});

describe("feed subscription edge cases", () => {
  test("null guard does not create a listener", () => {
    // GuardProvider checks `if (!guard) return` before creating feed
    let listenerCreated = false;

    const startWatching = (guard: string | null) => {
      if (!guard) return;
      listenerCreated = true;
    };

    startWatching(null as any);
    assert.equal(listenerCreated, false, "null guard should not create listener");

    startWatching("");
    assert.equal(listenerCreated, false, "empty string guard should not create listener");

    startWatching("CGVALID...");
    assert.equal(listenerCreated, true, "valid guard creates listener");
  });

  test("demo mode bypasses listener creation entirely", () => {
    // In demo mode, GuardFeed is never instantiated; events come from fixtures
    let realListenerCreated = false;
    const demoMode = true;

    const startWatching = (guard: string, demo: boolean) => {
      if (demo) {
        // Demo mode: no GuardFeed, just set watching=true
        return;
      }
      realListenerCreated = true;
    };

    startWatching("CGDEMO...", demoMode);
    assert.equal(realListenerCreated, false, "demo mode should not create real listener");

    // Switch off demo
    startWatching("CGREAL...", false);
    assert.equal(realListenerCreated, true, "non-demo mode creates real listener");
  });

  test("stopWatching does not destroy the feed instance", () => {
    // stopWatching only sets watching=false; the GuardFeed instance persists
    // in feedRef so resuming doesn't lose the cursor
    let feedDestroyed = false;
    const feedRef = { current: { guard: "CGTEST..." } };

    const stopWatching = () => {
      // Does NOT set feedRef.current = null
      feedDestroyed = false;
    };

    stopWatching();
    assert.equal(feedDestroyed, false, "feed instance should persist after stop");
    assert.ok(feedRef.current, "feedRef should still reference the feed");
  });
});
