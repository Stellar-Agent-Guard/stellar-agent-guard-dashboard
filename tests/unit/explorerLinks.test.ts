/**
 * The explorer link builder: network in, network out.
 *
 * Before this module every explorer link in the console was a template literal
 * ending `/explorer/testnet/`. That string was correct for the default build and
 * actively misleading for every other one, which is what these tests exist to pin:
 * a mainnet-configured console must produce a mainnet URL, and no configuration
 * at all may quietly produce a testnet one.
 *
 * Every case passes its network in explicitly rather than mutating
 * `process.env`. The assertions are therefore exact strings, and the file has no
 * ordering dependency on any other test or on the environment it happens to run
 * under — the determinism the composition is supposed to buy.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EXPLORER_BASE_URL,
  explorerAccountUrl,
  explorerContractUrl,
  explorerNetworkSegment,
  explorerTxUrl,
  type ExplorerNetwork,
} from "../../lib/guard/explorerLinks.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import {
  FUTURENET_PASSPHRASE,
  PUBLIC_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from "../../lib/guard/networkSwitch.ts";

const HASH = "bcd8eac52d6efb50eb2c8d7d9650493da9be7fe73b0be18a450282fa24006579";
const ACCOUNT = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";
const CONTRACT = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

/** Fixed configurations — the point of taking the network as an argument. */
const MAINNET: ExplorerNetwork = { name: "public", passphrase: PUBLIC_PASSPHRASE };
const TESTNET_CONFIG: ExplorerNetwork = { name: "testnet", passphrase: TESTNET_PASSPHRASE };
const FUTURENET: ExplorerNetwork = { name: "futurenet", passphrase: FUTURENET_PASSPHRASE };

describe("explorerNetworkSegment", () => {
  it("names mainnet the way the explorer spells it, from the passphrase", () => {
    // "public" is Mainnet's name everywhere else in this codebase. The one place
    // the explorer's own spelling has to win is its URL path.
    assert.equal(explorerNetworkSegment(MAINNET), "mainnet");
    assert.equal(explorerNetworkSegment(TESTNET_CONFIG), "testnet");
    assert.equal(explorerNetworkSegment(FUTURENET), "futurenet");
  });

  it("reads a bare name too, for a surface that only knows a network name", () => {
    assert.equal(explorerNetworkSegment({ name: "mainnet" }), "mainnet");
    assert.equal(explorerNetworkSegment({ name: "public" }), "mainnet");
    assert.equal(explorerNetworkSegment({ name: "testnet" }), "testnet");
  });

  it("prefers the passphrase when a name and a passphrase disagree", () => {
    // The passphrase is part of the transaction id, so it is the authority. A
    // mislabelled name must not be able to route a mainnet transaction to the
    // testnet explorer — that is the exact confusion this module removes.
    assert.equal(
      explorerNetworkSegment({ name: "testnet", passphrase: PUBLIC_PASSPHRASE }),
      "mainnet",
    );
  });

  it("slugs an unknown network instead of borrowing testnet", () => {
    // `scripts/deploy-local.ts` writes NEXT_PUBLIC_NETWORK_NAME="local" with a
    // standalone passphrase. That is the real shape of an unknown network, and
    // there is no public explorer page for it — so the honest options are "best
    // effort slug" or "a page that exists and shows the wrong network". Only one
    // of those two can mislead an operator, so the slug is the one that ships.
    const LOCAL: ExplorerNetwork = {
      name: "local",
      passphrase: "Standalone Network ; February 2017",
    };
    assert.equal(explorerNetworkSegment(LOCAL), "local");
    assert.equal(
      explorerNetworkSegment({ name: "Local Sandbox", passphrase: "Local Sandbox ; June 2026" }),
      "local-sandbox",
    );
    assert.equal(explorerNetworkSegment({ name: "" }), "unknown");
    assert.notEqual(explorerNetworkSegment(LOCAL), "testnet");
  });
});

