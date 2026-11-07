/**
 * Network guard: hard-block writes when the wallet is on the wrong network.
 *
 * Issue #18 — write-path enforcement companion to the WalletBar display.
 *
 * WHY THIS EXISTS ALONGSIDE WalletBar's WARNING:
 * WalletBar shows a mismatch warning (display), but it does not block writes.
 * An operator on Mainnet Freighter while the app targets Testnet can still click
 * Freeze, deploying writes against the wrong chain (or failing confusingly
 * mid-flow after the wallet popup appears). This module closes that gap:
 * assertCorrectNetwork() is called before every signing prompt, so the wallet
 * is NEVER shown a transaction to sign when the network disagrees.
 *
 * WHY READS ARE UNBLOCKED:
 * Reads call configured RPC endpoints (NETWORK.rpcUrl) and do not go through
 * the wallet at all — the read source account (READ_SOURCE_FALLBACK in
 * network.ts) is a known funded address used solely as a simulation source.
 * A mismatch between wallet and app network does not affect read accuracy:
 * the RPC call goes to the right server regardless of which network Freighter
 * is showing. Only writes need the wallet's signature and therefore need the
 * wallet to be on the same network.
 *
 * SDK CROSS-CITE:
 * The stellar-agent-guard-sdk has a complementary interlock that checks the
 * RPC server's passphrase (server-side). This module checks the wallet's
 * passphrase (client/wallet-side). Both are needed: the RPC server could be
 * correct while the wallet is wrong, producing a signature over the wrong
 * network id that the RPC would then reject with tx_bad_auth_extra.
 *
 * FREIGHTER API SURFACE USED:
 * `getNetworkDetails()` from `@stellar/freighter-api` v6 returns:
 *   `{ network: string, networkUrl: string, networkPassphrase: string,
 *     sorobanRpcUrl?: string, error?: FreighterApiError }`
 * The field used is `networkPassphrase`. This is the only field that unambiguously
 * identifies the network: a wallet can be on "testnet" by name but with a
 * custom passphrase, and the passphrase is what Stellar transactions embed.
 *
 * FALLBACK (unverifiable passphrase):
 * If `getNetworkDetails` is unavailable or throws, we BLOCK writes rather than
 * proceeding. An unverifiable passphrase is not a reason to trust: silently
 * proceeding would mean a broken or missing extension looks like a match,
 * which is the exact danger this guard exists to prevent.
 */

import { NETWORK } from './network.ts';
import {
  detectNetworkMismatch,
  networkDisplayName,
  type NetworkMismatch,
} from './networkSwitch.ts';

export type { NetworkMismatch };

/**
 * Thrown by `assertCorrectNetwork()` when the wallet is on the wrong network
 * or when the network cannot be verified.
 *
 * Components catch this and show NetworkMismatchModal rather than letting it
 * propagate as an unhandled error.
 */
export class NetworkMismatchError extends Error {
  readonly mismatch: NetworkMismatch | null;

  constructor(message: string, mismatch: NetworkMismatch | null = null) {
    super(message);
    this.name = 'NetworkMismatchError';
    this.mismatch = mismatch;
  }
}

/**
 * The injectable interface for reading network details from the wallet.
 *
 * Injected rather than hard-wired so this module can be tested headlessly
 * without a browser extension, exactly the same pattern wallet.ts uses.
 */
export interface NetworkDetailsSource {
  /**
   * Return the wallet's active network details.
   *
   * Returns `null` when the API is unavailable (older wallet version, no
   * extension, server-side render). The guard treats `null` as unverifiable
   * and blocks — fail-safe, not fail-open.
   */
  getNetworkDetails(): Promise<{
    networkPassphrase?: string;
    network?: string;
    error?: { message?: string } | null;
  } | null>;
}

/**
 * Produce a NetworkDetailsSource backed by the live @stellar/freighter-api.
 *
 * Called at runtime in the browser; tests inject a fake instead.
 */
export function liveFreighterSource(): NetworkDetailsSource {
  return {
    async getNetworkDetails() {
      try {
        const api = await import('@stellar/freighter-api');
        return await api.getNetworkDetails();
      } catch {
        return null;
      }
    },
  };
}

/**
 * Assert that the wallet is on the network this dashboard targets.
 *
 * Throws `NetworkMismatchError` when:
 *   1. The wallet's passphrase does not match `NETWORK.passphrase` (hard mismatch).
 *   2. The wallet's passphrase cannot be read — API missing or threw (fail-safe block).
 *
 * Returns normally when the wallet agrees with the dashboard's configured network.
 *
 * @param source - Injectable wallet network reader. Defaults to live Freighter API.
 * @param targetPassphrase - The passphrase the app is configured for. Defaults to NETWORK.passphrase.
 * @param targetNetwork - The network name for display purposes. Defaults to NETWORK.name.
 */
export async function assertCorrectNetwork(
  source: NetworkDetailsSource = liveFreighterSource(),
  targetPassphrase: string = NETWORK.passphrase,
  targetNetwork: string = NETWORK.name,
): Promise<void> {
  let details: Awaited<ReturnType<NetworkDetailsSource['getNetworkDetails']>>;

  try {
    details = await source.getNetworkDetails();
  } catch {
    // getNetworkDetails itself threw — treat as unverifiable, fail-safe block.
    throw new NetworkMismatchError(
      `Cannot verify wallet network before signing — refusing write to protect against cross-network signatures. ` +
      `Ensure ${networkDisplayName({ passphrase: null, name: targetNetwork })} is selected in your wallet.`,
      null,
    );
  }

  // null return means the API was unavailable (no extension, SSR, older build).
  if (details === null) {
    throw new NetworkMismatchError(
      `Cannot verify wallet network before signing — refusing write to protect against cross-network signatures. ` +
      `Ensure ${networkDisplayName({ passphrase: null, name: targetNetwork })} is selected in your wallet.`,
      null,
    );
  }

  // A non-null error field means the API itself reported a failure.
  if (details.error) {
    throw new NetworkMismatchError(
      `Cannot verify wallet network before signing — refusing write to protect against cross-network signatures. ` +
      `Ensure ${networkDisplayName({ passphrase: null, name: targetNetwork })} is selected in your wallet.`,
      null,
    );
  }

  const walletPassphrase = details.networkPassphrase ?? '';
  const walletNetwork = details.network ?? null;

  const mismatch = detectNetworkMismatch(walletPassphrase, targetPassphrase, {
    targetNetwork,
    walletNetwork,
  });

  if (mismatch) {
    const walletName = networkDisplayName({
      passphrase: mismatch.walletPassphrase,
      name: mismatch.walletNetwork,
    });
    const targetName = networkDisplayName({
      passphrase: mismatch.targetPassphrase,
      name: mismatch.targetNetwork,
    });
    throw new NetworkMismatchError(
      `Your wallet is on ${walletName}, but this dashboard targets ${targetName}. ` +
      `Switch your wallet to ${targetName} in Freighter before signing.`,
      mismatch,
    );
  }
}
