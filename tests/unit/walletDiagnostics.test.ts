import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  WALLET_CAPABILITIES,
  canReadAddressWithoutPrompt,
  collectWalletDiagnostics,
  describeCapabilities,
  limitedCapabilities,
  providerStatuses,
  readAccountSnapshot,
  walletCapabilities,
  type CapabilityRow,
  type ProviderErrorInfo,
} from "../../lib/guard/walletDiagnostics.ts";
import {
  createFreighterConnector,
  type AlbedoProvider,
  type FreighterApiModule,
  type WalletConnector,
  type WalletProviderId,
  type WalletScope,
  type XbullProvider,
} from "../../lib/guard/walletConnector.ts";

/**
 * The wallet diagnostic (issue #342) exists to answer a support question without
 * asking the operator's wallet to do anything. That makes its test surface
 * unusual: half of what is asserted is a *call count*. A provider fake records
 * every method it is asked to run, so "refresh raised no prompt" is a fact about
 * `connect`/`signTransaction` never being called rather than a claim in a comment.
 */

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const ADDRESS = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";

interface CallLog {
  names: string[];
}

function createFakeFreighterApi(
  overrides: Partial<FreighterApiModule> = {},
  log: CallLog = { names: [] },
): FreighterApiModule {
  const record = (name: string) => log.names.push(name);
  const api: FreighterApiModule = {
    requestAccess: async () => {
      record("requestAccess");
      return { address: ADDRESS };
    },
    getAddress: async () => {
      record("getAddress");
      return { address: ADDRESS };
    },
    getNetworkDetails: async () => {
      record("getNetworkDetails");
      return { network: "TESTNET", networkPassphrase: TESTNET_PASSPHRASE };
    },
    signTransaction: async (xdr) => {
      record("signTransaction");
      return { signedTxXdr: `signed(${xdr})` };
    },
    signAuthEntry: async (xdr) => {
      record("signAuthEntry");
      return { signedAuthEntry: `auth(${xdr})` };
    },
    ...overrides,
  };
  return api;
}

function freighterScope(api: FreighterApiModule | null): WalletScope {
  return {
    freighterLoader: api === null ? null : async () => api,
    albedo: null,
    xbull: null,
  };
}

function createFakeXbull(overrides: Partial<XbullProvider> = {}, log: CallLog = { names: [] }) {
  const record = (name: string) => log.names.push(name);
  const provider: XbullProvider = {
    connect: async () => {
      record("connect");
      return { publicKey: ADDRESS, network: "testnet" };
    },
    getPublicKey: async () => {
      record("getPublicKey");
      return ADDRESS;
    },
    getNetwork: async () => {
      record("getNetwork");
      return "testnet";
    },
    signTransaction: async (xdr) => {
      record("signTransaction");
      return `xbull:${xdr}`;
    },
    signAuthEntry: async (xdr) => {
      record("signAuthEntry");
      return `xbullauth:${xdr}`;
    },
    ...overrides,
  };
  return provider;
}

function createFakeAlbedo(log: CallLog = { names: [] }): AlbedoProvider {
  const record = (name: string) => log.names.push(name);
  return {
    connect: (args) => {
      record("connect");
      const response = { address: ADDRESS, network: "testnet" };
      args.onReady?.(response);
      return Promise.resolve(response);
    },
    network: async () => {
      record("network");
      return { network: "testnet", networkPassphrase: TESTNET_PASSPHRASE };
    },
    signedTx: async () => {
      record("signedTx");
      return "x";
    },
    signedAuth: async () => {
      record("signedAuth");
      return "y";
    },
  };
}

function xbullScope(provider: XbullProvider | null): WalletScope {
  return { freighterLoader: null, albedo: null, xbull: provider };
}

function albedoScope(provider: AlbedoProvider | null): WalletScope {
  return { freighterLoader: null, albedo: provider, xbull: null };
}

function rowFor(rows: readonly CapabilityRow[], capability: string): CapabilityRow {
  const found = rows.find((row) => row.capability === capability);
  assert.ok(found, `no capability row for ${capability}`);
  return found;
}

