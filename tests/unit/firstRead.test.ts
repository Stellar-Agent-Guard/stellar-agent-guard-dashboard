/**
 * First-read verification before deployment (issue #522).
 *
 * The checks are read-only and independent: each settles on its own, a missing
 * wallet is "skipped" rather than a failure, and nothing in them can reach a
 * signing method. The component is rendered to prove the same through the UI.
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { runFirstReadChecks, type FirstReadServer } from "../../lib/guard/firstRead.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import { GuardContext } from "../../components/GuardProvider.tsx";
import { FirstReadCheck } from "../../components/FirstReadCheck.tsx";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;
let root: ReturnType<typeof createRoot> | null = null;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  document.body.innerHTML = "";
});

const ADDRESS = "GDQAPKMAI3WA6H4TDLAWUM6BCQOB22SCQIQWQMLWAHTDRWOVYCXRCVTK";
const TESTNET = { name: "Testnet", passphrase: "Test SDF Network ; September 2015" };
const WALLET = { address: ADDRESS, networkPassphrase: TESTNET.passphrase, network: "testnet" };

/**
 * A server that answers only the two reads and records every method touched.
 * Any other property access — `sendTransaction`, `simulateTransaction`, … — is
 * recorded too and throws, so a check that reached for a write would fail.
 */
function recordingServer(options: {
  passphrase?: string;
  networkError?: Error;
  accountError?: Error;
}): { server: FirstReadServer; touched: string[] } {
  const touched: string[] = [];
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    getNetwork: async () => {
      if (options.networkError) throw options.networkError;
      return { passphrase: options.passphrase ?? TESTNET.passphrase };
    },
    getAccount: async () => {
      if (options.accountError) throw options.accountError;
      return { sequenceNumber: () => "42" };
    },
  };
  const server = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then") return undefined;
        touched.push(property);
        const handler = handlers[property];
        if (!handler) throw new Error(`first-read checks must not call ${property}`);
        return handler;
      },
    },
  ) as FirstReadServer;
  return { server, touched };
}

function stateOf(outcomes: Awaited<ReturnType<typeof runFirstReadChecks>>) {
  return Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome.state]));
}

describe("runFirstReadChecks", () => {
  test("passes all three with a reachable endpoint, a matching wallet and a funded account", async () => {
    const { server, touched } = recordingServer({});
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: WALLET,
      networkMismatch: null,
    });
    assert.deepEqual(stateOf(outcomes), { endpoint: "pass", wallet: "pass", account: "pass" });
    assert.match(outcomes[2]!.detail, /sequence 42/);
    assert.deepEqual([...new Set(touched)].sort(), ["getAccount", "getNetwork"]);
  });

  test("observer mode: the endpoint is still checked and the wallet checks are skipped, not failed", async () => {
    const { server, touched } = recordingServer({});
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: null,
      networkMismatch: null,
    });
    assert.deepEqual(stateOf(outcomes), {
      endpoint: "pass",
      wallet: "skipped",
      account: "skipped",
    });
    assert.match(outcomes[1]!.detail, /Observing works without one/);
    assert.deepEqual(touched, ["getNetwork"]);
  });

  test("an endpoint on another network fails that check alone", async () => {
    const { server } = recordingServer({
      passphrase: "Public Global Stellar Network ; September 2015",
    });
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: WALLET,
      networkMismatch: null,
    });
    assert.deepEqual(stateOf(outcomes), { endpoint: "fail", wallet: "pass", account: "pass" });
    assert.match(outcomes[0]!.detail, /Public Global Stellar Network/);
  });

  test("an unreachable endpoint does not stop the other checks from answering", async () => {
    const { server } = recordingServer({
      networkError: new Error("fetch failed"),
      accountError: new Error("Account not found: " + ADDRESS),
    });
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: WALLET,
      networkMismatch: null,
    });
    assert.deepEqual(stateOf(outcomes), { endpoint: "fail", wallet: "pass", account: "fail" });
    assert.match(outcomes[0]!.detail, /could not be read: fetch failed/);
    assert.match(outcomes[2]!.detail, /not found on Testnet\. Fund it/);
  });

  test("a wallet refused for being on another network fails the wallet check", async () => {
    const { server } = recordingServer({});
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: null,
      networkMismatch: {
        walletNetwork: "public",
        walletPassphrase: "Public Global Stellar Network ; September 2015",
        targetNetwork: "Testnet",
        targetPassphrase: TESTNET.passphrase,
      },
    });
    assert.equal(stateOf(outcomes).wallet, "fail");
    assert.equal(stateOf(outcomes).account, "skipped");
  });

  test("a wallet whose passphrase differs fails the wallet check", async () => {
    const { server } = recordingServer({});
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: { ...WALLET, networkPassphrase: "Test SDF Future Network ; October 2022" },
      networkMismatch: null,
    });
    assert.equal(stateOf(outcomes).wallet, "fail");
  });

  test("demo mode makes no RPC call", async () => {
    const { server, touched } = recordingServer({});
    const outcomes = await runFirstReadChecks({
      server,
      network: TESTNET,
      wallet: WALLET,
      networkMismatch: null,
      demo: true,
    });
    assert.ok(outcomes.every((outcome) => outcome.state === "skipped"));
    assert.deepEqual(touched, []);
  });
});

describe("FirstReadCheck", () => {
  async function render(server: FirstReadServer, wallet: typeof WALLET | null) {
    let signerCalls = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const value = {
      server,
      wallet: wallet ? { ...wallet, networkPassphrase: NETWORK.passphrase } : null,
      networkMismatch: null,
      signer: () => {
        signerCalls += 1;
        throw new Error("the first-read checks must not ask for a signer");
      },
    };
    await act(async () => {
      root!.render(
        react.createElement(
          GuardContext.Provider,
          { value: value as never },
          react.createElement(FirstReadCheck),
        ),
      );
      await sleep(0);
    });
    return { container, signerCalls: () => signerCalls };
  }

  function runButton(container: HTMLElement): HTMLButtonElement {
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes("Run read-only checks"),
    );
    assert.ok(button);
    return button as HTMLButtonElement;
  }

  test("reads nothing until asked, then shows each outcome on its own", async () => {
    const { server, touched } = recordingServer({ passphrase: NETWORK.passphrase });
    const { container, signerCalls } = await render(server, WALLET);
    assert.deepEqual(touched, [], "no read on mount");
    const states = () =>
      [...container.querySelectorAll("[data-check]")].map((item) => [
        item.getAttribute("data-check"),
        item.getAttribute("data-state"),
      ]);
    assert.deepEqual(states(), [
      ["endpoint", "not-run"],
      ["wallet", "not-run"],
      ["account", "not-run"],
    ]);

    await act(async () => {
      runButton(container).click();
      await sleep(20);
    });
    assert.deepEqual(states(), [
      ["endpoint", "pass"],
      ["wallet", "pass"],
      ["account", "pass"],
    ]);
    assert.equal(signerCalls(), 0);
  });

  test("observer: the checks run without a wallet and nothing is blocked", async () => {
    const { server } = recordingServer({ passphrase: NETWORK.passphrase });
    const { container, signerCalls } = await render(server, null);
    await act(async () => {
      runButton(container).click();
      await sleep(20);
    });
    const wallet = container.querySelector('[data-check="wallet"]');
    assert.equal(wallet?.getAttribute("data-state"), "skipped");
    assert.equal(runButton(container).disabled, false, "the checks can be run again");
    assert.equal(signerCalls(), 0);
  });
});
