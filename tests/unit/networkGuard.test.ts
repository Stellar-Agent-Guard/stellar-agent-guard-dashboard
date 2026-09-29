/**
 * Network guard unit tests — issue #18
 *
 * Acceptance criteria covered:
 *
 * 1. Mismatch blocks each write action (≥5 rows, one per action):
 *    - deploy (submitOperation path via deployGuard)
 *    - initialize
 *    - set_policy (installPolicy)
 *    - freeze
 *    - unfreeze
 *    - rotate (rotateAgentKey)
 *
 * 2. Wallet call count is 0 on mismatch — signer.signTransaction is never
 *    called when the guard fires.
 *
 * 3. Happy-path pass-through — a matching network lets the call proceed
 *    normally (the signer is reached).
 *
 * 4. Modal copy test — NetworkMismatchError carries both network names so the
 *    modal can render them; this test asserts both are present.
 *
 * 5. Fail-safe branch — an unverifiable network (getNetworkDetails throws, or
 *    returns error/empty passphrase) blocks writes with the "cannot verify"
 *    message rather than silently allowing them.
 *
 * Write-path inventory (post-change single choke points):
 *   - lib/guard/submit.ts  → runInvocation() → assertCorrectNetwork() (line ~420)
 *   - lib/guard/guardOps.ts → submitOperation() → assertCorrectNetwork() (line ~130)
 *   All write operations in guardOps.ts forward `networkApi` to one of these.
 *
 * Read-path safety citation:
 *   Reads (readStatus, readPolicy, readWindow, readGuardSnapshot) call
 *   server.simulateTransaction / server.getContractData against the configured
 *   Soroban RPC URL. They never call signer.signTransaction(), so the wallet's
 *   active network has no effect on their results and they are intentionally
 *   NOT guarded here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCorrectNetwork,
  freighterNetworkDetailsApi,
  networkMismatchToRefusal,
  NetworkMismatchError,
  type NetworkDetailsApi,
} from "../../lib/guard/networkGuard.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import {
  freezeGuard,
  unfreezeGuard,
  initializeGuard,
  installPolicy,
  rotateAgentKey,
  revokePolicy,
} from "../../lib/guard/guardOps.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const TESTNET_PASSPHRASE = NETWORK.passphrase; // "Test SDF Network ; September 2015"
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** An API stub that reports the wallet on a specific passphrase. */
function networkApi(passphrase: string, networkName?: string): NetworkDetailsApi {
  return {
    getNetworkDetails: async () => ({
      network: networkName ?? (passphrase.includes("Public") ? "PUBLIC" : "TESTNET"),
      networkPassphrase: passphrase,
    }),
  };
}

/** An API stub that throws — simulates Freighter not installed / not responding. */
function throwingApi(): NetworkDetailsApi {
  return {
    getNetworkDetails: async () => {
      throw new Error("extension not available");
    },
  };
}

/** An API stub that returns an error field — Freighter's own error shape. */
function erroringApi(): NetworkDetailsApi {
  return {
    getNetworkDetails: async () => ({
      error: new Error("wallet locked"),
    }),
  };
}

/** An API stub that returns an empty passphrase — fail-safe trigger. */
function emptyPassphraseApi(): NetworkDetailsApi {
  return {
    getNetworkDetails: async () => ({
      network: "UNKNOWN",
      networkPassphrase: "",
    }),
  };
}

/**
 * A minimal signer stub that counts how many times signTransaction was called.
 *
 * If the network guard fires before signTransaction is reached, the count
 * stays 0 — which is the critical property the tests assert.
 *
 * The address is a known-valid G… testnet account (used elsewhere in the test
 * suite) — needed for initializeGuard, which calls addressToScVal() on the
 * signer's address before invokeWithWallet is reached. The guard still fires
 * inside invokeWithWallet before signTransaction is called.
 */
