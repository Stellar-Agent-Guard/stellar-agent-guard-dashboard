import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import type { Contact } from "../../lib/guard/addressBook.ts";
import {
  pollFleet,
  getGuardTags,
  setGuardTags,
  getPreferredDisplayName,
  setPreferredDisplayName,
} from "../../lib/guard/fleet.ts";
import { rememberInstance, loadInstances, type GuardInstance } from "../../lib/guard/instance.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import type { rpc } from "@stellar/stellar-sdk";

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

describe("Fleet partial chain failure resilience", () => {
  let fakeStorage: MemoryStorage;
  const mockServer = {} as rpc.Server;

  beforeEach(() => {
    fakeStorage = new MemoryStorage();
  });

  test("injecting per-guard read failures keeps errors strictly row-scoped", async () => {
    const contacts: Contact[] = [
      { address: "CAAAA_HEALTHY_1", label: "Agent Guard Alpha", addedAt: "2026-01-01" },
      { address: "CBBBB_FAILING_2", label: "Agent Guard Beta", addedAt: "2026-01-01" },
      { address: "CCCCC_HEALTHY_3", label: "Agent Guard Gamma", addedAt: "2026-01-01" },
    ];

    // Mock snapshot reader: CBBBB throws RPC failure, others return healthy snapshot
    const mockReadSnapshot = async (_server: rpc.Server, address: string) => {
      if (address === "CBBBB_FAILING_2") {
        throw new Error("RPC network timeout for contract CBBBB_FAILING_2");
      }
      return {
        guard: address,
        status: {
          ok: true,
          value: {
            admin_frozen: false,
            heartbeat_expired: false,
            last_heartbeat: 100n,
            now: 110n,
          },
        },
        policy: { ok: true, value: { dms_grace_secs: 60n, active_from: 50n } },
        window: { ok: true, value: { total: 500n } },
      } as any;
    };

    const results = await pollFleet(mockServer, contacts, mockReadSnapshot, fakeStorage);

    assert.equal(results.length, 3, "All three guards must return a row");

    // Guard 1: Alpha
    assert.equal(results[0]!.contact.address, "CAAAA_HEALTHY_1");
    assert.equal(results[0]!.derivedStatus, "Active");
    assert.equal(results[0]!.error, undefined);
    assert.equal(results[0]!.spend24h, 500n);

    // Guard 2: Beta (failing)
    assert.equal(results[1]!.contact.address, "CBBBB_FAILING_2");
    assert.equal(results[1]!.derivedStatus, "Unknown");
    assert.ok(results[1]!.error?.includes("RPC network timeout"));
    assert.equal(results[1]!.snapshot, null);

    // Guard 3: Gamma (unaffected healthy peer)
    assert.equal(results[2]!.contact.address, "CCCCC_HEALTHY_3");
    assert.equal(results[2]!.derivedStatus, "Active");
    assert.equal(results[2]!.error, undefined);
    assert.equal(results[2]!.spend24h, 500n);
  });

  test("partial failure preserves local operator tags and custom display names", async () => {
    const addressFailing = "CFAIL_GUARD_ADDR";
    const addressHealthy = "COK_GUARD_ADDR";

    // Set up local tags and display names
    setGuardTags(NETWORK.name, addressFailing, ["production", "treasury"], fakeStorage);
    setGuardTags(NETWORK.name, addressHealthy, ["staging"], fakeStorage);
    setPreferredDisplayName(NETWORK.name, addressFailing, "Core Vault Guard", fakeStorage);
    setPreferredDisplayName(NETWORK.name, addressHealthy, "Staging Bot", fakeStorage);

    const contacts: Contact[] = [
      { address: addressFailing, label: "Default Label Fail", addedAt: "2026-01-01" },
      { address: addressHealthy, label: "Default Label OK", addedAt: "2026-01-01" },
    ];

    const mockReadSnapshot = async (_server: rpc.Server, address: string) => {
      if (address === addressFailing) {
        throw new Error("Contract not found on this ledger");
      }
      return {
        guard: address,
        status: {
          ok: true,
          value: { admin_frozen: false, heartbeat_expired: false, last_heartbeat: 0n, now: 0n },
        },
        policy: { ok: false },
        window: { ok: false },
      } as any;
    };

    const results = await pollFleet(mockServer, contacts, mockReadSnapshot, fakeStorage);

    assert.equal(results.length, 2);
    assert.equal(results[0]!.derivedStatus, "Unknown");
    assert.ok(results[0]!.error);

    // Verify local tags were not wiped or altered by the failure
    const tagsFailing = getGuardTags(NETWORK.name, addressFailing, fakeStorage);
    assert.deepEqual(tagsFailing, ["production", "treasury"]);

    const tagsHealthy = getGuardTags(NETWORK.name, addressHealthy, fakeStorage);
    assert.deepEqual(tagsHealthy, ["staging"]);

    // Verify display names were not wiped or altered
    assert.equal(
      getPreferredDisplayName(NETWORK.name, addressFailing, "fallback", fakeStorage),
      "Core Vault Guard",
    );
    assert.equal(
      getPreferredDisplayName(NETWORK.name, addressHealthy, "fallback", fakeStorage),
      "Staging Bot",
    );
  });

  test("retrying a failed row re-executes cleanly without corrupting other rows", async () => {
    let failBeta = true;
    const contacts: Contact[] = [
      { address: "C1111", label: "Guard One", addedAt: "" },
      { address: "C2222", label: "Guard Two", addedAt: "" },
    ];

    const mockReadSnapshot = async (_server: rpc.Server, address: string) => {
      if (address === "C2222" && failBeta) {
        throw new Error("Temporary network glitch");
      }
      return {
        guard: address,
        status: {
          ok: true,
          value: { admin_frozen: false, heartbeat_expired: false, last_heartbeat: 0n, now: 0n },
        },
        policy: { ok: false },
        window: { ok: false },
      } as any;
    };

    const initialResults = await pollFleet(mockServer, contacts, mockReadSnapshot, fakeStorage);
    assert.equal(initialResults[1]!.derivedStatus, "Unknown");
    assert.ok(initialResults[1]!.error);

    // Now simulate network recovery and row retry
    failBeta = false;
    const retriedRow = await initialResults[1]!.retry!();

    assert.equal(retriedRow.contact.address, "C2222");
    assert.equal(retriedRow.derivedStatus, "Active");
    assert.equal(retriedRow.error, undefined);
    assert.ok(retriedRow.snapshot?.status.ok);
  });

  test("network switching preserves stored instance identities and local metadata", () => {
    const validGuard1 = "CDMBPI64FS3RZW6G23NCDPLBY5GTKX7TSVZZSHE6ZQX4XAIV3HCPXUDJ";
    const validGuard2 = "CB2M5YFEI74KVKZVES4UQNY3FLHMYE5R24EY2OSHB5LJH5FI2IJMSP5I";

    rememberInstance(validGuard1, "Mainnet Guard", { network: "testnet", storage: fakeStorage });
    rememberInstance(validGuard2, "Secondary Guard", { network: "testnet", storage: fakeStorage });

    setGuardTags("testnet", validGuard1, ["critical", "ops"], fakeStorage);
    setPreferredDisplayName("testnet", validGuard1, "Primary Sentinel", fakeStorage);

    // Switch network context: load testnet instances
    const loadedTestnet = loadInstances({ network: "testnet", storage: fakeStorage });
    assert.ok(loadedTestnet.some((i) => i.guard === validGuard1));
    assert.ok(loadedTestnet.some((i) => i.guard === validGuard2));

    // Metadata is preserved across network views
    assert.deepEqual(getGuardTags("testnet", validGuard1, fakeStorage), ["critical", "ops"]);
    assert.equal(
      getPreferredDisplayName("testnet", validGuard1, "fallback", fakeStorage),
      "Primary Sentinel",
    );
  });
});
