import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installDom, loadReact } from "./domHarness.ts";
import { ConfigureNetworkContext } from "../../components/ConfigureNetworkContext.tsx";
import {
  TESTNET,
  rehearseEndpointFailover,
  type FailoverRehearsalResult,
  type ReadOnlyProbeResult,
} from "../../lib/guard/network.ts";
import {
  MIN_HEALTH_OBSERVATION_MS,
  MIN_HEALTH_SAMPLE_COUNT,
  RpcPool,
  assessEndpointHealth,
  formatObservationPeriod,
  type EndpointHealthSample,
} from "../../lib/guard/rpcPool.ts";

describe("Issue #502 - Endpoint identity beside health history", () => {
  it("records safe origin metadata and active network without storing credentials or secret URLs", async () => {
    const pool = new RpcPool(
      "https://ops:super-secret@rpc-alpha.example.test:8443/soroban?apiKey=secret-token-999",
      [],
      "testnet",
    );

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { passphrase: TESTNET.passphrase, protocolVersion: 22 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    await pool.probeEndpoint(undefined, { fetchImpl: fakeFetch });

    const history = pool.getHealthHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0]?.endpointOrigin, "https://rpc-alpha.example.test:8443");
    assert.equal(history[0]?.network, "testnet");
    assert.equal(history[0]?.ok, true);

    const serialized = JSON.stringify(history);
    assert.doesNotMatch(serialized, /super-secret/);
    assert.doesNotMatch(serialized, /secret-token-999/);
    assert.doesNotMatch(serialized, /apiKey/);
  });

  it("distinguishes multiple custom endpoints and isolates samples by active network", () => {
    const pool = new RpcPool("https://rpc-1.example.test", [], "testnet");
    pool.recordHealthSample({ ok: true, latencyMs: 25, recordedAt: 1000 });
    pool.switchEndpoint("https://rpc-2.example.test", { targetNetwork: "testnet" });
    pool.recordHealthSample({ ok: false, latencyMs: 400, failure: "timeout", recordedAt: 2000 });
    pool.switchNetwork("mainnet", "https://rpc-1.example.test");
    pool.recordHealthSample({ ok: true, latencyMs: 40, recordedAt: 3000 });

    const testnetRpc1 = pool.getHealthHistory({
      endpoint: "https://rpc-1.example.test",
      network: "testnet",
    });
    const testnetRpc2 = pool.getHealthHistory({
      endpoint: "https://rpc-2.example.test",
      network: "testnet",
    });
    const mainnetRpc1 = pool.getHealthHistory({
      endpoint: "https://rpc-1.example.test",
      network: "mainnet",
    });

    assert.equal(testnetRpc1.length, 1);
    assert.equal(testnetRpc1[0]?.latencyMs, 25);
    assert.equal(testnetRpc2.length, 1);
    assert.equal(testnetRpc2[0]?.failure, "timeout");
    assert.equal(mainnetRpc1.length, 1);
    assert.equal(mainnetRpc1[0]?.network, "mainnet");
  });
});