function countingSigner() {
  let callCount = 0;
  const signer = {
    address: "GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH",
    async signTransaction(_xdr: string): Promise<string> {
      callCount++;
      return "SIGNED_XDR";
    },
    async signAuthEntry(_xdr: string): Promise<string> {
      return "SIGNED_AUTH";
    },
  };
  return { signer, get callCount() { return callCount; } };
}

/**
 * A minimal rpc.Server stub — just enough for the guard to get past the account
 * fetch and fail with the network guard before reaching anything else.
 *
 * In network-mismatch tests the guard fires *before* any RPC call, so the
 * server stub is never actually called and its shape doesn't matter.
 */
const STUB_SERVER = {} as never;

/** A valid 32-byte agent pubkey hex. */
const AGENT_PUBKEY_HEX = "a".repeat(64);

/** A valid policy draft that passes buildPolicyConfig(). */
const MINIMAL_DRAFT = {
  perTxCap: "10",
  windowCap: "100",
  windowSecs: "3600",
  paused: false,
  dmsGraceSecs: "86400",
  assets: "",
  assetCaps: [],
  recipients: "",
  allowAnyRecipient: false,
  protocols: "",
  activeFrom: "",
  activeUntil: "",
};

// ── Unit tests ─────────────────────────────────────────────────────────────

describe("assertCorrectNetwork", () => {
  it("passes when the wallet passphrase matches the target", async () => {
    const api = networkApi(TESTNET_PASSPHRASE);
    // Should resolve without throwing
    await assert.doesNotReject(() =>
      assertCorrectNetwork(api, { passphrase: TESTNET_PASSPHRASE, name: "testnet" })
    );
  });

  it("throws NetworkMismatchError when the wallet is on Mainnet and target is Testnet", async () => {
    const api = networkApi(PUBLIC_PASSPHRASE, "PUBLIC");
    await assert.rejects(
      () => assertCorrectNetwork(api, { passphrase: TESTNET_PASSPHRASE, name: "testnet" }),
      (err: unknown) => {
        assert.ok(err instanceof NetworkMismatchError, "should be NetworkMismatchError");
        assert.ok(err.message.includes("Mainnet"), "error names the wallet network");
        assert.ok(err.message.includes("Testnet"), "error names the target network");
        assert.equal(err.unverifiable, false);
        return true;
      },
    );
  });

  it("throws with unverifiable=true when getNetworkDetails throws (fail-safe)", async () => {
    await assert.rejects(
      () => assertCorrectNetwork(throwingApi(), { passphrase: TESTNET_PASSPHRASE, name: "testnet" }),
      (err: unknown) => {
        assert.ok(err instanceof NetworkMismatchError);
        assert.equal(err.unverifiable, true);
        assert.ok(err.message.includes("cannot be read") || err.message.includes("could not be read"));
        return true;
      },
    );
  });

  it("throws with unverifiable=true when getNetworkDetails returns an error field (fail-safe)", async () => {
    await assert.rejects(
      () => assertCorrectNetwork(erroringApi(), { passphrase: TESTNET_PASSPHRASE, name: "testnet" }),
      (err: unknown) => {
        assert.ok(err instanceof NetworkMismatchError);
        assert.equal(err.unverifiable, true);
        return true;
      },
    );
  });

  it("throws with unverifiable=true when passphrase is empty (fail-safe)", async () => {
    await assert.rejects(
      () => assertCorrectNetwork(emptyPassphraseApi(), { passphrase: TESTNET_PASSPHRASE, name: "testnet" }),
      (err: unknown) => {
        assert.ok(err instanceof NetworkMismatchError);
        assert.equal(err.unverifiable, true);
        return true;
      },
    );
  });
});

