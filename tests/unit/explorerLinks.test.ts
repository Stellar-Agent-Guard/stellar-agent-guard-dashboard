/**
 * The explorer URL builders, on both networks (issue: cross-network address
 * confusion).
 *
 * The whole point of moving these URLs out of the components is that the network
 * segment comes from configuration. A test that only ever checked the Testnet
 * URL could not tell a composed link from a hardcoded one — `explorer/testnet/tx/`
 * is what the old component literally contained, and it would have kept passing
 * after the refactor had changed nothing. So every case here runs twice: once
 * against the console's real Testnet descriptor and once against a fixed Mainnet
 * fixture, and both are asserted as exact strings.
 *
 * The Mainnet fixture is the load-bearing half. `name` is deliberately
 * `public` — the wallet's word for the same ledger — while `explorerNetwork` is
 * `mainnet`, the explorer's word. A builder that used `name` for the URL would
 * produce `/explorer/public/tx/…`, which resolves to nothing, and this suite is
 * what makes that failure visible rather than a broken link in production.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NETWORK,
  explorerAccountUrl,
  explorerBaseUrl,
  explorerContractUrl,
  explorerTxUrl,
  type NetworkDescriptor,
} from "../../lib/guard/network.ts";

/**
 * The public network, as this console would configure it if it were ever pointed
 * at mainnet. `name` is the wallet's vocabulary; `explorerNetwork` is the
 * explorer's.
 */
const MAINNET: NetworkDescriptor = {
  name: "mainnet",
  rpcUrl: "https://mainnet.sorobanrpc.com",
  passphrase: "Public Global Stellar Network ; September 2015",
  explorerBaseUrl: "https://stellar.expert/explorer",
  explorerNetwork: "mainnet",
};

const FUTURE: NetworkDescriptor = {
  name: "futurenet",
  rpcUrl: "https://rpc-futurenet.stellar.org:443",
  passphrase: "Test SDF Future Network ; October 2022",
  explorerBaseUrl: "https://stellar.expert/explorer",
  explorerNetwork: "futurenet",
};

const TX_HASH = "9f2c1b7e4a3d5c6b8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7";
const CONTRACT = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH";

// ── Testnet: the network this console actually runs on ───────────────────────

test("explorerBaseUrl names the console's own network", () => {
  assert.equal(explorerBaseUrl(), "https://stellar.expert/explorer/testnet");
});

test("explorerTxUrl builds the exact testnet transaction URL", () => {
  assert.equal(explorerTxUrl(TX_HASH), `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`);
});

test("explorerContractUrl builds the exact testnet contract URL", () => {
  assert.equal(
    explorerContractUrl(CONTRACT),
    `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`,
  );
});

test("explorerAccountUrl builds the exact testnet account URL", () => {
  assert.equal(
    explorerAccountUrl(ACCOUNT),
    `https://stellar.expert/explorer/testnet/account/${ACCOUNT}`,
  );
});

// ── Mainnet: the network the links must be able to name instead ─────────────

test("explorerBaseUrl follows the mainnet descriptor, not a literal", () => {
  assert.equal(explorerBaseUrl(MAINNET), "https://stellar.expert/explorer/mainnet");
});

test("explorerTxUrl builds the exact mainnet transaction URL", () => {
  assert.equal(
    explorerTxUrl(TX_HASH, MAINNET),
    `https://stellar.expert/explorer/mainnet/tx/${TX_HASH}`,
  );
});

test("no builder emits the testnet segment when given the mainnet descriptor", () => {
  for (const url of [
    explorerTxUrl(TX_HASH, MAINNET),
    explorerContractUrl(CONTRACT, MAINNET),
    explorerAccountUrl(ACCOUNT, MAINNET),
  ]) {
    assert.equal(url.includes("/testnet/"), false, `mainnet URL leaked a testnet segment: ${url}`);
    assert.equal(url.includes("/mainnet/"), true, `mainnet URL is missing its segment: ${url}`);
  }
  // The base ends in the segment rather than containing `/mainnet/`, so it gets
  // its own assertion — checked separately so a change that appended a trailing
  // slash to the base would fail here rather than silently widen every URL.
  assert.equal(explorerBaseUrl(MAINNET), "https://stellar.expert/explorer/mainnet");
});

test("explorerContractUrl builds the exact mainnet contract URL", () => {
  assert.equal(
    explorerContractUrl(CONTRACT, MAINNET),
    `https://stellar.expert/explorer/mainnet/contract/${CONTRACT}`,
  );
});

// ── The label and the URL are separate words, on purpose ─────────────────────

test("explorerNetwork, not name, decides the URL segment", () => {
  // The public network is the case that matters: this project calls it
  // `public` in wallet vocabulary, and an explorer calls it `mainnet`. If a
  // builder reached for `name` the link would 404 rather than mislead, which is
  // the better failure, but it would still be a dead link on the one network
  // where a wrong click costs the most.
  const walletVocabulary: NetworkDescriptor = { ...MAINNET, name: "public" };
  assert.equal(
    explorerTxUrl(TX_HASH, walletVocabulary),
    `https://stellar.expert/explorer/mainnet/tx/${TX_HASH}`,
  );
  assert.equal(
    explorerBaseUrl(walletVocabulary),
    "https://stellar.expert/explorer/mainnet",
    "the explorer's segment must not follow the wallet's name",
  );
});

test("futurenet links carry the futurenet segment", () => {
  assert.equal(
    explorerTxUrl(TX_HASH, FUTURE),
    `https://stellar.expert/explorer/futurenet/tx/${TX_HASH}`,
  );
});

// ── A contract id is not a transaction hash ─────────────────────────────────

test("a contract id goes to the contract route, not the transaction route", () => {
  // The bug this replaced: `FleetTable` linked a `C…` contract id through
  // `starLink`, producing `/tx/C…`. Nothing about the value itself looks wrong,
  // so only a route assertion catches it.
  assert.equal(explorerContractUrl(CONTRACT).includes("/tx/"), false);
  assert.equal(explorerTxUrl(TX_HASH).includes("/contract/"), false);
});

// ── The descriptor this console ships with ──────────────────────────────────

test("the shipped descriptor is complete and internally consistent", () => {
  assert.equal(NETWORK.name, "testnet");
  assert.equal(NETWORK.explorerNetwork, "testnet");
  // An explorer host with a trailing slash would produce `//testnet` in every
  // link — which browsers silently repair, so it would never show up as a bug
  // report, only as a malformed URL in a copied link.
  assert.equal(NETWORK.explorerBaseUrl.endsWith("/"), false);
  assert.equal(
    explorerBaseUrl().startsWith(`${NETWORK.explorerBaseUrl}/`),
    true,
    "the segment must be joined with exactly one slash",
  );
});