describe("explorer transaction URLs", () => {
  it("a mainnet configuration produces a mainnet URL, exactly", () => {
    assert.equal(
      explorerTxUrl(HASH, MAINNET),
      `https://stellar.expert/explorer/mainnet/tx/${HASH}`,
    );
  });

  it("a testnet configuration produces a testnet URL, exactly", () => {
    assert.equal(
      explorerTxUrl(HASH, TESTNET_CONFIG),
      `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    );
  });

  it("futurenet is its own network, not a testnet alias", () => {
    assert.equal(
      explorerTxUrl(HASH, FUTURENET),
      `https://stellar.expert/explorer/futurenet/tx/${HASH}`,
    );
  });

  it("defaults to the configured network, so no call site can name a wrong one", () => {
    // The default argument is what makes omission safe: a call site that forgets
    // to pass a network still gets this build's network rather than a constant.
    assert.equal(explorerTxUrl(HASH), explorerTxUrl(HASH, NETWORK));
    assert.ok(
      explorerTxUrl(HASH).startsWith(`${EXPLORER_BASE_URL}/${explorerNetworkSegment(NETWORK)}/tx/`),
    );
  });
});

describe("explorer account and contract URLs", () => {
  it("an account is an account page, not a transaction page", () => {
    // The fleet table used to hand an account address to the transaction builder.
    // The URL it produced was well-formed and unresolvable, so the fix is having
    // a builder that cannot express the mistake.
    assert.equal(
      explorerAccountUrl(ACCOUNT, MAINNET),
      `https://stellar.expert/explorer/mainnet/account/${ACCOUNT}`,
    );
    assert.equal(
      explorerAccountUrl(ACCOUNT, TESTNET_CONFIG),
      `https://stellar.expert/explorer/testnet/account/${ACCOUNT}`,
    );
    assert.equal(explorerAccountUrl(ACCOUNT).includes("/tx/"), false);
  });

  it("a contract id is a contract page, on the same network as everything else", () => {
    assert.equal(
      explorerContractUrl(CONTRACT, MAINNET),
      `https://stellar.expert/explorer/mainnet/contract/${CONTRACT}`,
    );
    assert.equal(
      explorerContractUrl(CONTRACT, TESTNET_CONFIG),
      `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`,
    );
  });
});

describe("refusing to build a link from nothing", () => {
  it("an empty value throws rather than pointing at the network's home page", () => {
    // A missing receipt is not the network's front page. Silently producing a
    // 200 here would turn "we have no hash for this" into "here is a page", which
    // is the same address-without-context failure in a different costume.
    assert.throws(() => explorerTxUrl("", TESTNET_CONFIG), /empty value/);
    assert.throws(() => explorerAccountUrl("   ", TESTNET_CONFIG), /empty value/);
    assert.throws(() => explorerContractUrl("", TESTNET_CONFIG), /empty value/);
  });

  it("a value cannot add a path segment of its own", () => {
    // Chain data reaches this function, so the one interpolated position is
    // encoded. A traversal attempt comes out as one harmless segment.
    assert.equal(
      explorerTxUrl("../../mainnet/account/GA", TESTNET_CONFIG),
      "https://stellar.expert/explorer/testnet/tx/..%2F..%2Fmainnet%2Faccount%2FGA",
    );
  });

  it("surrounding whitespace is trimmed, so a copied value still links", () => {
    assert.equal(explorerTxUrl(`  ${HASH}\n`, TESTNET_CONFIG), explorerTxUrl(HASH, TESTNET_CONFIG));
  });
});

describe("no hardcoded network survives in a link", () => {
  it("every builder varies with the configuration, so none is a frozen template", () => {
    // The regression this replaces was a literal in the template. Asserting that
    // each builder's output actually *changes* with the network is what keeps a
    // future edit from reintroducing the constant behind a passing test.
    for (const build of [
      (network: ExplorerNetwork) => explorerTxUrl(HASH, network),
      (network: ExplorerNetwork) => explorerAccountUrl(ACCOUNT, network),
      (network: ExplorerNetwork) => explorerContractUrl(CONTRACT, network),
    ]) {
      assert.equal(build(MAINNET).includes("/mainnet/"), true);
      assert.equal(build(TESTNET_CONFIG).includes("/testnet/"), true);
      assert.notEqual(build(MAINNET), build(TESTNET_CONFIG));
    }
  });

  it("the source module itself holds no network path segment", () => {
    // A grep-level guard on the module: comments are stripped first (the prose
    // around the fix has to be able to *name* `/explorer/testnet/` while the code
    // that builds a URL cannot contain it), so what is left is code only. The
    // mapping table's bare values are the one network literal allowed to remain,
    // because that table is what decides the segment rather than freezing one.
    const stripComments = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    const code = stripComments(
      readFileSync(new URL("../../lib/guard/explorerLinks.ts", import.meta.url), "utf8"),
    );
    assert.equal(
      /explorer\/testnet|explorer\/mainnet/.test(code),
      false,
      "explorerLinks.ts must compose the path, never write a network into it",
    );
  });
});
