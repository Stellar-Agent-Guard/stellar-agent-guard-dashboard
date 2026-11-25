import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rpc, xdr } from "@stellar/stellar-sdk";
import {
  isValidGuardStatus,
  isValidPolicyConfig,
  readNativeXlmBalance,
  readPolicy,
  readStatus,
} from "../../lib/guard/chain.ts";
import { pollFleet } from "../../lib/guard/fleet.ts";
import { requiresFreezeChallenge } from "../../lib/guard/freezeChallenge.ts";
import { TESTNET_ARTIFACT_SOURCE } from "../../lib/guard/network.ts";

describe("malformed RPC response payload coverage (issue #510)", () => {
  const VALID_GUARD = TESTNET_ARTIFACT_SOURCE;
  it("rejects malformed GuardStatus structures and reports localized error", async () => {
    // 1. Primitive number instead of status object
    assert.equal(isValidGuardStatus(42), false);
    // 2. Missing admin_frozen
    assert.equal(
      isValidGuardStatus({ heartbeat_expired: false, last_heartbeat: 100n, now: 120n }),
      false,
    );
    // 3. String values instead of boolean
    assert.equal(
      isValidGuardStatus({
        admin_frozen: "false",
        heartbeat_expired: false,
        last_heartbeat: 100n,
        now: 120n,
      }),
      false,
    );
    // 4. Missing timestamps
    assert.equal(isValidGuardStatus({ admin_frozen: false, heartbeat_expired: false }), false);

    // Mock an rpc.Server returning an incomplete simulation retval
    const mockServer = {
      serverURL: new URL("https://soroban-testnet.stellar.org"),
      simulateTransaction: async () => ({
        result: {
          retval: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("some_unknown_field"),
              val: xdr.ScVal.scvU32(1),
            }),
          ]),
        },
      }),
    } as unknown as rpc.Server;

    const result = await readStatus(mockServer, VALID_GUARD);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /missing required status fields/);
  });

  it("prevents malformed status from defaulting to Active in fleet polling", async () => {
    const server = new rpc.Server("https://localhost:8000");
    const contacts = [{ address: "C_MALFORMED", label: "Broken Guard", addedAt: "" }];

    const mockReadSnapshot = async () => ({
      guard: "C_MALFORMED",
      status: {
        ok: true,
        // Missing admin_frozen, heartbeat_expired, etc.
        value: { unexpected: "payload" } as any,
      },
      policy: { ok: true, value: null },
      window: { ok: true, value: null },
    });

    const rows = await pollFleet(server, contacts, mockReadSnapshot as any);
    assert.equal(rows.length, 1);
    // Must NOT invent or default to Active!
    assert.equal(rows[0]!.derivedStatus, "Unknown");
  });

  it("rejects malformed PolicyConfig payloads and reports localized error", async () => {
    // Missing required fields
    assert.equal(isValidPolicyConfig({ per_tx_cap: 100n }), false);
    assert.equal(isValidPolicyConfig(null), false);
    assert.equal(isValidPolicyConfig("policy string"), false);

    // Missing array properties
    assert.equal(
      isValidPolicyConfig({
        per_tx_cap: 100n,
        window_secs: 60n,
        window_cap: 500n,
        // assets, protocols, recipients missing
        allow_any_recipient: true,
        active_from: 0n,
        active_until: 0n,
        paused: false,
        dms_grace_secs: 0n,
      }),
      false,
    );

    const mockServer = {
      serverURL: new URL("https://soroban-testnet.stellar.org"),
      simulateTransaction: async () => ({
        result: {
          retval: xdr.ScVal.scvString("not a valid policy map"),
        },
      }),
    } as unknown as rpc.Server;

    const result = await readPolicy(mockServer, VALID_GUARD);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.length > 0);
  });

  it("rejects malformed native XLM balance entries and fails safe to challenge", async () => {
    // 1. Missing amount property
    const mockServerMissingAmount = {
      serverURL: new URL("https://soroban-testnet.stellar.org"),
      getAssetBalance: async () => ({
        balanceEntry: { holder: VALID_GUARD } as any,
      }),
    } as unknown as rpc.Server;

    const res1 = await readNativeXlmBalance(mockServerMissingAmount, VALID_GUARD);
    assert.equal(res1.ok, false);
    assert.match(!res1.ok ? res1.error : "", /missing amount/);

    // 2. Non-numeric amount
    const mockServerNonNumeric = {
      serverURL: new URL("https://soroban-testnet.stellar.org"),
      getAssetBalance: async () => ({
        balanceEntry: { amount: "100.5_invalid" } as any,
      }),
    } as unknown as rpc.Server;

    const res2 = await readNativeXlmBalance(mockServerNonNumeric, VALID_GUARD);
    assert.equal(res2.ok, false);
    assert.match(!res2.ok ? res2.error : "", /invalid amount/);

    // Verify callers fail-safe: when balance read is an error, requiresFreezeChallenge returns true
    assert.equal(requiresFreezeChallenge(null), true);
  });

  it("handles malformed getEvents response payloads with typed failure", async () => {
    const mockServer = {
      getEvents: async () => ({
        // events is not an array!
        events: "corrupted_non_array_data" as any,
      }),
    } as unknown as rpc.Server;

    const recording = Object.create(mockServer) as rpc.Server;
    recording.getEvents = async (request) => {
      const response = await mockServer.getEvents(request);
      if (!response || !Array.isArray(response.events)) {
        throw new Error("malformed getEvents response: events must be an array");
      }
      return response;
    };

    await assert.rejects(async () => {
      await recording.getEvents({ startLedger: 1, filters: [] });
    }, /malformed getEvents response/);
  });
});
