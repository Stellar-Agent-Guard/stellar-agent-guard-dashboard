import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { 
  compilePrintReport, 
  compileIncidentSummary, 
  formatIncidentSummary 
} from "../../lib/guard/printReport.ts";

describe("compilePrintReport", () => {
  it("extracts correct fields from snapshot", () => {
    const mockSnapshot = {
      guard: "CABC123...",
      fetchedAt: "2026-09-25",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { 
        ok: true, 
        value: { 
          per_tx_cap: 100n, window_cap: 1000n, window_secs: 60n, assets: ["A1"], recipients: ["R1"], protocols: [],
          paused: false, active_from: 0n, active_until: 0n, allow_any_recipient: false
        }
      },
      window: { ok: true, value: null },
      identity: { ok: true, value: { reportedWasmHash: "hash123", fetchedSha256: "hash123", bytes: 1000 } }
    } as any;

    const report = compilePrintReport(mockSnapshot, "Testnet", "GADMIN...");
    
    assert.equal(report.contractId, "CABC123...");
    assert.equal(report.bytecodeHash, "hash123");
    assert.equal(report.adminKey, "GADMIN...");
    assert.equal(report.network, "Testnet");
    assert.equal(report.dmsStatus, "OK");
    assert.equal(report.allowlists.assets[0], "A1");
  });
});

describe("compileIncidentSummary", () => {
  it("includes capture time, network, and guard address", () => {
    const mockSnapshot = {
      guard: "CDEF456...",
      fetchedAt: "2026-10-21T10:00:00Z",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: true, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Public");
    
    assert.ok(summary.captureTime);
    assert.equal(summary.network, "Public");
    assert.equal(summary.guardAddress, "CDEF456...");
  });

  it("shows frozen status when admin_frozen is true", () => {
    const mockSnapshot = {
      guard: "GUARD1...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: true, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet");
    assert.equal(summary.freezeStatus, "frozen");
  });

  it("shows unfrozen status when admin_frozen is false", () => {
    const mockSnapshot = {
      guard: "GUARD2...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet");
    assert.equal(summary.freezeStatus, "unfrozen");
  });

  it("shows unknown status when snapshot is null", () => {
    const summary = compileIncidentSummary(null, "Testnet");
    assert.equal(summary.freezeStatus, "unknown");
    assert.equal(summary.guardAddress, "unknown");
  });

  it("includes transaction hash when provided", () => {
    const mockSnapshot = {
      guard: "GUARD3...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet", { txHash: "abc123..." });
    assert.equal(summary.txHash, "abc123...");
  });

  it("excludes transaction hash when not provided", () => {
    const mockSnapshot = {
      guard: "GUARD4...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet");
    assert.equal(summary.txHash, undefined);
  });

  it("records read errors when status read fails", () => {
    const mockSnapshot = {
      guard: "GUARD5...",
      status: { ok: false, error: "RPC timeout" },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet");
    assert.ok(summary.readErrors.some(e => e.includes("RPC timeout")));
  });

  it("records error when snapshot is null with explicit error", () => {
    const summary = compileIncidentSummary(null, "Testnet", { 
      lastReadError: "Connection refused" 
    });
    assert.ok(summary.readErrors.some(e => e.includes("Connection refused")));
  });

  it("uses lastSuccessfulRead when provided", () => {
    const mockSnapshot = {
      guard: "GUARD6...",
      fetchedAt: "2026-10-21T09:00:00Z",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet", {
      lastSuccessfulRead: "2026-10-21T10:30:00Z"
    });
    assert.equal(summary.lastRead, "2026-10-21T10:30:00Z");
  });

  it("labels the summary as client-generated", () => {
    const mockSnapshot = {
      guard: "GUARD7...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet");
    assert.ok(summary.label.includes("CLIENT-GENERATED"));
    assert.ok(summary.label.includes("Not an audit record"));
  });

  it("shows policy installed status without revealing details", () => {
    const mockSnapshotWithPolicy = {
      guard: "GUARD8...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: true, last_heartbeat: 0n } },
      policy: { ok: true, value: { per_tx_cap: 100n } },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const mockSnapshotNoPolicy = {
      guard: "GUARD9...",
      status: { ok: true, value: { heartbeat_expired: false, admin_frozen: false, has_policy: false, last_heartbeat: 0n } },
      policy: { ok: false, error: "not found" },
      window: { ok: true, value: null },
      identity: { ok: true, value: {} }
    } as any;

    const withPolicy = compileIncidentSummary(mockSnapshotWithPolicy, "Testnet");
    const noPolicy = compileIncidentSummary(mockSnapshotNoPolicy, "Testnet");
    
    assert.equal(withPolicy.policyInstalled, true);
    assert.equal(noPolicy.policyInstalled, false);
  });

  it("handles partially unavailable reads gracefully", () => {
    const mockSnapshot = {
      guard: "GUARD10...",
      status: { ok: false, error: "timeout" },
      policy: { ok: true, value: {} },
      window: { ok: true, value: null },
      identity: { ok: false, error: "failed" }
    } as any;

    const summary = compileIncidentSummary(mockSnapshot, "Testnet");
    
    // Should still have guard address even if other reads failed
    assert.equal(summary.guardAddress, "GUARD10...");
    // Should record errors
    assert.ok(summary.readErrors.length > 0);
    // Should show unknown for status that couldn't be read
    assert.equal(summary.freezeStatus, "unknown");
  });
});

describe("formatIncidentSummary", () => {
  it("formats summary as readable text", () => {
    const summary = {
      label: "CLIENT-GENERATED SNAPSHOT — Not an audit record",
      captureTime: "2026-10-21T10:00:00Z",
      network: "Testnet",
      guardAddress: "GUARD...",
      freezeStatus: "frozen" as const,
      dmsStatus: "ok" as const,
      lastRead: "2026-10-21T09:55:00Z",
      txHash: "tx123...",
      policyInstalled: true,
      readErrors: []
    };

    const formatted = formatIncidentSummary(summary);
    
    assert.ok(formatted.includes("INCIDENT HANDOFF SUMMARY"));
    assert.ok(formatted.includes("Testnet"));
    assert.ok(formatted.includes("GUARD..."));
    assert.ok(formatted.includes("FROZEN"));
    assert.ok(formatted.includes("tx123..."));
    assert.ok(formatted.includes("END SNAPSHOT"));
  });

  it("omits transaction hash line when not present", () => {
    const summary = {
      label: "CLIENT-GENERATED SNAPSHOT — Not an audit record",
      captureTime: "2026-10-21T10:00:00Z",
      network: "Testnet",
      guardAddress: "GUARD...",
      freezeStatus: "unfrozen" as const,
      dmsStatus: "ok" as const,
      lastRead: "2026-10-21T09:55:00Z",
      policyInstalled: false,
      readErrors: []
    };

    const formatted = formatIncidentSummary(summary);
    assert.ok(!formatted.includes("Transaction:"));
  });

  it("includes read errors when present", () => {
    const summary = {
      label: "CLIENT-GENERATED SNAPSHOT — Not an audit record",
      captureTime: "2026-10-21T10:00:00Z",
      network: "Testnet",
      guardAddress: "GUARD...",
      freezeStatus: "unknown" as const,
      dmsStatus: "unknown" as const,
      lastRead: "error on last read",
      policyInstalled: false,
      readErrors: ["RPC timeout", "Connection refused"]
    };

    const formatted = formatIncidentSummary(summary);
    assert.ok(formatted.includes("RPC timeout"));
    assert.ok(formatted.includes("Connection refused"));
  });
});
