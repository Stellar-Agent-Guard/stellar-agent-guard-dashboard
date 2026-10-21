"use client";

/**
 * Wallet diagnostics (issue #342): what this browser can serve, which account is
 * connected, and what the chosen provider can actually do.
 *
 * Support for this console arrives as "my wallet is behaving strangely", and the
 * three providers an operator can pick disagree about almost everything — only
 * Freighter can be asked to change networks, only some xBull builds publish a
 * `getPublicKey`, and Albedo reports its account solely as part of a connect
 * request. A panel that shows the *selected* provider's capabilities, the public
 * account metadata, and the network on both sides turns that guesswork into a
 * screenshot an operator can paste.
 *
 * Two constraints shape the module:
 *
 *   - **Public metadata only.** Provider descriptors, the connected address and
 *     the network are all public and safe to display or quote. Everything that
 *     belongs to the wallet — keys, seeds, signatures, the XDR of what is being
 *     signed — is deliberately unreachable from here, because a diagnostic that
 *     needs secret material is an incident rather than a support tool.
 *   - **Asking is not the same as signing.** Detection (`detectInstalledProviders`)
 *     and a network read never raise a prompt, and this module is restricted to
 *     those. It calls neither `connect()` (a permission prompt on several
 *     providers) nor `signTransaction`/`signAuthEntry` (a signature prompt on all
 *     three), and where a provider can only answer a question by being asked to
 *     connect, the diagnostic reports the field as unavailable with the reason
 *     rather than quietly prompting the operator's wallet.
 *
 * As elsewhere in `lib/guard`, the providers arrive as injected data, so every
 * branch that matters — absent wallet, an erroring wallet, a capability that
 * appears or disappears between builds — is exercised headlessly in `node --test`.
 */

import { NETWORK } from "./network.ts";
import {
  detectNetworkMismatch,
  loadFreighterNetworkApi,
  networkDisplayName,
  type NetworkMismatch,
  type FreighterNetworkApi,
} from "./networkSwitch.ts";
import {
  WALLET_PROVIDERS,
  WalletNotInstalledError,
  WalletUnsupportedError,
  WalletUserRejectedError,
  createWalletConnector,
  walletProviderDescriptor,
  type WalletConnector,
  type WalletNetwork,
  type WalletProviderId,
  type WalletScope,
  type XbullProvider,
} from "./walletConnector.ts";
import { WalletError } from "./wallet.ts";

// ── Provider availability ──────────────────────────────────────────────────

/**
 * One provider as the diagnostic sees it.
 *
 * `installed` is `null` while nothing has probed the browser yet — the modal
 * renders immediately and fills in, so "we have not looked" is never shown as
 * "it is not there".
 */
export interface ProviderStatus {
  id: WalletProviderId;
  name: string;
  kind: "extension" | "web";
  monogram: string;
  blurb: string;
  installUrl: string;
  guideUrl: string;
  installed: boolean | null;
  detail: string;
}

export function providerStatuses(
  installedProviders: readonly WalletProviderId[] | null,
): ProviderStatus[] {
  return WALLET_PROVIDERS.map((descriptor) => {
    const installed =
      installedProviders === null ? null : installedProviders.includes(descriptor.id);
    return {
      id: descriptor.id,
      name: descriptor.name,
      kind: descriptor.kind,
      monogram: descriptor.monogram,
      blurb: descriptor.blurb,
      installUrl: descriptor.installUrl,
      guideUrl: descriptor.guideUrl,
      installed,
      detail: describeProviderState(descriptor.kind, installed),
    };
  });
}

function describeProviderState(kind: "extension" | "web", installed: boolean | null): string {
  if (installed === null) return "This browser has not been checked for it yet.";
  if (installed) return kind === "web" ? "Reachable in this tab." : "Detected in this browser.";
  return kind === "extension"
    ? "Not detected — install the extension, then use Refresh below."
    : "Not reachable — open it and connect from there.";
}

// ── Capabilities ───────────────────────────────────────────────────────────