// ── Absent providers ───────────────────────────────────────────────────────

describe("wallet diagnostic provider states", () => {
  it("lists every provider, installed or not, with a next step for the absent ones", () => {
    const statuses = providerStatuses([]);
    assert.deepEqual(
      statuses.map((status) => status.id),
      ["freighter", "albedo", "xbull"],
    );
    assert.deepEqual(
      statuses.map((status) => status.installed),
      [false, false, false],
    );
    // An extension is installable; a web wallet is not, and the copy must not
    // tell an Albedo user to install something that does not exist.
    assert.match(
      statuses.find((status) => status.id === "freighter")!.detail,
      /install the extension/i,
    );
    assert.match(statuses.find((status) => status.id === "albedo")!.detail, /open it/i);
    assert.equal(
      statuses.find((status) => status.id === "freighter")!.installUrl,
      "https://www.freighter.app",
    );
  });

  it("says when the browser has not been probed rather than calling it absent", () => {
    const statuses = providerStatuses(null);
    assert.deepEqual(
      statuses.map((status) => status.installed),
      [null, null, null],
    );
    for (const status of statuses) {
      assert.match(status.detail, /not been checked/i);
    }
  });

  it("marks only what detection actually found", () => {
    const statuses = providerStatuses(["xbull"]);
    assert.equal(rowPresent(statuses, "xbull"), true);
    assert.equal(rowPresent(statuses, "freighter"), false);
  });
});

function rowPresent(statuses: ReturnType<typeof providerStatuses>, id: WalletProviderId): boolean {
  return statuses.find((status) => status.id === id)?.installed === true;
}

// ── Capability states, from the provider's published shape ─────────────────

describe("wallet capability states", () => {
  it("reports the network-switch capability from the Freighter build in front of us", () => {
    const plain = walletCapabilities({
      providerId: "freighter",
      scope: freighterScope(createFakeFreighterApi()),
      freighterApi: createFakeFreighterApi(),
    });
    assert.equal(rowFor(plain, "switch-network").state, "unsupported");
    assert.match(rowFor(plain, "switch-network").detail, /predates the network-switch/i);

    const switchable = createFakeFreighterApi({
      requestNetworkAccess: async () => ({ isChanged: true }),
    });
    const newer = walletCapabilities({
      providerId: "freighter",
      scope: freighterScope(switchable),
      freighterApi: switchable,
    });
    assert.equal(rowFor(newer, "switch-network").state, "supported");

    const unprobed = walletCapabilities({
      providerId: "freighter",
      scope: freighterScope(switchable),
    });
    assert.equal(rowFor(unprobed, "switch-network").state, "unknown");
  });

  it("keeps every provider's table aligned to the same capability list", () => {
    const scope = freighterScope(createFakeFreighterApi());
    const rows = walletCapabilities({ providerId: "freighter", scope });
    assert.deepEqual(
      rows.map((row) => row.capability),
      [...WALLET_CAPABILITIES],
    );
  });

  it("distinguishes an xBull that cannot sign auth entries from one we have not looked at", () => {
    // The methods are omitted rather than set to `undefined`: that is the real
    // shape of an older xBull build, and `exactOptionalPropertyTypes` forbids the
    // other spelling.
    const rows = walletCapabilities({
      providerId: "xbull",
      scope: xbullScope({
        connect: async () => ({ publicKey: ADDRESS, network: "testnet" }),
        getPublicKey: async () => ADDRESS,
        getNetwork: async () => "testnet",
        signTransaction: async (xdr) => `xbull:${xdr}`,
      }),
    });
    assert.equal(rowFor(rows, "sign-auth-entry").state, "unsupported");
    assert.match(rowFor(rows, "sign-auth-entry").detail, /authorization/i);
    assert.equal(rowFor(rows, "read-address").state, "supported");
    assert.equal(rowFor(rows, "switch-network").state, "unsupported");
    assert.equal(rowFor(rows, "hardware-wallet").state, "unknown");
  });

  it("reads an xBull build with no address getter as unknown, not as broken", () => {
    const rows = walletCapabilities({
      providerId: "xbull",
      scope: xbullScope({
        connect: async () => ({ publicKey: ADDRESS, network: "testnet" }),
        getNetwork: async () => "testnet",
        signTransaction: async (xdr) => `xbull:${xdr}`,
        signAuthEntry: async (xdr) => `xbullauth:${xdr}`,
      } as XbullProvider),
    });
    assert.equal(rowFor(rows, "read-address").state, "unknown");
    assert.match(rowFor(rows, "read-address").detail, /connect request/i);
    assert.equal(canReadAddressWithoutPrompt("xbull", xbullScope(createFakeXbull())), true);
  });

  it("says that Albedo can only report its account through a connect", () => {
    const rows = walletCapabilities({
      providerId: "albedo",
      scope: albedoScope(createFakeAlbedo()),
    });
    assert.equal(rowFor(rows, "read-address").state, "unsupported");
    assert.equal(rowFor(rows, "read-network").state, "supported");
    assert.equal(rowFor(rows, "sign-auth-entry").state, "supported");
    assert.equal(canReadAddressWithoutPrompt("albedo", albedoScope(createFakeAlbedo())), false);
  });

  it("names the limited capabilities so the panel can lead with them", () => {
    const rows = walletCapabilities({
      providerId: "albedo",
      scope: albedoScope(createFakeAlbedo()),
    });
    assert.deepEqual(
      limitedCapabilities(rows).map((row) => row.capability),
      ["read-address", "switch-network", "hardware-wallet"],
    );
    assert.deepEqual(
      describeCapabilities(limitedCapabilities(rows))[0],
      `${rowFor(rows, "read-address").label}: unsupported — ${rowFor(rows, "read-address").detail}`,
    );
  });

  it("reports no capabilities at all when no provider is selected", () => {
    assert.deepEqual(walletCapabilities({ providerId: null, scope: freighterScope(null) }), []);
  });
});

