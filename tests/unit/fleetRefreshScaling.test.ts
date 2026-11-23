/**
 * Fleet refresh time as the registry grows (issue #549).
 *
 * `pollFleet` reads one snapshot per guard, at most `FLEET_POLL_CONCURRENCY`
 * at a time. This benchmark drives it with synthetic registries of growing
 * size and a fake snapshot reader with mixed latency (fast, slow and failing
 * guards), and asserts what an operator and the RPC endpoint care about:
 *
 *   - the number of reads in flight never exceeds the cap, at any size;
 *   - refresh time grows roughly linearly with registry size (it is bounded by
 *     ceil(n / cap) waves of the slowest read), not by an RPC burst;
 *   - every guard gets exactly one row, in registry order, and a failing read
 *     is a row with an error rather than a rejected refresh.
 *
 * Latencies are fixed per guard (deterministic) and short, so the suite runs
 * in about a second; the bounds are generous for a shared CI runner. The
 * expected behaviour is documented in `docs/guides/fleet-refresh.md`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { rpc } from "@stellar/stellar-sdk";
import type { Contact } from "../../lib/guard/addressBook.ts";
import { FLEET_POLL_CONCURRENCY, pollFleet } from "../../lib/guard/fleet.ts";
import type { GuardSnapshot } from "../../lib/guard/guardOps.ts";

const SIZES = [1, 10, 50, 200] as const;
const FAST_MS = 2;
const SLOW_MS = 15;

function contactAt(i: number): Contact {
  return {
    address: `C${String(i).padStart(55, "A")}`,
    label: `Guard ${i}`,
    addedAt: "2026-11-19T00:00:00.000Z",
  };
}

/** Every 5th guard is slow, every 7th fails; the rest answer quickly. */
function latencyOf(i: number): number {
  return i % 5 === 0 ? SLOW_MS : FAST_MS;
}

function snapshotFor(address: string): GuardSnapshot {
  return {
    guard: address,
    fetchedAt: "2026-11-19T00:00:00.000Z",
    status: {
      ok: true,
      value: {
        heartbeat_expired: false,
        admin_frozen: false,
        has_policy: true,
        last_heartbeat: 0n,
        now: 1n,
      },
    },
    policy: { ok: true, value: null },
    window: { ok: true, value: { total: 5n, entries: [] } },
  } as unknown as GuardSnapshot;
}

interface Probe {
  reader: (server: rpc.Server, address: string) => Promise<GuardSnapshot>;
  maxInFlight: () => number;
  calls: () => number;
}

function probeReader(): Probe {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const reader = async (_server: rpc.Server, address: string): Promise<GuardSnapshot> => {
    calls++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    const i = Number(address.slice(1).replace(/^A+/, "") || "0");
    try {
      await new Promise((resolve) => setTimeout(resolve, latencyOf(i)));
      if (i % 7 === 3) throw new Error(`guard ${i} unreachable`);
      return snapshotFor(address);
    } finally {
      inFlight--;
    }
  };
  return { reader, maxInFlight: () => peak, calls: () => calls };
}

const SERVER = {} as rpc.Server;

describe("fleet refresh scaling", () => {
  const timings: Array<{ size: number; ms: number }> = [];

  for (const size of SIZES) {
    test(`a registry of ${size} stays within the concurrency cap`, async () => {
      const contacts = Array.from({ length: size }, (_, i) => contactAt(i + 1));
      const probe = probeReader();
      const started = performance.now();
      const rows = await pollFleet(SERVER, contacts, probe.reader);
      const ms = performance.now() - started;
      timings.push({ size, ms });

      assert.equal(rows.length, size);
      assert.equal(probe.calls(), size, "every guard is read exactly once");
      assert.ok(
        probe.maxInFlight() <= FLEET_POLL_CONCURRENCY,
        `peak ${probe.maxInFlight()} reads in flight exceeds the cap of ${FLEET_POLL_CONCURRENCY}`,
      );
      if (size >= FLEET_POLL_CONCURRENCY) {
        assert.equal(probe.maxInFlight(), FLEET_POLL_CONCURRENCY, "the cap is used, not undershot");
      }
      rows.forEach((row, i) => {
        assert.equal(row.contact.address, contacts[i]!.address, "rows stay in registry order");
        const n = i + 1;
        if (n % 7 === 3) {
          assert.equal(row.derivedStatus, "Unknown");
          assert.match(row.error ?? "", /unreachable/);
        } else {
          assert.equal(row.derivedStatus, "Active");
          assert.equal(row.spend24h, 5n);
        }
      });

      // Upper bound: ceil(n / cap) waves of the slowest read, with generous
      // slack for timers and a busy runner.
      const waves = Math.ceil(size / FLEET_POLL_CONCURRENCY);
      assert.ok(
        ms < waves * SLOW_MS * 4 + 250,
        `refreshing ${size} guards took ${ms.toFixed(1)}ms`,
      );
    });
  }

  test("an explicit concurrency is honoured, and 1 reads serially", async () => {
    const contacts = Array.from({ length: 12 }, (_, i) => contactAt(i + 1));
    for (const cap of [1, 3]) {
      const probe = probeReader();
      await pollFleet(SERVER, contacts, probe.reader, cap);
      assert.equal(probe.maxInFlight(), cap);
    }
  });

  test("an empty registry makes no reads", async () => {
    const probe = probeReader();
    assert.deepEqual(await pollFleet(SERVER, [], probe.reader), []);
    assert.equal(probe.calls(), 0);
  });

  test("refresh time grows with size rather than staying flat as a burst would", () => {
    // Reported, then checked loosely: 200 guards take longer than 10.
    const small = timings.find((t) => t.size === 10)?.ms ?? 0;
    const large = timings.find((t) => t.size === 200)?.ms ?? 0;
    console.log(`fleet refresh timings (ms): ${JSON.stringify(timings)}`);
    assert.ok(
      large > small,
      `200 guards (${large.toFixed(1)}ms) should take longer than 10 (${small.toFixed(1)}ms)`,
    );
  });
});