/** The things an operator can reasonably expect a wallet to do for this console. */
export type WalletCapability =
  | "connect"
  | "read-address"
  | "read-network"
  | "sign-transaction"
  | "sign-auth-entry"
  | "switch-network"
  | "hardware-wallet";

/**
 * Whether the provider can do it *here*, as this browser reports it.
 *
 * `unknown` is not a shrug: it is the state of a provider that is installed but
 * does not publish the method the answer would come from, which is a different
 * next step (update or reload the wallet) from `unsupported` (that provider will
 * never do this, whatever the version).
 */
export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface CapabilityRow {
  capability: WalletCapability;
  label: string;
  state: CapabilityState;
  detail: string;
}

const CAPABILITY_LABELS: Readonly<Record<WalletCapability, string>> = {
  connect: "Connect and hold the account",
  "read-address": "Read the connected address without a prompt",
  "read-network": "Read the wallet's network without a prompt",
  "sign-transaction": "Sign a transaction envelope",
  "sign-auth-entry": "Sign a Soroban authorization entry",
  "switch-network": "Switch networks from this console",
  "hardware-wallet": "Sign with a hardware wallet",
};

/** Every capability, in display order, so the tables of two providers align. */
export const WALLET_CAPABILITIES: readonly WalletCapability[] = [
  "connect",
  "read-address",
  "read-network",
  "sign-transaction",
  "sign-auth-entry",
  "switch-network",
  "hardware-wallet",
];

export interface CapabilityProbe {
  providerId: WalletProviderId | null;
  scope: WalletScope;
  /**
   * Freighter's API bundle, when it has already been loaded.
   *
   * Only Freighter's network-switch answer needs it, and reaching for the
   * bundle is a module import rather than a wallet call — so a caller that has
   * it passes it in, and a caller that does not gets `unknown`, which is the
   * truth for a capability that was never probed.
   */
  freighterApi?: FreighterNetworkApi | null;
}

/**
 * What the selected provider can do, derived from the shape it publishes.
 *
 * Nothing here calls a wallet: an optional method being absent is read off the
 * object, which is exactly how the connector itself decides to raise
 * `WalletUnsupportedError` later. The diagnostic and the signing path therefore
 * cannot disagree about what a wallet supports.
 */
