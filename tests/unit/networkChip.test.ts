/**
 * The per-display network chip, and every display that has to carry one
 * (issue: cross-network address confusion).
 *
 * Two jobs, deliberately in one file because the second is what makes the first
 * trustworthy:
 *
 * 1. `NetworkChip` renders the *configured* network's name. The Mainnet fixture
 *    is what proves the word on screen is read from configuration — a chip that
 *    simply said `testnet` would satisfy a Testnet-only assertion while being
 *    exactly the bug this change exists to prevent.
 *
 * 2. Every render site names its network beside the value. Those cases assert
 *    the chip and the exact address or hash appear in the *same* subtree, so a
 *    chip rendered somewhere else on the page cannot satisfy them. That is the
 *    difference between "the panel has a network label" and "the operator knows
 *    which ledger this id is from".
 *
 * The addresses are real strkey values, not placeholders: the assertions match on
 * the exact string the component renders, so a fixture that stopped resembling a
 * contract id would fail loudly rather than quietly test nothing.
 */
import assert from "node:assert/strict";
import { test, before, afterEach } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { NetworkChip } from "../../components/NetworkChip.tsx";
import { starLink, contractLink, TxHashCell, OutcomeList } from "../../components/bits.tsx";

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

afterEach(() => {
  document.body.innerHTML = "";
});

const CONTRACT = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const CONTRACT_B = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const ADMIN = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH";
const TX_HASH = "9f2c1b7e4a3d5c6b8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7";

const MAINNET = {
  name: "mainnet",
  rpcUrl: "https://mainnet.sorobanrpc.com",
  passphrase: "Public Global Stellar Network ; September 2015",
  explorerBaseUrl: "https://stellar.expert/explorer",
  explorerNetwork: "mainnet",
};

