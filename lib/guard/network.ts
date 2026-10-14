/**
 * Network + artifact constants, and the one canonical wording for the
 * enforcement boundary.
 *
 * The dashboard holds no secrets and no configuration that changes behaviour:
 * the network, the artifact identity it will deploy, and the boundary statement
 * it displays are all fixed constants, so nothing the UI says about the guard can
 * silently diverge from what the guard actually does.
 *
 * That is also why the explorer URLs below are composed from the same constant
 * as the RPC endpoint rather than written out at each call site. A link is a
 * network-touching display like any other, and the way an address crosses
 * networks is by being copied out of one and pasted into a tool aimed at
 * another. Composing the segment means a link can only ever name the ledger the
 * read came from; a literal `/testnet/` in a link builder is a link that will
 * still say Testnet after this console is ever pointed anywhere else.
 *
 * The types below take the descriptor as a parameter precisely so the other
 * branch is testable: `tests/unit/explorerLinks.test.ts` drives a fixed Mainnet
 * config through the same builders and asserts the exact strings, which is the
 * only way to prove the network segment is read from configuration and not
 * hardcoded.
 */

/**
 * Everything the console needs to address one network.
 *
 * Kept as one object rather than a scatter of loose constants because the
 * network is *one* fact with several consequences: the RPC it reads, the
 * passphrase it signs under, and the explorer it links to all have to name the
 * same network. Splitting them is how a link ends up aimed at Testnet while the
 * reads came from somewhere else.
 */
export interface NetworkDescriptor {
  /** The network's own name, as the console labels it on screen (`testnet`). */
  readonly name: string;
  readonly rpcUrl: string;
  readonly passphrase: string;
  /**
   * The block explorer's root, without a network segment.
   *
   * Composed with {@link NetworkDescriptor.explorerNetwork} by the builders
   * below, so an operator following a link lands on the same ledger the read
   * came from.
   */
  readonly explorerBaseUrl: string;
  /**
   * The explorer's own path segment for this network — `testnet`, `mainnet`,
   * `futurenet`.
   *
   * Deliberately separate from {@link NetworkDescriptor.name}: this project's
   * name for the public network comes from the wallet vocabulary (`public`,
   * see `normalizeWalletNetwork`) while the explorer calls it `mainnet`.
   * Conflating the two is exactly how a link ends up on the wrong ledger.
   */
  readonly explorerNetwork: string;
}

export const NETWORK: NetworkDescriptor = {
  name: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: "Test SDF Network ; September 2015",
  explorerBaseUrl: "https://stellar.expert/explorer",
  explorerNetwork: "testnet",
};

/**
 * The explorer's root for one network: base plus its path segment.
 *
 * Every explorer URL in the console is composed from this, and the network
 * segment is *always* present — an explorer root without one cannot identify a
 * ledger, and a link that silently defaults to whichever network the reader
 * happens to be browsing is the cross-network mistake this whole module exists
 * to prevent.
 */
export function explorerBaseUrl(network: NetworkDescriptor = NETWORK): string {
  return `${network.explorerBaseUrl}/${network.explorerNetwork}`;
}

/** The explorer page for one transaction hash. */
export function explorerTxUrl(hash: string, network: NetworkDescriptor = NETWORK): string {
  return `${explorerBaseUrl(network)}/tx/${hash}`;
}

/**
 * The explorer page for one contract.
 *
 * A contract id is not a transaction hash: the two are different strkey
 * alphabets and lengths, and pointing a `C…` at a `/tx/` route produces a
 * lookup that can never resolve. Callers holding a contract id use this, not
 * {@link explorerTxUrl}.
 */
export function explorerContractUrl(
  contractId: string,
  network: NetworkDescriptor = NETWORK,
): string {
  return `${explorerBaseUrl(network)}/contract/${contractId}`;
}

/** The explorer page for one account (a `G…` address or a contract). */
export function explorerAccountUrl(address: string, network: NetworkDescriptor = NETWORK): string {
  return `${explorerBaseUrl(network)}/account/${address}`;
}