export function walletCapabilities(probe: CapabilityProbe): CapabilityRow[] {
  const { providerId, scope } = probe;
  if (!providerId) return [];
  const rows: CapabilityRow[] = [];
  const push = (capability: WalletCapability, state: CapabilityState, detail: string): void => {
    rows.push({ capability, label: CAPABILITY_LABELS[capability], state, detail });
  };

  push(
    "connect",
    "supported",
    "Asks the wallet for account access. Nothing is signed by that request.",
  );

  if (providerId === "freighter") {
    push(
      "read-address",
      "supported",
      "Freighter answers an address read once access is granted, so Refresh never interrupts you.",
    );
    push(
      "read-network",
      "supported",
      "The network is read straight from the wallet on every refresh.",
    );
    push(
      "sign-transaction",
      "supported",
      "Shown inside Freighter for approval, including the network.",
    );
    push(
      "sign-auth-entry",
      "supported",
      "Soroban authorization entries are signed through the same approval flow.",
    );
    const api = probe.freighterApi ?? null;
    if (api === null) {
      push(
        "switch-network",
        "unknown",
        "Freighter's network API has not been loaded in this tab yet, so this has not been checked.",
      );
    } else if (typeof api.requestNetworkAccess === "function") {
      push(
        "switch-network",
        "supported",
        "The console can ask Freighter to move to its own network; you still approve the request.",
      );
    } else {
      push(
        "switch-network",
        "unsupported",
        "This Freighter build predates the network-switch request, so the network has to be changed inside the wallet.",
      );
    }
    push(
      "hardware-wallet",
      "supported",
      "Ledger and Trezor sign through Freighter's own approval flow. This console sends the same request either way and never sees the device.",
    );
    return rows;
  }

  if (providerId === "xbull") {
    const provider: XbullProvider | null = scope.xbull;
    const hasAddressRead = typeof provider?.getPublicKey === "function";
    push(
      "read-address",
      hasAddressRead ? "supported" : "unknown",
      hasAddressRead
        ? "xBull publishes an address read, so Refresh never interrupts you."
        : "This xBull build publishes no address read, so the account is only known from a connect request. Refresh will not raise one.",
    );
    const hasNetworkRead = typeof provider?.getNetwork === "function";
    push(
      "read-network",
      hasNetworkRead ? "supported" : "unknown",
      hasNetworkRead
        ? "The network is read straight from the wallet on every refresh."
        : "This xBull build reports no network, so the diagnostic cannot compare it against the console's target.",
    );
    push(
      "sign-transaction",
      "supported",
      provider === null
        ? "xBull is not detected in this browser, so nothing can be signed yet."
        : "Shown inside xBull for approval.",
    );
    const hasAuthSigner = typeof provider?.signAuthEntry === "function";
    push(
      "sign-auth-entry",
      hasAuthSigner ? "supported" : "unsupported",
      hasAuthSigner
        ? "Soroban authorization entries are signed through the same approval flow."
        : "This xBull build has no authorization-entry signer, and every guard write needs one. Choose Freighter or Albedo to operate a guard.",
    );
    push(
      "switch-network",
      "unsupported",
      "xBull selects its network in its own UI; the console can only report the disagreement.",
    );
    push(
      "hardware-wallet",
      "unknown",
      "Whether xBull drives a hardware device is xBull's own choice; this console cannot tell, and treats the account as wallet-held.",
    );
    return rows;
  }

  // Albedo: a web wallet whose account arrives only with a connect request.
  push(
    "read-address",
    "unsupported",
    "Albedo reports its account only as part of a connect request, so a refresh cannot read it without a pop-up. The address shown comes from the session that was connected.",
  );
  push(
    "read-network",
    "supported",
    "Albedo answers a network read without a pop-up, which is what the mismatch warning is built on.",
  );
  push(
    "sign-transaction",
    "supported",
    "Albedo signs through its own pop-up, where the transaction is shown to you.",
  );
  push("sign-auth-entry", "supported", "Soroban authorization entries go through the same pop-up.");
  push(
    "switch-network",
    "unsupported",
    "Albedo selects its network in its own UI; the console can only report the disagreement.",
  );
  push(
    "hardware-wallet",
    "unknown",
    "Albedo's own hardware support is not visible to this console, and it is never assumed.",
  );
  return rows;
}

/** The rows that are not a plain yes, which is what an operator needs to read first. */
export function limitedCapabilities(rows: readonly CapabilityRow[]): CapabilityRow[] {
  return rows.filter((row) => row.state !== "supported");
}

// ── Public account metadata ────────────────────────────────────────────────

export interface AccountSnapshot {
  address: string | null;
  network: WalletNetwork | null;
  /** Why a field is missing, in operator words. Never a stack trace. */
  notice: string | null;
  /** The wallet could not be reached at all, which outranks "no account yet". */
  error: ProviderErrorInfo | null;
}

/**
 * Whether this provider will answer an address read without a prompt.
 *
 * Follows the connector's own code path rather than a claim about the wallet:
 * xBull's address read falls back to `connect()` when the extension publishes no
 * `getPublicKey`, and Albedo's *is* a connect, so neither counts as silent.
 */
export function canReadAddressWithoutPrompt(
  providerId: WalletProviderId,
  scope: WalletScope,
): boolean {
  if (providerId === "freighter") return scope.freighterLoader !== null;
  if (providerId === "xbull") return typeof scope.xbull?.getPublicKey === "function";
  return false;
}

/**
 * Read the public account metadata of a connector, raising no prompt.
 *
 * The network read is silent on all three providers, so it always runs — it is
 * the half of the diagnostic that catches a wallet sitting on Mainnet while the
 * console points at Testnet. The address comes from the session when there is
 * one, and from a silent wallet read otherwise; when neither is available the
 * reason is reported instead of prompting.
 */
