/**
 * docs/concepts/wallet-connector-boundary.md must match the connectors (issue #521).
 *
 * The page is a security claim — which provider methods the console calls and
 * where each connector stops — so it is checked against the code rather than
 * trusted: every connector is driven through recording fakes, and the methods
 * it actually calls must equal the methods the page lists for it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  WALLET_PROVIDERS,
  canReconnectSilently,
  createAlbedoConnector,
  createFreighterConnector,
  createXbullConnector,
  type AlbedoProvider,
  type FreighterApiModule,
  type WalletConnector,
  type WalletProviderId,
  type XbullProvider,
} from "../../lib/guard/walletConnector.ts";
import { requestFreighterNetworkSwitch } from "../../lib/guard/networkSwitch.ts";
import { OBSERVER_CAPABILITIES } from "../../lib/guard/observerMode.ts";
import { signingPathsFor, supportLabel } from "../../lib/guard/signingPaths.ts";

const DOC = readFileSync("docs/concepts/wallet-connector-boundary.md", "utf8");
const ADDRESS = "GDQAPKMAI3WA6H4TDLAWUM6BCQOB22SCQIQWQMLWAHTDRWOVYCXRCVTK";
const TESTNET = "Test SDF Network ; September 2015";

interface ConnectorRow {
  name: string;
  kind: string;
  calls: string[];
  silentReconnect: string;
  liveAddress: string;
  networkSwitch: string;
  authEntries: string;
  envelope: string;
}

function tableRows(heading: string): string[][] {
  const start = DOC.indexOf(heading);
  assert.ok(start >= 0, `the page has a "${heading}" table`);
  const lines = DOC.slice(start).split("\n");
  const first = lines.findIndex((line) => line.startsWith("|"));
  const rows: string[][] = [];
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

function connectorRows(): Map<string, ConnectorRow> {
  const rows = new Map<string, ConnectorRow>();
  for (const cells of tableRows("## Connectors")) {
    const [name, kind, calls, silentReconnect, liveAddress, networkSwitch, authEntries, envelope] =
      cells as [string, string, string, string, string, string, string, string];
    rows.set(name, {
      name,
      kind,
      calls: [...calls.matchAll(/`([^`]+)`/g)].map((match) => match[1]!).sort(),
      silentReconnect,
      liveAddress,
      networkSwitch,
      authEntries,
      envelope,
    });
  }
  return rows;
}

/** A provider object that answers everything and records which methods were called. */
function recorder<T extends object>(
  answers: Record<string, unknown>,
): { provider: T; calls: Set<string> } {
  const calls = new Set<string>();
  const provider = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string" || property === "then") return undefined;
        if (!(property in answers)) return undefined;
        return (...args: unknown[]) => {
          calls.add(property);
          const answer = answers[property];
          return Promise.resolve(typeof answer === "function" ? answer(...args) : answer);
        };
      },
    },
  ) as T;
  return { provider, calls };
}

async function exercise(connector: WalletConnector): Promise<void> {
  await connector.connect();
  await connector.getPublicKey();
  await connector.getNetwork();
  await connector.currentAddress?.();
  await connector.signTransaction("AAAA", { networkPassphrase: TESTNET, address: ADDRESS });
  await connector.signAuthEntry("AAAA", { networkPassphrase: TESTNET, address: ADDRESS });
}

async function observedCalls(id: WalletProviderId): Promise<string[]> {
  if (id === "freighter") {
    const { provider, calls } = recorder<FreighterApiModule>({
      requestAccess: { address: ADDRESS },
      getAddress: { address: ADDRESS },
      getNetworkDetails: { network: "TESTNET", networkPassphrase: TESTNET },
      signTransaction: { signedTxXdr: "signed" },
      signAuthEntry: { signedAuthEntry: "entry" },
      requestNetworkAccess: { isChanged: true },
    });
    await exercise(createFreighterConnector(async () => provider));
    await requestFreighterNetworkSwitch({
      api: provider,
      targetPassphrase: TESTNET,
      targetNetwork: "testnet",
    });
    return [...calls].sort();
  }
  if (id === "albedo") {
    const { provider, calls } = recorder<AlbedoProvider>({
      connect: { address: ADDRESS, network: "testnet" },
      network: { network: "testnet", networkPassphrase: TESTNET },
      signedTx: { tx_xdr: "signed" },
      signedAuth: { auth: "entry" },
    });
    await exercise(createAlbedoConnector(provider));
    return [...calls].sort();
  }
  const { provider, calls } = recorder<XbullProvider>({
    connect: { publicKey: ADDRESS, network: "testnet" },
    getPublicKey: ADDRESS,
    getNetwork: "testnet",
    signTransaction: "signed",
    signAuthEntry: "entry",
  });
  await exercise(createXbullConnector(provider));
  return [...calls].sort();
}

