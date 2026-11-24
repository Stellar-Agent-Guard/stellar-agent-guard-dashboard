import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  groupTelemetryEvents,
  labelForTelemetryKind,
  type TelemetryEvent,
  type TelemetryGrouping,
} from "../../lib/guard/telemetry.ts";

describe("Telemetry Visual Grouping", () => {
  const sampleEvents: TelemetryEvent[] = [
    {
      id: "ev-1",
      kind: "auth_checked",
      topic: "auth_checked",
      source: "ledger",
      contractId: "CGUARD_ALPHA",
      ledger: 100,
      decision: { result: "allowed" },
    } as any,
    {
      id: "ev-2",
      kind: "auth_checked",
      topic: "auth_checked",
      source: "diagnostic",
      contractId: "CGUARD_ALPHA",
      ledger: 101,
      decision: { result: "blocked", reason: "rate_limited" },
    } as any,
    {
      id: "ev-3",
      kind: "heartbeat",
      topic: "heartbeat",
      source: "ledger",
      contractId: "CGUARD_BETA",
      ledger: 102,
    } as any,
    {
      id: "ev-4",
      kind: "frozen",
      topic: "frozen",
      source: "ledger",
      contractId: "CGUARD_ALPHA",
      ledger: 103,
    } as any,
    {
      id: "ev-5",
      kind: "auth_checked",
      topic: "auth_checked",
      source: "ledger",
      contractId: "CGUARD_BETA",
      ledger: 104,
      decision: { result: "allowed" },
    } as any,
  ];

  const chipSources = [
    { guard: "CGUARD_ALPHA", label: "Alpha Sentinel" },
    { guard: "CGUARD_BETA", label: "Beta Sentinel" },
  ];

  test("grouping=none returns a single all-events group in original order", () => {
    const groups = groupTelemetryEvents(sampleEvents, "none");
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.id, "all");
    assert.equal(groups[0]!.count, 5);
    assert.deepEqual(
      groups[0]!.events.map((e) => e.id),
      ["ev-1", "ev-2", "ev-3", "ev-4", "ev-5"],
    );
  });

  test("grouping=kind groups by event kind without dropping events", () => {
    const groups = groupTelemetryEvents(sampleEvents, "kind");
    assert.equal(groups.length, 3); // auth_checked, heartbeat, frozen

    const authGroup = groups.find((g) => g.id === "auth_checked")!;
    assert.ok(authGroup);
    assert.equal(authGroup.label, "Authorization decisions");
    assert.equal(authGroup.count, 3);
    assert.deepEqual(
      authGroup.events.map((e) => e.id),
      ["ev-1", "ev-2", "ev-5"],
    );

    const hbGroup = groups.find((g) => g.id === "heartbeat")!;
    assert.ok(hbGroup);
    assert.equal(hbGroup.label, "Agent heartbeats");
    assert.equal(hbGroup.count, 1);

    const frozenGroup = groups.find((g) => g.id === "frozen")!;
    assert.ok(frozenGroup);
    assert.equal(frozenGroup.label, "Admin freeze");
    assert.equal(frozenGroup.count, 1);

    // Total count preserved
    const totalGrouped = groups.reduce((acc, g) => acc + g.count, 0);
    assert.equal(totalGrouped, sampleEvents.length);
  });

  test("grouping=guard groups events by guard attribution chip", () => {
    const groups = groupTelemetryEvents(sampleEvents, "guard", chipSources);
    assert.equal(groups.length, 2);

    const alphaGroup = groups.find((g) => g.id === "CGUARD_ALPHA")!;
    assert.ok(alphaGroup);
    assert.equal(alphaGroup.label, "Alpha Sentinel");
    assert.equal(alphaGroup.count, 3);

    const betaGroup = groups.find((g) => g.id === "CGUARD_BETA")!;
    assert.ok(betaGroup);
    assert.equal(betaGroup.label, "Beta Sentinel");
    assert.equal(betaGroup.count, 2);
  });

  test("grouping=verdict groups by blocked, allowed, and lifecycle", () => {
    const groups = groupTelemetryEvents(sampleEvents, "verdict");
    assert.equal(groups.length, 3); // allowed, blocked, lifecycle

    const allowed = groups.find((g) => g.id === "allowed")!;
    assert.equal(allowed.label, "Allowed Decisions");
    assert.equal(allowed.count, 2);

    const blocked = groups.find((g) => g.id === "blocked")!;
    assert.equal(blocked.label, "Blocked Decisions");
    assert.equal(blocked.count, 1);

    const lifecycle = groups.find((g) => g.id === "lifecycle")!;
    assert.equal(lifecycle.label, "Lifecycle & Admin Events");
    assert.equal(lifecycle.count, 2); // heartbeat and frozen
  });

  test("preserves export semantics across all grouping modes", () => {
    const modes: TelemetryGrouping[] = ["none", "kind", "guard", "verdict"];
    for (const mode of modes) {
      const groups = groupTelemetryEvents(sampleEvents, mode, chipSources);
      const allEventsInGroups = groups.flatMap((g) => g.events);
      assert.equal(allEventsInGroups.length, sampleEvents.length, `Count must match for ${mode}`);
      // All event IDs present
      const ids = new Set(allEventsInGroups.map((e) => e.id));
      assert.equal(ids.size, sampleEvents.length, `No duplicate or dropped events for ${mode}`);
    }
  });

  test("labelForTelemetryKind handles known and unknown topics", () => {
    assert.equal(labelForTelemetryKind("auth_checked"), "Authorization decisions");
    assert.equal(labelForTelemetryKind("heartbeat"), "Agent heartbeats");
    assert.equal(labelForTelemetryKind("policy_revoked"), "Policy revoked");
    assert.equal(labelForTelemetryKind("custom_unknown_kind"), "custom_unknown_kind");
  });
});