// ── A refresh never prompts ────────────────────────────────────────────────

describe("the diagnostic read raises no wallet prompt", () => {
  let freighterLog: CallLog;
  let xbullLog: CallLog;
  let albedoLog: CallLog;

  beforeEach(() => {
    freighterLog = { names: [] };
    xbullLog = { names: [] };
    albedoLog = { names: [] };
  });

  it("reads Freighter's account and network through silent methods only", async () => {
    const api = createFakeFreighterApi({}, freighterLog);
    const connector = createFreighterConnector(async () => api);
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(api),
      providerId: "freighter",
      connector,
      installedProviders: ["freighter"],
    });

    assert.equal(diagnostics.state, "ready");
    assert.equal(diagnostics.account.address, ADDRESS);
    assert.deepEqual(diagnostics.account.network, {
      name: "testnet",
      passphrase: TESTNET_PASSPHRASE,
    });
    assert.deepEqual(freighterLog.names, ["getNetworkDetails", "getAddress"]);
    assert.ok(!freighterLog.names.includes("requestAccess"));
    assert.ok(!freighterLog.names.includes("signTransaction"));
    assert.ok(!freighterLog.names.includes("signAuthEntry"));
  });

  it("uses the session address instead of asking Freighter again", async () => {
    const api = createFakeFreighterApi({}, freighterLog);
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(api),
      providerId: "freighter",
      sessionAddress: ADDRESS,
      installedProviders: ["freighter"],
    });
    assert.equal(diagnostics.account.address, ADDRESS);
    assert.ok(!freighterLog.names.includes("getAddress"));
    assert.equal(diagnostics.state, "ready");
  });

  it("will not call xBull's connect to find an address it cannot read silently", async () => {
    const provider = {
      connect: async () => {
        xbullLog.names.push("connect");
        return { publicKey: ADDRESS, network: "testnet" };
      },
      getNetwork: async () => {
        xbullLog.names.push("getNetwork");
        return "testnet";
      },
      signTransaction: async (xdr: string) => `xbull:${xdr}`,
      signAuthEntry: async (xdr: string) => `xbullauth:${xdr}`,
    } as unknown as XbullProvider;
    const diagnostics = await collectWalletDiagnostics({
      scope: xbullScope(provider),
      providerId: "xbull",
      installedProviders: ["xbull"],
    });

    assert.deepEqual(xbullLog.names, ["getNetwork"]);
    assert.equal(diagnostics.account.address, null);
    assert.equal(diagnostics.state, "account-unavailable");
    assert.match(diagnostics.account.notice ?? "", /raised no prompt/);
  });

  it("will not open Albedo's pop-up for the account either", async () => {
    const provider = createFakeAlbedo(albedoLog);
    const diagnostics = await collectWalletDiagnostics({
      scope: albedoScope(provider),
      providerId: "albedo",
      installedProviders: ["albedo"],
    });
    assert.deepEqual(albedoLog.names, ["network"]);
    assert.equal(diagnostics.account.address, null);
    assert.match(diagnostics.account.notice ?? "", /connect request/);
    assert.equal(rowFor(diagnostics.capabilities, "read-address").state, "unsupported");
  });

  it("reads an xBull that does publish an address getter, still without connecting", async () => {
    const provider = createFakeXbull({}, xbullLog);
    const diagnostics = await collectWalletDiagnostics({
      scope: xbullScope(provider),
      providerId: "xbull",
      installedProviders: ["xbull"],
    });
    assert.deepEqual(xbullLog.names, ["getNetwork", "getPublicKey"]);
    assert.equal(diagnostics.account.address, ADDRESS);
    assert.equal(diagnostics.state, "ready");
  });
});

