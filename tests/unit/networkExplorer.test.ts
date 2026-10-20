/**
 * Network-aware explorer links (issue #202).
 *
 * The defect this covers is a link, not a look: `starLink` hardcoded the
 * `testnet` explorer path, so a Mainnet transaction looked up from a Mainnet
 * build landed on a Testnet page that said "not found". The builder now composes
 * the path from this build's configuration, and these tests pin the exact URL
 * shape for a fixed config rather than reading the environment — so a change to
 * the default network or to the path mapping fails here, not in production.
 *
 * The second half is the mechanical grep the acceptance criteria ask for: no
 * component may hardcode a network in a link again, because the next one would
 * reintroduce exactly the cross-network confusion this issue removes.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  EXPLORER_BASE_URL,
  explorerContractUrl,
  explorerNetworkSlug,
  explorerTxUrl,
  isMainnet,
  networkDisplayLabel,
} from "../../lib/guard/network.ts";

const HASH = "bcd8eac52d6efb50eb2c8d7d9650493da9be7fe73b0be18a450282fa24006579";
const CONTRACT = "CC6VDBH5M473O4XUPD5GNRVIPB6CJ4U6IZCITF7XLKNLMWZPP3U5BMTK";

test("explorer paths: Mainnet is stellar.expert's `public`, Testnet is `testnet`", () => {
  assert.equal(explorerNetworkSlug("testnet"), "testnet");
  assert.equal(explorerNetworkSlug("mainnet"), "public");
  assert.equal(explorerNetworkSlug("public"), "public");
  assert.equal(explorerNetworkSlug("Mainnet"), "public");
  assert.equal(explorerNetworkSlug("futurenet"), "futurenet");
  // A local standalone network has no public explorer; the link still resolves
  // rather than 404ing on an invented path.
  assert.equal(explorerNetworkSlug("standalone"), "testnet");
});

test("a Testnet config builds a Testnet transaction URL (exact string)", () => {
  assert.equal(
    explorerTxUrl(HASH, "testnet"),
    `https://stellar.expert/explorer/testnet/tx/${HASH}`,
  );
});

test("a Mainnet config builds a Mainnet (public) transaction URL (exact string)", () => {
  assert.equal(
    explorerTxUrl(HASH, "mainnet"),
    `https://stellar.expert/explorer/public/tx/${HASH}`,
  );
  assert.equal(
    explorerTxUrl(HASH, "public"),
    `https://stellar.expert/explorer/public/tx/${HASH}`,
  );
});

test("the default config is this build's network, so call sites pass no argument", () => {
  // The unit suite runs with the default testnet config; the default argument
  // must therefore produce the testnet path without the caller naming it.
  assert.equal(explorerTxUrl(HASH), `${EXPLORER_BASE_URL}/testnet/tx/${HASH}`);
  assert.equal(explorerContractUrl(CONTRACT), `${EXPLORER_BASE_URL}/testnet/contract/${CONTRACT}`);
});

test("contract ids get the contract path, not the transaction path", () => {
  assert.equal(
    explorerContractUrl(CONTRACT, "testnet"),
    `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`,
  );
  assert.equal(
    explorerContractUrl(CONTRACT, "mainnet"),
    `https://stellar.expert/explorer/public/contract/${CONTRACT}`,
  );
  assert.notEqual(explorerContractUrl(CONTRACT, "mainnet"), explorerTxUrl(CONTRACT, "mainnet"));
});

test("isMainnet names the public network and nothing else", () => {
  assert.equal(isMainnet("mainnet"), true);
  assert.equal(isMainnet("public"), true);
  assert.equal(isMainnet("testnet"), false);
  assert.equal(isMainnet("futurenet"), false);
  assert.equal(isMainnet("standalone"), false);
});

test("the display label maps provider spellings onto the operator's word", () => {
  assert.equal(networkDisplayLabel("testnet"), "testnet");
  assert.equal(networkDisplayLabel("mainnet"), "mainnet");
  assert.equal(networkDisplayLabel("public"), "mainnet");
  assert.equal(networkDisplayLabel("futurenet"), "futurenet");
  assert.equal(networkDisplayLabel("standalone"), "standalone");
  assert.equal(networkDisplayLabel("some-private-net"), "some-private-net");
  assert.equal(networkDisplayLabel(""), "unknown");
});

// ── Mechanical grep: no network is hardcoded in a link ──────────────────────

function sourcesIn(...dirs: string[]): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      found.push({ path: path.replace(/\\/g, "/"), text: readFileSync(path, "utf8") });
    }
  };
  for (const dir of dirs) walk(dir);
  return found;
}

test("only network.ts knows the explorer base URL — components compose from config", () => {
  const sources = sourcesIn("components", "lib/guard");
  for (const file of sources) {
    if (file.path === "lib/guard/network.ts") continue;
    assert.equal(
      file.text.includes("stellar.expert"),
      false,
      `${file.path} hardcodes the explorer host; it must use explorerTxUrl/explorerContractUrl`,
    );
    assert.equal(
      /explorer\/(testnet|public|futurenet)\//.test(file.text),
      false,
      `${file.path} hardcodes an explorer network path; the network must come from config`,
    );
  }
});