describe("Issue #503 - Read-only endpoint failover rehearsal", () => {
  it("probes network identity and bounded reads, shows per-check results, and never promotes or writes", async () => {
    const calledMethods: string[] = [];
    const fakeFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calledMethods.push(body.method);
      if (body.method === "getNetwork") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { passphrase: TESTNET.passphrase, protocolVersion: 22 },
          }),
          { status: 200 },
        );
      }
      if (body.method === "getHealth") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "healthy" } }),
          { status: 200 },
        );
      }
      if (body.method === "getLatestLedger") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sequence: 123456 } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected write or unsupported method: ${body.method}`);
    };

    const pool = new RpcPool(
      "https://primary.example.test",
      ["https://fallback.example.test"],
      "testnet",
    );
    const result = await pool.rehearseFailover(
      "https://user:secret-pass@candidate.example.test/rpc?token=abc",
      {
        expectedPassphrase: TESTNET.passphrase,
        fetchImpl: fakeFetch,
      },
    );

    assert.equal(result.ready, true);
    assert.equal(result.promoted, false);
    assert.equal(result.issuedWrites, false);
    assert.equal(result.candidateOrigin, "https://candidate.example.test");
    assert.equal(result.checks.length, 3);
    assert.ok(result.checks.every((c) => c.ok));
    assert.deepEqual(calledMethods.sort(), ["getHealth", "getLatestLedger", "getNetwork"]);
    assert.doesNotMatch(JSON.stringify(result), /secret-pass|token=abc/);

    // Active endpoint and fallbacks must remain completely unchanged
    assert.equal(pool.currentUrl, "https://primary.example.test");
    assert.deepEqual(pool.fallbackUrls, ["https://fallback.example.test"]);
  });

  it("flags network passphrase mismatch during rehearsal and stays non-promoting", async () => {
    const fakeFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.method === "getNetwork") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              passphrase: "Public Global Stellar Network ; September 2015",
              protocolVersion: 22,
            },
          }),
          { status: 200 },
        );
      }
      if (body.method === "getHealth") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "healthy" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { sequence: 999 } }), {
        status: 200,
      });
    };

    const result = await rehearseEndpointFailover("https://mainnet-candidate.example.test", {
      expectedPassphrase: TESTNET.passphrase,
      fetchImpl: fakeFetch,
    });

    assert.equal(result.ready, false);
    assert.equal(result.promoted, false);
    assert.equal(result.issuedWrites, false);
    const idCheck = result.checks.find((c) => c.check === "network_identity");
    assert.equal(idCheck?.ok, false);
    assert.match(idCheck?.detail ?? "", /Network mismatch/);
  });

  it("handles invalid candidate URLs gracefully without throwing", async () => {
    const result = await rehearseEndpointFailover("not-a-valid-url");
    assert.equal(result.ready, false);
    assert.equal(result.promoted, false);
    assert.equal(result.issuedWrites, false);
    assert.equal(result.candidateOrigin, "unrecognised-endpoint");
    assert.equal(result.checks.length, 3);
    assert.ok(result.checks.every((c) => !c.ok));
  });
});

describe("Issue #504 - Warn when endpoint health history is insufficient", () => {
  it("distinguishes unknown (0 samples) from insufficient and healthy", () => {
    const unknown = assessEndpointHealth([], {
      endpoint: "https://rpc.example.test",
      network: "testnet",
    });
    assert.equal(unknown.quality, "unknown");
    assert.equal(unknown.sufficient, false);
    assert.equal(unknown.sampleCount, 0);
    assert.equal(unknown.observationPeriodMs, 0);
    assert.match(unknown.warning ?? "", /Health unknown/);

    // Short sample (3 samples over 10s) must be insufficient, never healthy
    const shortSamples: EndpointHealthSample[] = [
      {
        endpointOrigin: "https://rpc.example.test",
        network: "testnet",
        recordedAt: 1000,
        ok: true,
        latencyMs: 20,
      },
      {
        endpointOrigin: "https://rpc.example.test",
        network: "testnet",
        recordedAt: 6000,
        ok: true,
        latencyMs: 22,
      },
      {
        endpointOrigin: "https://rpc.example.test",
        network: "testnet",
        recordedAt: 11000,
        ok: true,
        latencyMs: 24,
      },
    ];
    const tooFew = assessEndpointHealth(shortSamples, {
      endpoint: "https://rpc.example.test",
      network: "testnet",
    });
    assert.equal(tooFew.quality, "insufficient");
    assert.equal(tooFew.sufficient, false);
    assert.equal(tooFew.sampleCount, 3);
    assert.equal(tooFew.minSamplesRequired, MIN_HEALTH_SAMPLE_COUNT);
    assert.equal(tooFew.observationPeriodMs, 10_000);
    assert.match(tooFew.warning ?? "", /Insufficient health history/);

    // Enough count (5) but too short an observation window (10s < 60s) -> still insufficient
    const narrowWindow: EndpointHealthSample[] = Array.from({ length: 5 }, (_, idx) => ({
      endpointOrigin: "https://rpc.example.test",
      network: "testnet",
      recordedAt: 1000 + idx * 2000,
      ok: true,
      latencyMs: 20,
    }));
    const shortWindow = assessEndpointHealth(narrowWindow, {
      endpoint: "https://rpc.example.test",
      network: "testnet",
    });
    assert.equal(shortWindow.quality, "insufficient");
    assert.equal(shortWindow.sufficient, false);
    assert.equal(shortWindow.minObservationMs, MIN_HEALTH_OBSERVATION_MS);

    // 5 samples spanning >= 60s -> healthy
    const sufficientSamples: EndpointHealthSample[] = Array.from({ length: 5 }, (_, idx) => ({
      endpointOrigin: "https://rpc.example.test",
      network: "testnet",
      recordedAt: 1000 + idx * 20_000,
      ok: true,
      latencyMs: 30,
    }));
    const healthy = assessEndpointHealth(sufficientSamples, {
      endpoint: "https://rpc.example.test",
      network: "testnet",
    });
    assert.equal(healthy.quality, "healthy");
    assert.equal(healthy.sufficient, true);
    assert.equal(healthy.warning, null);
    assert.equal(healthy.observationPeriodMs, 80_000);
    assert.equal(formatObservationPeriod(80_000), "1m 20s");
  });
});

describe("ConfigureNetworkContext interactive health history & failover rehearsal UI (#502-#504)", () => {
  it("renders endpoint origin beside health history, insufficient warning, and executes read-only rehearsal", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const samples: EndpointHealthSample[] = [
      {
        endpointOrigin: "https://rpc.example.test",
        network: "testnet",
        recordedAt: 1000,
        ok: true,
        latencyMs: 42,
      },
      {
        endpointOrigin: "https://rpc.example.test",
        network: "testnet",
        recordedAt: 16_000,
        ok: true,
        latencyMs: 48,
      },
    ];

    let rehearsedCandidate: string | null = null;
    const mockRehearse = async (candidateUrl: string): Promise<FailoverRehearsalResult> => {
      rehearsedCandidate = candidateUrl;
      return {
        candidateOrigin: "https://alt-rpc.example.test",
        expectedNetwork: "Testnet",
        ready: true,
        promoted: false,
        issuedWrites: false,
        checks: [
          {
            check: "network_identity",
            label: "Network identity (getNetwork)",
            ok: true,
            latencyMs: 25,
            detail: "Verified Testnet (protocol v22)",
          },
          {
            check: "bounded_health_read",
            label: "Bounded health read (getHealth)",
            ok: true,
            latencyMs: 20,
            detail: "Status “healthy” (20 ms)",
          },
          {
            check: "bounded_ledger_read",
            label: "Bounded ledger read (getLatestLedger)",
            ok: true,
            latencyMs: 30,
            detail: "Latest ledger #555 (30 ms)",
          },
        ],
        summary:
          "Candidate https://alt-rpc.example.test passed all 3 read-only checks for Testnet. Active endpoint was not promoted.",
      };
    };

    const mockProbe = async (): Promise<ReadOnlyProbeResult> => ({
      ok: true,
      endpointOrigin: "https://rpc.example.test",
      latencyMs: 33,
      passphrase: TESTNET.passphrase,
      protocolVersion: 22,
      networkName: "Testnet",
    });

    try {
      await act(async () => {
        root.render(
          react.createElement(ConfigureNetworkContext, {
            networkName: "testnet",
            rpcUrl: "https://ops:secret@rpc.example.test/soroban?key=xyz",
            interactive: true,
            healthSamples: samples,
            probeImpl: mockProbe,
            rehearseImpl: mockRehearse,
          }),
        );
      });

      assert.equal(
        container.querySelector('[data-testid="health-history-origin"]')?.textContent,
        "https://rpc.example.test",
      );
      assert.equal(
        container.querySelector('[data-testid="health-history-network"]')?.textContent,
        "testnet",
      );
      assert.equal(
        container.querySelector('[data-testid="health-quality-badge"]')?.textContent,
        "Insufficient evidence",
      );
      assert.match(
        container.querySelector('[data-testid="health-evidence-summary"]')?.textContent ?? "",
        /2\/5 samples · 15s observed/,
      );
      assert.match(
        container.querySelector('[data-testid="health-insufficiency-warning"]')?.textContent ?? "",
        /Insufficient health history/,
      );

      // Run failover rehearsal
      const input = container.querySelector<HTMLInputElement>(
        '[data-testid="rehearsal-candidate-input"]',
      );
      const btn = container.querySelector<HTMLButtonElement>(
        '[data-testid="rehearse-failover-button"]',
      );
      assert.ok(input && btn);

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "https://alt-rpc.example.test");
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      });

      await act(async () => {
        btn.click();
      });

      assert.equal(rehearsedCandidate, "https://alt-rpc.example.test");
      assert.ok(container.querySelector('[data-testid="failover-rehearsal-result"]'));
      assert.match(
        container.querySelector('[data-testid="rehearsal-no-promotion-note"]')?.textContent ?? "",
        /active endpoint was not changed/i,
      );
      assert.ok(container.querySelector('[data-testid="rehearsal-check-network_identity"]'));
      assert.ok(container.querySelector('[data-testid="rehearsal-check-bounded_health_read"]'));
      assert.ok(container.querySelector('[data-testid="rehearsal-check-bounded_ledger_read"]'));
    } finally {
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });
});