// ── Provider errors and account availability ───────────────────────────────

describe("provider errors and account availability", () => {
  it("turns an absent extension into a state with an install link", async () => {
    const diagnostics = await collectWalletDiagnostics({
      scope: xbullScope(null),
      providerId: "xbull",
      installedProviders: [],
    });
    assert.equal(diagnostics.state, "provider-error");
    assert.equal(diagnostics.error?.kind, "not-installed");
    assert.equal(diagnostics.error?.installUrl, "https://xbull.app");
    assert.match(diagnostics.headline, /xBull is not available in this browser/);
  });

  it("keeps a Freighter with no loaded bundle a provider error, not a silent empty panel", async () => {
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(null),
      providerId: "freighter",
      installedProviders: [],
    });
    assert.equal(diagnostics.state, "provider-error");
    assert.equal(diagnostics.error?.kind, "not-installed");
    assert.equal(diagnostics.account.address, null);
  });

  it("reports a wallet that answers with no account as unavailable", async () => {
    const api = createFakeFreighterApi({ getAddress: async () => ({}) });
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(api),
      providerId: "freighter",
      installedProviders: ["freighter"],
    });
    assert.equal(diagnostics.state, "account-unavailable");
    assert.equal(diagnostics.error, null);
    assert.match(diagnostics.account.notice ?? "", /returned no account address/);
  });

  it("keeps the session address when the wallet errors on the network read", async () => {
    const api = createFakeFreighterApi({
      getNetworkDetails: async () => {
        throw new Error("extension reload");
      },
    });
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(api),
      providerId: "freighter",
      sessionAddress: ADDRESS,
      connector: createFreighterConnector(async () => api),
      installedProviders: ["freighter"],
    });
    assert.equal(diagnostics.state, "ready");
    assert.equal(diagnostics.account.address, ADDRESS);
    assert.equal(diagnostics.account.network, null);
    assert.match(diagnostics.account.notice ?? "", /extension reload/);
    assert.equal(diagnostics.networkMismatch, null);
  });

  it("classifies a non-wallet failure without inventing an install link", async () => {
    const connector = {
      id: "freighter",
      connect: async () => ({ address: ADDRESS, network: { name: "testnet", passphrase: "" } }),
      getPublicKey: async () => ADDRESS,
      getNetwork: async () => {
        throw new Error("popup blocked");
      },
      signTransaction: async () => "x",
      signAuthEntry: async () => "y",
    } satisfies WalletConnector;
    const snapshot = await readAccountSnapshot({
      connector,
      scope: freighterScope(createFakeFreighterApi()),
      sessionAddress: ADDRESS,
    });
    const error: ProviderErrorInfo = {
      kind: "unknown",
      message: "popup blocked",
      installUrl: null,
      guideUrl: null,
    };
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.notice, error.message);
    assert.equal(snapshot.address, ADDRESS);
  });

  it("calls a session with no selected provider read-only rather than broken", async () => {
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(null),
      providerId: null,
      installedProviders: [],
    });
    assert.equal(diagnostics.state, "not-connected");
    assert.match(diagnostics.headline, /read-only/);
    assert.deepEqual(diagnostics.capabilities, []);
  });
});