interface Rendered {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function render(element: ReactElement): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await act(async () => {
    await sleep(0);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function withRender(
  element: ReactElement,
  body: (container: HTMLElement) => void | Promise<void>,
): Promise<void> {
  const rendered = await render(element);
  try {
    await body(rendered.container);
  } finally {
    await rendered.unmount();
  }
}

/** Every chip in the render. */
function chips(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-testid='network-chip']")];
}

/**
 * The one chip a render is expected to contain.
 *
 * Asserting the count as well as returning it matters here: a component that
 * silently rendered two labels would otherwise satisfy every "the chip says X"
 * assertion while an operator saw a doubled label.
 */
function onlyChip(container: HTMLElement): HTMLElement {
  const found = chips(container);
  assert.equal(found.length, 1, `expected exactly one network chip, found ${found.length}`);
  return found[0] as HTMLElement;
}

/** The href of the render's single link, asserted present. */
function onlyHref(container: HTMLElement): string {
  const href = container.querySelector("a")?.getAttribute("href");
  assert.ok(href, "expected the render to contain a link");
  return href;
}

/**
 * Whether an element *displays* a value — as text, as a `title`, or inside a
 * link target.
 *
 * All three, because the console shortens ids for display: `starLink` shows
 * `9f2c1b7e4a…5e6f7` and carries the full hash in the `href`, so a test matching
 * on visible text alone would not find the value at all. Matching the exact
 * string wherever it is rendered is also the point: the assertion is about this
 * specific address or hash, not about "an address".
 */
function carriesValue(el: HTMLElement, value: string): boolean {
  return (
    (el.textContent?.includes(value) ?? false) ||
    (el.getAttribute("title")?.includes(value) ?? false) ||
    (el.getAttribute("href")?.includes(value) ?? false)
  );
}

/**
 * Assert a value and a chip share one subtree — the smallest unit the operator
 * actually reads.
 *
 * The walk stops *below* the render container on purpose. If it stopped at the
 * container, a single chip anywhere in the render would label every value on
 * the page, and the whole point is that the label sits next to the value: an
 * operator reading the deploy result has the status block's network label in
 * view whether or not they can see one next to the address in front of them.
 */
const CHIP = "[data-testid='network-chip']";

function assertLabelled(container: HTMLElement, value: string, context: string): void {
  const carriers = [...container.querySelectorAll<HTMLElement>("*")].filter((el) =>
    carriesValue(el, value),
  );
  assert.notEqual(carriers.length, 0, `${context}: nothing renders ${value}`);
  const labelled = carriers.some((el) => {
    if (el.querySelector(CHIP)) return true;
    for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
      if (node.querySelector(CHIP)) return true;
    }
    return false;
  });
  assert.equal(
    labelled,
    true,
    `${context}: ${value} is rendered but no network label sits beside it`,
  );
}

// ── The chip names the configured network ───────────────────────────────────

test("NetworkChip shows the console's configured network", async () => {
  await withRender(react.createElement(NetworkChip), (container) => {
    assert.equal(onlyChip(container).textContent, "testnet");
    assert.equal(onlyChip(container).dataset.network, "testnet");
  });
});

test("NetworkChip shows the other network when configured for it", async () => {
  // Without this, "the chip says testnet" is unfalsifiable: the word could be
  // baked into the markup and every other case here would still pass.
  await withRender(react.createElement(NetworkChip, { network: MAINNET }), (container) => {
    assert.equal(onlyChip(container).textContent, "mainnet");
    assert.equal(onlyChip(container).dataset.network, "mainnet");
  });
});

test("NetworkChip's title explains what the label is for", async () => {
  await withRender(react.createElement(NetworkChip), (container) => {
    const title = onlyChip(container).getAttribute("title") ?? "";
    // The visible word is one token; the title is what makes "testnet" adjacent
    // to a contract id read as a statement about that contract.
    assert.match(title, /testnet/);
    assert.match(title, /address/i);
  });
});

// ── Shared link primitives: labelled by construction ────────────────────────
//
// `starLink` and `contractLink` take their arguments positionally and return a
// node, so they are called directly rather than through `createElement` —
// `createElement` would hand the props object over as the hash.

test("starLink labels the transaction with its network", async () => {
  await withRender(react.createElement("div", null, starLink(TX_HASH)), (container) => {
    assertLabelled(container, TX_HASH, "starLink");
    assert.equal(onlyHref(container), `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`);
  });
});

test("starLink follows the network it is given", async () => {
  await withRender(react.createElement("div", null, starLink(TX_HASH, MAINNET)), (container) => {
    assert.equal(onlyHref(container), `https://stellar.expert/explorer/mainnet/tx/${TX_HASH}`);
    assert.equal(onlyChip(container).textContent, "mainnet");
  });
});

test("contractLink labels the contract and uses the contract route", async () => {
  await withRender(react.createElement("div", null, contractLink(CONTRACT)), (container) => {
    assertLabelled(container, CONTRACT, "contractLink");
    const href = onlyHref(container);
    assert.equal(href, `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`);
    // The bug this replaced: a `C…` sent through the transaction route.
    assert.equal(href.includes("/tx/"), false);
  });
});

test("contractLink follows the network it is given", async () => {
  await withRender(
    react.createElement("div", null, contractLink(CONTRACT, MAINNET)),
    (container) => {
      const href = onlyHref(container);
      assert.equal(href, `https://stellar.expert/explorer/mainnet/contract/${CONTRACT}`);
      assert.equal(onlyChip(container).textContent, "mainnet");
    },
  );
});

test("TxHashCell labels the hash it offers to copy", async () => {
  await withRender(react.createElement(TxHashCell, { hash: TX_HASH }), (container) => {
    assertLabelled(container, TX_HASH, "TxHashCell");
  });
});

// ── OutcomeList: every step's hash, labelled ────────────────────────────────

test("OutcomeList labels each submitted transaction hash", async () => {
  const steps = [
    { label: "install policy", result: { kind: "submitted", hash: TX_HASH, ledger: 100 } },
    {
      label: "set limits",
      result: { kind: "submitted", hash: TX_HASH.slice(0, 60) + "aa", ledger: 101 },
    },
  ];
  await withRender(react.createElement(OutcomeList, { steps }), (container) => {
    for (const step of steps) {
      assertLabelled(container, step.result.hash!, `OutcomeList step "${step.label}"`);
    }
    assert.equal(chips(container).length, steps.length, "each hash needs its own label");
  });
});
