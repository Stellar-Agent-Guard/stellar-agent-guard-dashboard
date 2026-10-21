/**
 * Network guard — hard-block write actions on the wrong network (issue #18).
 *
 * # Why this exists alongside networkSwitch.ts
 *
 * `networkSwitch.ts` handles *display*: detecting a mismatch and offering the
 * operator a one-click route to fix it. It runs on connect and whenever the
 * wallet bar renders. That is a UX layer, not an enforcement layer.
 *
 * This module is the *enforcement* layer: it is called at the top of every
 * write chokepoint (`invokeWithWallet` and `submitOperation`) **before** any
 * `signer.signTransaction()` can be reached. A mismatch throws
 * `NetworkMismatchError` and the signer is never asked.
 *
 * # SDK cross-cite
 *
 * The SDK performs a server-side passphrase check (`stellar-agent-guard-sdk`
 * validates that the Soroban RPC server's passphrase matches the one the SDK
 * was configured with). That is the *transaction layer* twin: RPC could be
 * right while the wallet is wrong, which is exactly the gap this module closes.
 * Both checks are needed; neither replaces the other.
 *
 * # Network truth source
 *
 * Freighter's `getNetworkDetails()` is the authoritative source for the
 * wallet's active network. It returns `{ network?, networkPassphrase?, error? }`
 * (confirmed from `@stellar/freighter-api` v6.0.1 — see `wallet.ts`, which
 * already uses this same call for the connect flow).
 *
 * The field this module compares is `networkPassphrase`: the passphrase is
 * cryptographically bound to every signed transaction (it is part of the
 * network ID), and it is more precise than the short `network` name (which
 * varies by wallet provider and could be "TESTNET", "testnet", "test", etc.).
 *
 * # Fail-safe
 *
 * If `getNetworkDetails()` throws, returns an error, or returns an empty
 * passphrase, the guard **blocks** the write with a "cannot verify network"
 * message. Treating an unverifiable network as "probably fine" would turn a
 * connectivity failure into a silent bypass, which is exactly the risk this
 * guard is meant to eliminate.
 *
 * # Read-path safety
 *
 * Reads are not guarded here. Dashboard reads hit the configured Soroban RPC
 * URL directly, independent of the wallet's network — `readGuardSnapshot`,
 * `readStatus`, `readPolicy` etc. all call `server.simulateTransaction` (or
 * `server.getContractData`) using `NETWORK.rpcUrl`. The wallet's network has
 * no effect on those calls, so blocking reads would be actively wrong.
 */

import { NETWORK } from "./network.ts";
import { networkDisplayName } from "./networkSwitch.ts";

/** Injected API surface; typed to the subset `assertCorrectNetwork` needs. */
export interface NetworkDetailsApi {
  getNetworkDetails(): Promise<{
    network?: string;
    networkPassphrase?: string;
    error?: unknown;
  }>;
}

/**
 * Thrown by `assertCorrectNetwork()` on any mismatch or unverifiable state.
 *
 * Components that call write operations should catch this type specifically,
 * because it carries the structured `mismatch` data needed to render the
 * `NetworkMismatchModal` rather than a generic error string.
 */
export class NetworkMismatchError extends Error {
  public readonly walletNetwork: string;
  public readonly walletPassphrase: string;
  public readonly targetNetwork: string;
  public readonly targetPassphrase: string;
  public readonly unverifiable: boolean;