export async function readAccountSnapshot(params: {
  connector: WalletConnector | null;
  scope: WalletScope;
  sessionAddress?: string | null;
}): Promise<AccountSnapshot> {
  const notices: string[] = [];
  let failure: ProviderErrorInfo | null = null;
  /**
   * A wallet that cannot be reached at all is a different state from a wallet
   * that is reachable and has no account here yet: the first needs an install,
   * the second a connect, and merging them sends the operator to the wrong one.
   */
  const recordFailure = (error: unknown): void => {
    const info = describeProviderError(error);
    notices.push(info.message);
    if (info.kind === "not-installed" && failure === null) failure = info;
  };

  const sessionAddress = params.sessionAddress ?? null;
  if (!params.connector) {
    return {
      address: sessionAddress,
      network: null,
      notice:
        "No wallet is connected, so nothing was read from one. Every read on this page still works.",
      error: null,
    };
  }
  const connector = params.connector;

  let network: WalletNetwork | null = null;
  try {
    network = await connector.getNetwork();
    if (!network.passphrase) {
      notices.push(
        `${walletProviderDescriptor(connector.id).name} reported no network passphrase, so the console cannot compare it with its own target.`,
      );
    }
  } catch (error) {
    recordFailure(error);
  }

  let address = sessionAddress;
  if (address === null && failure === null) {
    if (canReadAddressWithoutPrompt(connector.id, params.scope)) {
      try {
        address = await connector.getPublicKey();
      } catch (error) {
        notices.push(describeProviderError(error).message);
      }
    } else {
      notices.push(
        "This wallet reports its account only as part of a connect request, so no address was read. Use Reconnect to establish it — this refresh raised no prompt.",
      );
    }
  }

  return {
    address,
    network,
    notice: notices.length > 0 ? notices.join(" ") : null,
    error: failure,
  };
}

// ── Provider errors ────────────────────────────────────────────────────────

export type ProviderErrorKind =
  "not-installed" | "user-rejected" | "unsupported" | "wallet" | "unknown";

export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  message: string;
  /** Where to get the wallet, when the error knows — a missing wallet is a state with a next step. */
  installUrl: string | null;
  guideUrl: string | null;
}

/**
 * Put a wallet failure into the one bucket the UI can act on.
 *
 * The three classes come from the connector's own error types rather than from
 * matching on message text, so a refusal cannot be dressed up as a broken
 * install; anything that is not a wallet error stays `unknown` with its message
 * intact.
 */
export function describeProviderError(error: unknown): ProviderErrorInfo {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof WalletNotInstalledError) {
    return {
      kind: "not-installed",
      message,
      installUrl: error.installUrl,
      guideUrl: error.guideUrl,
    };
  }
  if (error instanceof WalletUserRejectedError) {
    return { kind: "user-rejected", message, installUrl: null, guideUrl: null };
  }
  if (error instanceof WalletUnsupportedError) {
    return { kind: "unsupported", message, installUrl: null, guideUrl: null };
  }
  if (error instanceof WalletError) {
    return { kind: "wallet", message, installUrl: null, guideUrl: null };
  }
  return { kind: "unknown", message, installUrl: null, guideUrl: null };
}

// ── The assembled diagnostic ───────────────────────────────────────────────

export type DiagnosticsState = "not-connected" | "ready" | "account-unavailable" | "provider-error";

export interface WalletDiagnostics {
  providers: ProviderStatus[];
  selectedProvider: WalletProviderId | null;
  state: DiagnosticsState;
  headline: string;
  account: AccountSnapshot;
  capabilities: CapabilityRow[];
  /** The network this console writes to, shown beside the wallet's own. */
  targetNetwork: WalletNetwork;
  networkMismatch: NetworkMismatch | null;
  error: ProviderErrorInfo | null;
}

