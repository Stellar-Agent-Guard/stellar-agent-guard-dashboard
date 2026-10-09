/**
 * Explorer links that name the network they belong to.
 *
 * Every explorer link this console builds used to hardcode `/explorer/testnet/`.
 * That is correct for the default build and silently wrong for every other one:
 * an operator who points the dashboard at Mainnet, or boots it against the local
 * sandbox from `scripts/start-local-sandbox.sh`, gets a link that opens a *testnet*
 * page — which answers "not found" for a transaction that plainly landed. A wrong
 * explorer page does not merely fail to help, it actively reads as "this did not
 * happen".
 *
 * So the network segment is composed from the same configuration the RPC endpoint
 * comes from (`NETWORK` in `network.ts`) rather than written into the template.
 * A link can then only name a network the console is actually talking to, which
 * is the same one the wallet-mismatch check (#97) and the signed transaction's
 * network id are derived from.
 *
 * Every builder takes the network as an argument instead of reading `NETWORK`
 * internally. That is what lets a test assert an exact URL for a fixed config —
 * mainnet config in, mainnet URL out — with no build-time environment variable
 * and therefore no ordering dependency between test files.
 */

/**
 * Stellar Expert's explorer root. Public and stable; only the path beneath it
 * varies by network, which is the part this module owns.
 */
import { NETWORK } from "./network.ts";
import { FUTURENET_PASSPHRASE, PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE } from "./networkSwitch.ts";

export const EXPLORER_BASE_URL = "https://stellar.expert/explorer";

/** The minimum a builder needs to know to name a network. */
export interface ExplorerNetwork {
  /** Short provider-flavoured name, e.g. `testnet`. */
  name: string;
  /**
   * The full Stellar network passphrase. Authoritative, unlike the name. Optional
   * only so a surface holding a bare network *name* — a fleet row, a saved
   * instance's own network — can link for the network it is describing instead of
   * for the one the build happens to be pointed at.
   */
  passphrase?: string;
}

/**
 * Path segments for the networks Stellar Expert names the way this project does.
 *
 * Keyed on the *canonical* network identity the rest of the dashboard already
 * uses: "public" is how Mainnet is named everywhere else in this codebase, and
 * the explorer's spelling of it is the one place "mainnet" is correct. The three
 * public passphrases are imported from `networkSwitch.ts` rather than re-typed
 * here so the wording cannot drift — a passphrase is part of a signature, and a
 * second copy is a second thing to get wrong.
 *
 * `standalone` is deliberately absent, and so is any private network: a local
 * standalone node has no public explorer page at all, so there is no segment that
 * would be *right*. The fallback below produces a best-effort slug and says so in
 * its own comment rather than pretending a page exists.
 */
const SEGMENT_BY_CANONICAL_NAME: Readonly<Record<string, string>> = {
  testnet: "testnet",
  public: "mainnet",
  futurenet: "futurenet",
};

/**
 * Name aliases, mirroring the entries of `NETWORK_ALIASES` in
 * `walletConnector.ts` that name a network the explorer has a page for.
 *
 * Deliberately a subset: `standalone` is in that map and absent here, because
 * there is no segment for it. This is the *fallback* path only — reached when a
 * caller has a name but no passphrase — and the passphrase path above always wins
 * when both are present, so a build that configures both can never end up here.
 */
const CANONICAL_BY_NAME: Readonly<Record<string, string>> = {
  testnet: "testnet",
  testing: "testnet",
  public: "public",
  mainnet: "public",
  futurenet: "futurenet",
};

/** Canonical name for a network, preferring the passphrase over the name. */
function canonicalNameFor(passphrase: string | undefined, name: string): string {
  const trimmed = (passphrase ?? "").trim();
  if (trimmed === PUBLIC_PASSPHRASE) return "public";
  if (trimmed === TESTNET_PASSPHRASE) return "testnet";
  if (trimmed === FUTURENET_PASSPHRASE) return "futurenet";
  // A passphrase we do not recognise (a private network's own) still carries the
  // operator's name, so the name is the best remaining signal. An empty name and
  // an unrecognised passphrase resolve to "" here, which `explorerNetworkSegment`
  // turns into "unknown" rather than into a guess.
  const lower = name.trim().toLowerCase();
  return CANONICAL_BY_NAME[lower] ?? lower;
}

/**
 * A URL-safe path segment for a network.
 *
 * Falls back to a slug of the configured name when the passphrase is not one of
 * the three public ones — a private network, or the local sandbox. That slug is a
 * best effort: the explorer may have no page for it, in which case the link 404s
 * honestly. The alternative, silently reusing `testnet`, would produce a page
 * that exists and shows a *different* network, which is the failure this module
 * exists to remove.
 */
export function explorerNetworkSegment(network: ExplorerNetwork): string {
  const canonical = canonicalNameFor(network.passphrase, network.name);
  const known = SEGMENT_BY_CANONICAL_NAME[canonical];
  if (known) return known;
  const slug = canonical.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? "unknown" : slug;
}

function explorerUrl(
  kind: "tx" | "account" | "contract",
  value: string,
  network: ExplorerNetwork,
): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    // An empty value is a missing receipt, not a link to the network's home page.
    throw new Error(`Cannot build an explorer ${kind} link from an empty value.`);
  }
  // Encoded rather than interpolated: the path segment is the one place a value
  // from chain data could otherwise add a segment of its own.
  return `${EXPLORER_BASE_URL}/${explorerNetworkSegment(network)}/${kind}/${encodeURIComponent(trimmed)}`;
}

/** The explorer's page for one transaction on this network. */
export function explorerTxUrl(hash: string, network: ExplorerNetwork = NETWORK): string {
  return explorerUrl("tx", hash, network);
}

/**
 * The explorer's page for one account on this network.
 *
 * A G... address is not a transaction, and this is the builder that says so: the
 * fleet table used to hand an account address to the transaction builder, which
 * produced a well-formed URL under `/tx/` that can only ever 404.
 */
export function explorerAccountUrl(address: string, network: ExplorerNetwork = NETWORK): string {
  return explorerUrl("account", address, network);
}

/** The explorer's page for one contract on this network. */
export function explorerContractUrl(
  contractId: string,
  network: ExplorerNetwork = NETWORK,
): string {
  return explorerUrl("contract", contractId, network);
}
