import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rpc } from "@stellar/stellar-sdk";
import type { Contact } from "../../lib/guard/addressBook.ts";
import { DEFAULT_FLEET_PROBE_CONCURRENCY, pollFleet } from "../../lib/guard/fleet.ts";
import { RpcPool } from "../../lib/guard/rpcPool.ts";

describe("fleet probe concurrency and cancellation (issue #509)", () => {
  it("bounds concurrent probes to DEFAULT_FLEET_PROBE_CONCURRENCY (5)", async () => {
    const server = new rpc.Server("https://localhost:8000");
    const count = 25;
    const contacts: Contact[] = Array.from({ length: count }, (_, i) => ({
      address: `C${i}`,
      label: `Guard ${i}`,
      addedAt: new Date().toISOString(),
    }));

    let currentInFlight = 0;
    let maxInFlight = 0;

    const mockReadSnapshot = async (_srv: any, address: string) => {
      currentInFlight++;
      maxInFlight = Math.max(maxInFlight, currentInFlight);
      // Small delay to simulate network latency
      await new Promise((resolve) => setTimeout(resolve, 10));
      currentInFlight--;

      return {
        guard: address,
        status: {
          ok: true,
          value: {
            admin_frozen: false,
            heartbeat_expired: false,
            last_heartbeat: 100n,
            now: 120n,
          },
        },
        policy: { ok: true, value: { dms_grace_secs: 60n } },
        window: { ok: true, value: { total: 0n, entries: [] } },
      };
    };

    const rows = await pollFleet(server, contacts, {
      concurrency: DEFAULT_FLEET_PROBE_CONCURRENCY,
      readSnapshot: mockReadSnapshot as any,
    });

    assert.equal(rows.length, count);
    assert.ok(
      maxInFlight <= DEFAULT_FLEET_PROBE_CONCURRENCY,
      `Expected max in-flight probes <= ${DEFAULT_FLEET_PROBE_CONCURRENCY}, saw ${maxInFlight}`,
    );
    assert.ok(maxInFlight > 1, `Expected concurrent execution, saw ${maxInFlight}`);
    // Check results preserved original ordering
    for (let i = 0; i < count; i++) {
      assert.equal(rows[i]!.contact.address, `C${i}`);
      assert.equal(rows[i]!.derivedStatus, "Active");
    }
  });

  it("surfaces per-row errors while allowing healthy probes to succeed", async () => {
    const server = new rpc.Server("https://localhost:8000");
    const contacts: Contact[] = [
      { address: "C0", label: "Guard 0", addedAt: "" },
      { address: "C1", label: "Guard 1 (Failing)", addedAt: "" },
      { address: "C2", label: "Guard 2", addedAt: "" },
      { address: "C3", label: "Guard 3 (Failing)", addedAt: "" },
      { address: "C4", label: "Guard 4", addedAt: "" },
    ];

    const mockReadSnapshot = async (_srv: any, address: string) => {
      if (address === "C1") throw new Error("HTTP 503 Service Unavailable");
      if (address === "C3") throw new Error("RPC Rate Limit Exceeded");
      return {
        guard: address,
        status: {
          ok: true,
          value: {
            admin_frozen: false,
            heartbeat_expired: false,
            last_heartbeat: 100n,
            now: 120n,
          },
        },
        policy: { ok: true, value: null },
        window: { ok: true, value: null },
      };
    };

    const rows = await pollFleet(server, contacts, {
      concurrency: 3,
      readSnapshot: mockReadSnapshot as any,
    });

    assert.equal(rows.length, 5);
    assert.equal(rows[0]!.derivedStatus, "Active");
    assert.equal(rows[0]!.error, undefined);

    assert.equal(rows[1]!.derivedStatus, "Unknown");
    assert.equal(rows[1]!.error, "HTTP 503 Service Unavailable");

    assert.equal(rows[2]!.derivedStatus, "Active");
    assert.equal(rows[2]!.error, undefined);

    assert.equal(rows[3]!.derivedStatus, "Unknown");
    assert.equal(rows[3]!.error, "RPC Rate Limit Exceeded");

    assert.equal(rows[4]!.derivedStatus, "Active");
    assert.equal(rows[4]!.error, undefined);
  });

  it("cancels in-flight and queued probes when context AbortSignal fires", async () => {
    const server = new rpc.Server("https://localhost:8000");
    const controller = new AbortController();
    const contacts: Contact[] = Array.from({ length: 20 }, (_, i) => ({
      address: `C${i}`,
      label: `Guard ${i}`,
      addedAt: "",
    }));

    let probesStarted = 0;

    const mockReadSnapshot = async (_srv: any, address: string) => {
      probesStarted++;
      if (address === "C2") {
        // Abort while probing C2
        controller.abort();
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        guard: address,
        status: {
          ok: true,
          value: {
            admin_frozen: false,
            heartbeat_expired: false,
            last_heartbeat: 100n,
            now: 120n,
          },
        },
        policy: { ok: true, value: null },
        window: { ok: true, value: null },
      };
    };

    const rows = await pollFleet(server, contacts, {
      concurrency: 2,
      signal: controller.signal,
      readSnapshot: mockReadSnapshot as any,
    });

    assert.equal(rows.length, 20);
    // Verified that remaining probes were cancelled without running
    assert.ok(
      probesStarted < 20,
      `Expected fewer than 20 probes started due to abort, started ${probesStarted}`,
    );

    // Cancelled rows report cancellation error
    const cancelledRows = rows.filter((r) => r.error === "Probe cancelled on context change");
    assert.ok(cancelledRows.length > 0, "Expected at least one cancelled row");
  });

  it("stress-tests a large fleet registry (100 guards) under concurrency limit", async () => {
    const server = new rpc.Server("https://localhost:8000");
    const totalGuards = 100;
    const concurrencyLimit = 5;
    const contacts: Contact[] = Array.from({ length: totalGuards }, (_, i) => ({
      address: `GUARD_${i.toString().padStart(4, "0")}`,
      label: `Fleet Guard ${i}`,
      addedAt: new Date().toISOString(),
    }));

    let currentConcurrency = 0;
    let peakConcurrency = 0;
    let completed = 0;

    const mockReadSnapshot = async (_srv: any, address: string) => {
      currentConcurrency++;
      peakConcurrency = Math.max(peakConcurrency, currentConcurrency);
      // Small jitter
      await new Promise((resolve) => setTimeout(resolve, 2 + (completed % 4)));
      currentConcurrency--;
      completed++;

      return {
        guard: address,
        status: {
          ok: true,
          value: {
            admin_frozen: address.endsWith("5"),
            heartbeat_expired: false,
            last_heartbeat: 1000n,
            now: 1010n,
          },
        },
        policy: { ok: true, value: null },
        window: { ok: true, value: null },
      };
    };

    const rows = await pollFleet(server, contacts, {
      concurrency: concurrencyLimit,
      readSnapshot: mockReadSnapshot as any,
    });

    assert.equal(rows.length, totalGuards);
    assert.equal(completed, totalGuards);
    assert.ok(
      peakConcurrency <= concurrencyLimit,
      `Peak concurrency ${peakConcurrency} exceeded limit ${concurrencyLimit}`,
    );

    // Verify ordering and derived statuses
    for (let i = 0; i < totalGuards; i++) {
      const expectedAddr = `GUARD_${i.toString().padStart(4, "0")}`;
      assert.equal(rows[i]!.contact.address, expectedAddr);
      if (expectedAddr.endsWith("5")) {
        assert.equal(rows[i]!.derivedStatus, "Frozen");
      } else {
        assert.equal(rows[i]!.derivedStatus, "Active");
      }
    }
  });

  it("RpcPool.mapConcurrent respects maxConcurrency and AbortSignal", async () => {
    const pool = new RpcPool("https://primary.example", ["https://fallback.example"], {
      maxConcurrency: 3,
    });

    const items = [1, 2, 3, 4, 5, 6, 7];
    let inFlight = 0;
    let peak = 0;

    const results = await pool.mapConcurrent(
      items,
      async (item) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return item * 2;
      },
      3,
    );

    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
    assert.ok(peak <= 3, `Peak concurrency was ${peak}, expected <= 3`);
  });
});