/**
 * Everything the diagnostic panel shows, from injected data and silent reads only.
 *
 * `connector` is the session's own when there is one; building a second Freighter
 * handle to ask the same question would mean the diagnostic could disagree with
 * the panel that signs. A caller with no session connector (a refresh before a
 * connect) gets one built from the scope, which is where an uninstalled provider
 * surfaces as `provider-error` with its install link.
 */
export async function collectWalletDiagnostics(params: {
  scope: WalletScope;
  providerId: WalletProviderId | null;
  sessionAddress?: string | null;
  installedProviders?: readonly WalletProviderId[] | null;
  connector?: WalletConnector | null;
  targetPassphrase?: string;
  freighterApi?: FreighterNetworkApi | null;
}): Promise<WalletDiagnostics> {
  const installedProviders =
    params.installedProviders === undefined ? null : params.installedProviders;
  const sessionAddress = params.sessionAddress ?? null;
  const targetNetwork: WalletNetwork = { name: NETWORK.name, passphrase: NETWORK.passphrase };
  const providers = providerStatuses(installedProviders === null ? null : [...installedProviders]);

  let connector = params.connector ?? null;
  let error: ProviderErrorInfo | null = null;
  if (connector === null && params.providerId) {
    try {
      connector = createWalletConnector(params.providerId, params.scope);
    } catch (caught) {
      error = describeProviderError(caught);
    }
  }

  const account = await readAccountSnapshot({
    connector,
    scope: params.scope,
    ...(sessionAddress === null ? {} : { sessionAddress }),
  });
  if (error === null) error = account.error;

  let freighterApi = params.freighterApi;
  if (freighterApi === undefined && params.providerId === "freighter" && error === null) {
    freighterApi = await loadFreighterNetworkApi(params.scope.freighterLoader);
  }
  const capabilities = walletCapabilities({
    providerId: params.providerId,
    scope: params.scope,
    ...(freighterApi === undefined ? {} : { freighterApi }),
  });

  const networkMismatch =
    account.network === null
      ? null
      : detectNetworkMismatch(
          account.network.passphrase,
          params.targetPassphrase ?? NETWORK.passphrase,
          {
            targetNetwork: NETWORK.name,
            walletNetwork: account.network.name,
          },
        );

  const state: DiagnosticsState = error
    ? "provider-error"
    : params.providerId === null
      ? "not-connected"
      : account.address
        ? "ready"
        : "account-unavailable";

  return {
    providers,
    selectedProvider: params.providerId,
    state,
    headline: describeDiagnosticsHeadline(state, params.providerId, account),
    account,
    capabilities,
    targetNetwork,
    networkMismatch,
    error,
  };
}

/**
 * The one line that says what state the wallet is in.
 *
 * Kept separate from the panel so the wording is asserted in the same place it
 * is written, and an operator reading a screenshot gets the summary first.
 */
export function describeDiagnosticsHeadline(
  state: DiagnosticsState,
  providerId: WalletProviderId | null,
  account: AccountSnapshot,
): string {
  const name = providerId === null ? null : providerDisplayName(providerId);
  switch (state) {
    case "provider-error":
      return `${name ?? "That wallet"} is not available in this browser.`;
    case "not-connected":
      return "No wallet is selected, so this console is read-only. Every read on it works without a wallet.";
    case "account-unavailable":
      return `${name ?? "The wallet"} has no account established for this tab${
        account.notice ? `: ${account.notice}` : ". Reconnect it to resume signing."
      }`;
    case "ready":
      return `Connected to ${name ?? "a wallet"} on ${networkDisplayName({
        passphrase: account.network?.passphrase ?? null,
        name: account.network?.name ?? null,
      })}.`;
  }
}

function providerDisplayName(id: WalletProviderId): string {
  return WALLET_PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
}

/**
 * The capability table as sentences, for the `aria-describedby` text and for a
 * support message that survives being copied out of the browser.
 */
export function describeCapabilities(rows: readonly CapabilityRow[]): string[] {
  return rows.map((row) => `${row.label}: ${row.state}${row.detail ? ` — ${row.detail}` : ""}`);
}