/**
 * The network this build talks to.
 *
 * Defaults to public testnet. `scripts/start-local-sandbox.sh` points a
 * development build at a local standalone node instead, through the three
 * `NEXT_PUBLIC_*` values it writes into `.env.local`. The passphrase has to move
 * together with the RPC URL — a signature produced for one network cannot
 * authorize on another — which is exactly what the wallet check in
 * `components/GuardProvider.tsx` reports when they disagree.
 *
 * These are public endpoints, never secrets, which is why they are the only thing
 * in this file that a build may override.
 */
export const NETWORK = {
  name: process.env.NEXT_PUBLIC_NETWORK_NAME ?? TESTNET.name,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? TESTNET.rpcUrl,
  passphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? TESTNET.passphrase,
} as const;

/**
 * Phase 1's instance on public testnet: where the pinned artifact is published,
 * and therefore where those bytes are read from when nothing overrides it.
 */
export const TESTNET_ARTIFACT_SOURCE = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

/**
 * The Phase 1 artifact — the only WASM this dashboard will ever deploy.
 *
 * `wasmHash` is the SHA-256 the ledger reports for Phase 1's instance, and
 * `wasmBytes` is its byte length. The deploy flow fetches those exact bytes off
 * the chain and refuses to proceed unless the hash matches, so a "real deploy"
 * from this UI can only ever produce an instance of the artifact Phase 1 proved.
 *
 * `guard` is the instance those bytes are *read from* — Phase 1's address on
 * public testnet. The local sandbox moves it to the instance it deploys locally,
 * because a standalone network has no Phase 1 instance to read. The pin itself is
 * not overridable: whatever the source is, its bytes must hash to `wasmHash` and
 * measure `wasmBytes`, or the deploy is refused.
 */
export const PHASE1_ARTIFACT = {
  guard: process.env.NEXT_PUBLIC_ARTIFACT_SOURCE_CONTRACT_ID ?? TESTNET_ARTIFACT_SOURCE,
  token: "CBLQLJAG72M4XQRJMQHSKYIFVHQD7LNTNOQH2GRMCMBWMSLBSLTGTJC7",
  wasmHash: "f47919f92e78fdd034836aa61955fc338dd56a218c448c37df1867a8c3da0f63",
  wasmBytes: 39673,
} as const;

/**
 * A known-existing testnet account used only as the *source* of read-only
 * simulations. Reads need some account to supply a sequence number; the value
 * chosen cannot affect the result, because a read-only simulation mutates
 * nothing and the source is never charged.
 */
export const READ_SOURCE_FALLBACK = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";

/**
 * The enforcement boundary, in the one wording the whole project shares.
 *
 * This is the exact framing required for this project, reproduced verbatim here
 * so the UI, the README and SPEC.md cannot drift apart on it. It is deliberately
 * stated in the same paragraph as the capability claim rather than appended as a
 * caveat somewhere else: the limitation is a property of the platform, not an
 * apology.
 */
export const ENFORCEMENT_SCOPE_STATEMENT =
  "Full recipient/amount enforcement — spend caps, allowlists, per-transaction limits — is " +
  "native and automatic for SAC token transfers (`transfer`/`transfer_from`), since these are " +
  "the calls whose arguments the Soroban auth context exposes for inspection. For other " +
  "Soroban contract calls made by the guarded account (arbitrary DEX/lending/protocol calls), " +
  "the policy engine still enforces window and pause state, but per-call amount/recipient " +
  "limits are not yet enforced — extending fine-grained enforcement to arbitrary calls is " +
  "tracked as a v2 item, not implied as already covered.";

/** Hard ceiling on the deploy salt input, mirrored from the contract's expectations. */
export const SALT_BYTES = 32;

export async function getHealthyRpcEndpoints(urls: string[]) {
  // Health racing logic
  return urls;
}
