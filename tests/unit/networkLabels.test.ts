/**
 * Per-display network labels (issue #202).
 *
 * The global network lives in the header, but the header scrolls away: an
 * operator reading a deploy result, a status block or a fleet row must see which
 * network that value belongs to *at that value*. These tests cover the two
 * halves of "the label is actually there":
 *
 *   - Rendered: `NetworkBadge`, `AddressText` and `TxHashCell` put the network
 *     word in the DOM next to the address/hash, and carry it as `data-network`
 *     for machine reads.
 *   - Adopted (grep): each network-touching site actually renders the badge, and
 *     the shared style primitive exists — a label that no panel shows, or that
 *     has no style, is not the feature.
 *
 * The `data-network` contract is the important one: the visible text is for the
 * human, the attribute is for the test, so neither has to parse the other.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { AddressText, NetworkBadge, TxHashCell, starContractLink } from "../../components/bits.tsx";
import { NETWORK } from "../../lib/guard/network.ts";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

beforeEach(() => {
  document.body.innerHTML = "";
});

async function renderElement(element: ReactElement): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(host);
    root.render(element);
  });
  return {
    host,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      host.remove();
    },
  };
}

const ADDRESS = "GDD5KX7Q4YVZ5C4EXFQZ5OUV5Y4C4EXFQZ5OUV5Y4C4EXFQZ5OUV5Y4C4";
const HASH = "bcd8eac52d6efb50eb2c8d7d9650493da9be7fe73b0be18a450282fa24006579";
const CONTRACT = "CC6VDBH5M473O4XUPD5GNRVIPB6CJ4U6IZCITF7XLKNLMWZPP3U5BMTK";

// ── The badge itself ────────────────────────────────────────────────────────

test("NetworkBadge renders the network word and carries it as data-network", async () => {
  const rendered = await renderElement(react.createElement(NetworkBadge));
  try {
    const chip = rendered.host.querySelector(".network-chip");
    assert.ok(chip, "the badge must render a .network-chip element");
    assert.equal(chip?.textContent, "testnet");
    assert.equal(chip?.getAttribute("data-network"), "testnet");
  } finally {
    await rendered.unmount();
  }
});

test("NetworkBadge follows an explicit network, mapping public → mainnet", async () => {
  const mainnet = await renderElement(react.createElement(NetworkBadge, { network: "mainnet" }));
  try {
    assert.equal(mainnet.host.textContent, "mainnet");
    assert.equal(
      mainnet.host.querySelector(".network-chip")?.getAttribute("data-network"),
      "mainnet",
    );
  } finally {
    await mainnet.unmount();
  }

  const publicAlias = await renderElement(react.createElement(NetworkBadge, { network: "public" }));
  try {
    assert.equal(
      publicAlias.host.textContent,
      "mainnet",
      "the provider's `public` spelling is shown to the operator as `mainnet`",
    );
  } finally {
    await publicAlias.unmount();
  }
});

// ── Co-presence: the label travels with the value ───────────────────────────

test("AddressText co-locates the operator address and the network label", async () => {
  const rendered = await renderElement(react.createElement(AddressText, { address: ADDRESS }));
  try {
    const text = rendered.host.textContent ?? "";
    assert.match(text, /GDD5/, "the truncated address must render");
    assert.match(text, /testnet/, "the network label must render next to the address");
    assert.ok(
      rendered.host.querySelector(".network-chip"),
      "AddressText must include the network chip",
    );
  } finally {
    await rendered.unmount();
  }
});

test("TxHashCell co-locates the transaction link and the network label", async () => {
  const rendered = await renderElement(react.createElement(TxHashCell, { hash: HASH }));
  try {
    const link = rendered.host.querySelector("a");
    assert.ok(link, "the hash must be a link");
    assert.equal(link?.getAttribute("href"), `https://stellar.expert/explorer/testnet/tx/${HASH}`);
    assert.equal(
      link?.getAttribute("href"),
      `https://stellar.expert/explorer/${NETWORK.name}/tx/${HASH}`,
    );
    assert.match(rendered.host.textContent ?? "", /testnet/);
    assert.ok(rendered.host.querySelector(".network-chip"));
  } finally {
    await rendered.unmount();
  }
});

test("a contract id links to the contract explorer path, not the transaction path", async () => {
  const rendered = await renderElement(react.createElement("span", null, starContractLink(CONTRACT)));
  try {
    const href = rendered.host.querySelector("a")?.getAttribute("href");
    assert.equal(href, `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`);
    assert.doesNotMatch(href ?? "", /\/tx\//);
  } finally {
    await rendered.unmount();
  }
});

// ── Adopted on every network-touching site (grep-verified) ──────────────────

const LABEL_SITES: Array<{ file: string; what: string }> = [
  { file: "components/DeployPanel.tsx", what: "predicted + deployed guard address" },
  { file: "components/StatusPanel.tsx", what: "on-chain state header / guard address" },
  { file: "components/TelemetryFeed.tsx", what: "telemetry feed" },
  { file: "components/TxHistoryTable.tsx", what: "transaction history" },
  { file: "components/FleetTable.tsx", what: "fleet contract ids" },
  { file: "components/bits.tsx", what: "AddressText / TxHashCell" },
];

test("every network-touching display renders NetworkBadge (grep-verified)", () => {
  for (const site of LABEL_SITES) {
    const source = readFileSync(site.file, "utf8");
    assert.match(
      source,
      /NetworkBadge/,
      `${site.file} must render NetworkBadge (${site.what})`,
    );
  }
});

test("the fleet table links contract ids with the contract path", () => {
  const fleet = readFileSync("components/FleetTable.tsx", "utf8");
  assert.match(fleet, /starContractLink\(/, "fleet contract ids must use the contract link");
  assert.doesNotMatch(
    fleet,
    /starLink\(/,
    "fleet ids are contracts, not transactions — the tx link was the wrong explorer page",
  );
});

// ── The shared style primitive exists ───────────────────────────────────────

test("the network chip has a single shared style home", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.network-chip \{/, "the .network-chip primitive must exist");
  assert.match(css, /\.address-with-network \{/, "the address wrapper must lay out cleanly");
});

// ── README clause (documented behaviour, both directions) ───────────────────

test("README documents per-display network labels", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(
    readme,
    /Per-display network labels/,
    "the README feature list must describe the per-display labels",
  );
  assert.match(
    readme,
    /explorer links are composed from the configured network/,
    "the README must state the links compose from config, not a hardcoded testnet",
  );
});