  constructor(params: {
    walletNetwork: string;
    walletPassphrase: string;
    targetNetwork: string;
    targetPassphrase: string;
    unverifiable?: boolean;
  }) {
    const { walletNetwork, walletPassphrase, targetNetwork, targetPassphrase, unverifiable = false } = params;
    const walletLabel = networkDisplayName({ passphrase: walletPassphrase, name: walletNetwork });
    const targetLabel = networkDisplayName({ passphrase: targetPassphrase, name: targetNetwork });
    const msg = unverifiable
      ? `Cannot verify wallet network — refusing to sign. ` +
        `This dashboard targets ${targetLabel}; the wallet's active network could not be read. ` +
        `Check that Freighter is installed and unlocked, then try again.`
      : `Your wallet is on ${walletLabel}, but this dashboard targets ${targetLabel}. ` +
        `Switch your wallet to ${targetLabel} in Freighter before signing.`;
    super(msg);
    this.name = "NetworkMismatchError";
    this.walletNetwork = walletNetwork;
    this.walletPassphrase = walletPassphrase;
    this.targetNetwork = targetNetwork;
    this.targetPassphrase = targetPassphrase;
    this.unverifiable = unverifiable;
  }
}

/**
 * Assert that the wallet is on the configured network before any signing.
 *
 * Throws `NetworkMismatchError` when:
 * - The wallet's passphrase does not match `targetPassphrase`
 * - `getNetworkDetails()` throws or returns an error
 * - `getNetworkDetails()` returns an empty / undefined passphrase (fail-safe)
 *
 * Returns normally (void) when the wallet agrees, so call sites can be a
 * single `await assertCorrectNetwork(api)` with no branch needed.
 *
 * @param api    - Injectable `NetworkDetailsApi` (production: Freighter; tests: stub)
 * @param target - Defaults to `NETWORK` (testnet). Pass an override for unit tests.
 */
export async function assertCorrectNetwork(
  api: NetworkDetailsApi,
  target: { passphrase: string; name: string } = NETWORK,
): Promise<void> {
  let details: { network?: string; networkPassphrase?: string; error?: unknown };

  try {
    details = await api.getNetworkDetails();
  } catch (error) {
    // getNetworkDetails() should not throw in normal operation, but if it does
    // (extension not installed, communication failure) we block — not bypass.
    throw new NetworkMismatchError({
      walletNetwork: "unknown",
      walletPassphrase: "",
      targetNetwork: target.name,
      targetPassphrase: target.passphrase,
      unverifiable: true,
    });
  }

  if (details.error) {
    throw new NetworkMismatchError({
      walletNetwork: "unknown",
      walletPassphrase: "",
      targetNetwork: target.name,
      targetPassphrase: target.passphrase,
      unverifiable: true,
    });
  }

  const walletPassphrase = (details.networkPassphrase ?? "").trim();
  if (!walletPassphrase) {
    // An empty passphrase means the API returned nothing useful — fail-safe.
    throw new NetworkMismatchError({
      walletNetwork: details.network ?? "unknown",
      walletPassphrase: "",
      targetNetwork: target.name,
      targetPassphrase: target.passphrase,
      unverifiable: true,
    });
  }

  if (walletPassphrase !== target.passphrase) {
    throw new NetworkMismatchError({
      walletNetwork: details.network ?? "unknown",
      walletPassphrase,
      targetNetwork: target.name,
      targetPassphrase: target.passphrase,
    });
  }

  // Passphrases agree — allow the write to proceed.
}

/**
 * Build a `NetworkDetailsApi` from the live Freighter bundle.
 *
 * Loaded on demand (same pattern as `wallet.ts`) so this module is safe to
 * import in Node test files — the bundle is never evaluated unless this
 * function is called.
 */
export async function freighterNetworkDetailsApi(): Promise<NetworkDetailsApi> {
  const { getNetworkDetails } = await import("@stellar/freighter-api");
  return { getNetworkDetails };
}

/**
 * Convert a `NetworkMismatchError` into the `InvokeResult` shape that
 * `invokeWithWallet` and `submitOperation` already use for early refusals.
 *
 * This keeps the write-path catch blocks to a single line and guarantees
 * the refusal is consistently represented regardless of where it was thrown.
 */
export function networkMismatchToRefusal(error: NetworkMismatchError): {
  kind: "refused";
  stage: "network_guard";
  detail: string;
  diagnosticEvents: never[];
} {
  return {
    kind: "refused",
    stage: "network_guard",
    detail: error.message,
    diagnosticEvents: [],
  };
}