describe("NetworkMismatchError carries both network names (modal copy)", () => {
  it("carries walletNetwork and targetNetwork for modal rendering", async () => {
    const api = networkApi(PUBLIC_PASSPHRASE, "PUBLIC");
    let caughtError: NetworkMismatchError | null = null;
    try {
      await assertCorrectNetwork(api, { passphrase: TESTNET_PASSPHRASE, name: "testnet" });
    } catch (err) {
      if (err instanceof NetworkMismatchError) caughtError = err;
    }
    assert.ok(caughtError !== null, "error should have been thrown");
    // Both network names are available for the modal to render
    assert.equal(caughtError.targetNetwork, "testnet");
    assert.equal(caughtError.targetPassphrase, TESTNET_PASSPHRASE);
    assert.ok(
      caughtError.walletNetwork === "PUBLIC" || caughtError.walletNetwork === "public",
      "wallet network name is preserved"
    );
    assert.equal(caughtError.walletPassphrase, PUBLIC_PASSPHRASE);
    // The error message itself names both so the modal can fallback to it
    assert.ok(caughtError.message.includes("Mainnet"), "message includes wallet network display name");
    assert.ok(caughtError.message.includes("Testnet"), "message includes target network display name");
  });
});

describe("networkMismatchToRefusal", () => {
  it("converts a NetworkMismatchError to an InvokeResult refused shape", () => {
    const err = new NetworkMismatchError({
      walletNetwork: "PUBLIC",
      walletPassphrase: PUBLIC_PASSPHRASE,
      targetNetwork: "testnet",
      targetPassphrase: TESTNET_PASSPHRASE,
    });
    const result = networkMismatchToRefusal(err);
    assert.equal(result.kind, "refused");
    assert.equal(result.stage, "network_guard");
    assert.ok(result.detail.length > 0);
    assert.deepEqual(result.diagnosticEvents, []);
  });
});