// ── Capability changes between refreshes ───────────────────────────────────

describe("capability changes", () => {
  it("a refresh sees a wallet that gained an authorization signer", async () => {
    const before = await collectWalletDiagnostics({
      scope: xbullScope({
        connect: async () => ({ publicKey: ADDRESS, network: "testnet" }),
        getPublicKey: async () => ADDRESS,
        getNetwork: async () => "testnet",
        signTransaction: async (xdr: string) => `xbull:${xdr}`,
      } as unknown as XbullProvider),
      providerId: "xbull",
      installedProviders: ["xbull"],
    });
    assert.equal(rowFor(before.capabilities, "sign-auth-entry").state, "unsupported");

    const after = await collectWalletDiagnostics({
      scope: xbullScope(createFakeXbull()),
      providerId: "xbull",
      installedProviders: ["xbull"],
    });
    assert.equal(rowFor(after.capabilities, "sign-auth-entry").state, "supported");
    assert.deepEqual(
      after.capabilities.map((row) => row.capability),
      before.capabilities.map((row) => row.capability),
    );
  });

  it("a refresh sees a wallet that moved networks, and names the disagreement", async () => {
    const onPublic = createFakeFreighterApi({
      getNetworkDetails: async () => ({ network: "PUBLIC", networkPassphrase: PUBLIC_PASSPHRASE }),
    });
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(onPublic),
      providerId: "freighter",
      sessionAddress: ADDRESS,
      installedProviders: ["freighter"],
    });
    assert.equal(diagnostics.account.network?.passphrase, PUBLIC_PASSPHRASE);
    assert.equal(diagnostics.networkMismatch?.walletPassphrase, PUBLIC_PASSPHRASE);
    assert.match(diagnostics.headline, /Mainnet/);
    assert.deepEqual(diagnostics.targetNetwork, {
      name: "testnet",
      passphrase: TESTNET_PASSPHRASE,
    });
  });

  it("leaves no mismatch to report when the wallet agrees with the console", async () => {
    const api = createFakeFreighterApi();
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(api),
      providerId: "freighter",
      sessionAddress: ADDRESS,
      installedProviders: ["freighter"],
    });
    assert.equal(diagnostics.networkMismatch, null);
  });
});

// ── Only public metadata ───────────────────────────────────────────────────

describe("what the diagnostic is allowed to carry", () => {
  it("holds the address, the network and provider facts, and nothing a wallet signs", async () => {
    const api = createFakeFreighterApi();
    const diagnostics = await collectWalletDiagnostics({
      scope: freighterScope(api),
      providerId: "freighter",
      sessionAddress: ADDRESS,
      installedProviders: ["freighter"],
      connector: createFreighterConnector(async () => api),
    });
    const serialised = JSON.stringify(diagnostics);
    assert.ok(serialised.includes(ADDRESS), "the public address is the point of the view");
    for (const forbidden of ["secret", "seed", "private", "signed(", "auth(GD", "tx_xdr"]) {
      assert.ok(
        !serialised.toLowerCase().includes(forbidden.toLowerCase()),
        `the diagnostic must not carry ${forbidden}`,
      );
    }
    assert.equal(diagnostics.account.address, ADDRESS);
  });
});