describe("wallet connector boundary page", () => {
  const rows = connectorRows();

  test("lists every connector, and only those, with its kind", () => {
    assert.deepEqual(
      [...rows.keys()].sort(),
      WALLET_PROVIDERS.map((provider) => provider.name).sort(),
    );
    for (const descriptor of WALLET_PROVIDERS) {
      assert.equal(rows.get(descriptor.name)?.kind, descriptor.kind, descriptor.name);
    }
  });

  for (const descriptor of WALLET_PROVIDERS) {
    test(`${descriptor.name}: the listed calls are exactly the calls the connector makes`, async () => {
      assert.deepEqual(rows.get(descriptor.name)?.calls, await observedCalls(descriptor.id));
    });

    test(`${descriptor.name}: silent reconnect matches canReconnectSilently`, () => {
      assert.equal(
        rows.get(descriptor.name)?.silentReconnect,
        canReconnectSilently(descriptor.id) ? "yes" : "no",
      );
    });
  }

  test("the live address check column matches which connectors expose currentAddress", () => {
    const freighter = createFreighterConnector(async () => ({}) as FreighterApiModule);
    const albedo = createAlbedoConnector({} as AlbedoProvider);
    const xbullWith = createXbullConnector({
      getPublicKey: async () => ADDRESS,
    } as unknown as XbullProvider);
    const xbullWithout = createXbullConnector({} as XbullProvider);
    assert.equal(rows.get("Freighter")?.liveAddress, freighter.currentAddress ? "yes" : "no");
    assert.equal(rows.get("Albedo")?.liveAddress, albedo.currentAddress ? "yes" : "no");
    assert.ok(xbullWith.currentAddress && !xbullWithout.currentAddress);
    assert.equal(rows.get("xBull")?.liveAddress, "only with `getPublicKey`");
  });

  test("only Freighter offers an in-app network switch", () => {
    assert.equal(rows.get("Freighter")?.networkSwitch, "yes");
    assert.equal(rows.get("Albedo")?.networkSwitch, "no");
    assert.equal(rows.get("xBull")?.networkSwitch, "no");
  });

  test("the signing columns match signingPathsFor", () => {
    const paths = signingPathsFor({
      availableProviders: [],
      currentProvider: null,
      scope: { xbull: { signAuthEntry: async () => "entry" } as unknown as XbullProvider },
    });
    for (const path of paths.filter((candidate) => candidate.kind === "wallet")) {
      const row = rows.get(path.name)!;
      assert.equal(row.envelope, supportLabel(path.steps.transaction.support), path.name);
      if (path.id === "xbull") {
        assert.equal(row.authEntries, "only with `signAuthEntry`");
        const without = signingPathsFor({
          availableProviders: [],
          currentProvider: null,
          scope: { xbull: {} as XbullProvider },
        }).find((candidate) => candidate.id === "xbull")!;
        assert.equal(without.steps["auth-entry"].support, "unsupported");
      } else {
        assert.equal(row.authEntries, supportLabel(path.steps["auth-entry"].support), path.name);
      }
    }
    const external = paths.find((candidate) => candidate.kind === "external")!;
    const [externalRow] = tableRows("## Signing paths and alternatives");
    assert.deepEqual(externalRow, [
      external.name,
      supportLabel(external.steps["auth-entry"].support),
      supportLabel(external.steps.transaction.support),
    ]);
  });

  test("the observer section lists exactly the observer capabilities", () => {
    for (const capability of OBSERVER_CAPABILITIES) {
      assert.ok(DOC.includes(`- ${capability}\n`), `the page lists "${capability}"`);
    }
  });

  test("states the non-custodial boundary for every connector", () => {
    assert.match(DOC, /the operator's\s+wallet holds the key and produces every signature/);
    assert.match(DOC, /never receives, stores or\s+transmits a secret/);
  });
});