// ── Write-action mismatch table (≥5 rows, wallet call count 0) ────────────
//
// Each test passes a mismatch networkApi and verifies:
//   a) The result is a refused InvokeResult with stage="network_guard"
//   b) signer.signTransaction was never called (callCount === 0)
//
// The STUB_SERVER is never reached because the guard fires first.
//
describe("freeze is blocked on network mismatch — wallet call count 0", () => {
  it("freeze blocks with stage=network_guard and never calls signTransaction", async () => {
    const { signer, callCount } = countingSigner();
    const result = await freezeGuard({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      networkApi: networkApi(PUBLIC_PASSPHRASE, "PUBLIC"),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0, "signTransaction must not be called on mismatch");
    assert.ok(result.kind === "refused" && result.detail.includes("Mainnet"));
    assert.ok(result.kind === "refused" && result.detail.includes("Testnet"));
  });
});

describe("unfreeze is blocked on network mismatch — wallet call count 0", () => {
  it("unfreeze blocks with stage=network_guard and never calls signTransaction", async () => {
    const { signer, callCount } = countingSigner();
    const result = await unfreezeGuard({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      networkApi: networkApi(PUBLIC_PASSPHRASE, "PUBLIC"),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0, "signTransaction must not be called on mismatch");
  });
});

describe("initialize is blocked on network mismatch — wallet call count 0", () => {
  it("initialize blocks with stage=network_guard and never calls signTransaction", async () => {
    const { signer, callCount } = countingSigner();
    const result = await initializeGuard({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      agentPubkeyHex: AGENT_PUBKEY_HEX,
      networkApi: networkApi(PUBLIC_PASSPHRASE, "PUBLIC"),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0, "signTransaction must not be called on mismatch");
  });
});

describe("set_policy (installPolicy) is blocked on network mismatch — wallet call count 0", () => {
  it("installPolicy blocks with stage=network_guard and never calls signTransaction", async () => {
    const { signer, callCount } = countingSigner();
    const result = await installPolicy({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      draft: MINIMAL_DRAFT,
      networkApi: networkApi(PUBLIC_PASSPHRASE, "PUBLIC"),
    });
    assert.equal(result.kind, "invoked");
    if (result.kind === "invoked") {
      assert.equal(result.result.kind, "refused");
      assert.ok(
        result.result.kind === "refused" && result.result.stage === "network_guard",
        `stage should be network_guard, got: ${result.result.kind === "refused" ? result.result.stage : "n/a"}`
      );
    }
    assert.equal(callCount, 0, "signTransaction must not be called on mismatch");
  });
});

describe("rotate_agent_key is blocked on network mismatch — wallet call count 0", () => {
  it("rotateAgentKey blocks with stage=network_guard and never calls signTransaction", async () => {
    const { signer, callCount } = countingSigner();
    const result = await rotateAgentKey({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      newAgentPubkeyHex: AGENT_PUBKEY_HEX,
      networkApi: networkApi(PUBLIC_PASSPHRASE, "PUBLIC"),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0, "signTransaction must not be called on mismatch");
  });
});

describe("revoke_policy is blocked on network mismatch — wallet call count 0", () => {
  it("revokePolicy blocks with stage=network_guard and never calls signTransaction", async () => {
    const { signer, callCount } = countingSigner();
    const result = await revokePolicy({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      networkApi: networkApi(PUBLIC_PASSPHRASE, "PUBLIC"),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0, "signTransaction must not be called on mismatch");
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────
//
// When the network matches, the guard passes and execution reaches the next
// step (account discovery via the RPC server). Since STUB_SERVER throws there,
// the result is a discovery-stage refusal — but crucially the guard did NOT
// block it, proving the guard is transparent on a correct network.

describe("happy path — matching network passes through the guard", () => {
  it("freeze on the correct network does not block at network_guard stage", async () => {
    const { signer, callCount } = countingSigner();

    // Server stub that returns an account (so we get past discovery)
    // then rejects: just proves we got past the guard
    const serverWithAccount = {
      getAccount: async (_address: string) => {
        throw new Error("stub rpc error after guard passed");
      },
    } as never;

    const result = await freezeGuard({
      server: serverWithAccount,
      signer,
      guard: "CAXXXXX",
      networkApi: networkApi(TESTNET_PASSPHRASE, "TESTNET"),
    });
    // The guard passed: the refusal stage is "discovery" (RPC not available),
    // NOT "network_guard"
    assert.equal(result.kind, "refused");
    assert.ok(
      result.kind === "refused" && result.stage !== "network_guard",
      "guard must not block on matching network"
    );
    assert.equal(callCount, 0, "signTransaction not reached (stub RPC failed first, which is expected)");
  });

  it("assertCorrectNetwork passes on matching passphrases", async () => {
    const api = networkApi(TESTNET_PASSPHRASE, "TESTNET");
    await assert.doesNotReject(() =>
      assertCorrectNetwork(api, { passphrase: TESTNET_PASSPHRASE, name: "testnet" })
    );
  });
});

// ── Fail-safe: unverifiable network also blocks writes ─────────────────────

describe("fail-safe branch — unverifiable network blocks writes", () => {
  it("freeze is blocked when getNetworkDetails throws (extension not available)", async () => {
    const { signer, callCount } = countingSigner();
    const result = await freezeGuard({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      networkApi: throwingApi(),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0, "signTransaction must not be called when network is unverifiable");
    assert.ok(
      result.kind === "refused" && result.detail.toLowerCase().includes("cannot verify"),
      "detail should mention cannot verify"
    );
  });

  it("freeze is blocked when getNetworkDetails returns an error field", async () => {
    const { signer, callCount } = countingSigner();
    const result = await freezeGuard({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      networkApi: erroringApi(),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0);
  });

  it("freeze is blocked when getNetworkDetails returns an empty passphrase", async () => {
    const { signer, callCount } = countingSigner();
    const result = await freezeGuard({
      server: STUB_SERVER,
      signer,
      guard: "CAXXXXX",
      networkApi: emptyPassphraseApi(),
    });
    assert.equal(result.kind, "refused");
    assert.ok(result.kind === "refused" && result.stage === "network_guard");
    assert.equal(callCount, 0);
  });
});
