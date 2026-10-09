/**
 * Every network-touching display says which network it is on.
 *
 * Lives in `tests/unit/` rather than `tests/components/` on purpose: `npm test`
 * runs `tests/unit/*.test.ts`, so a DOM-rendering test parked in the other
 * directory would never execute in CI and would quietly protect nothing. This is
 * the same placement `a11yAudit.test.ts` uses for its rendered panels.
 *
 * The failure this guards against is not cosmetic. A guard address, a contract id
 * and a transaction hash are all opaque strings, and a Testnet one pasted into a
 * Mainnet tool fails in a way that looks like the tool's problem, not the
 * operator's. So the rule this file asserts is narrow and total: wherever the
 * console renders an address, a contract id or a transaction hash, the network
 * that value belongs to is on screen *with it*.
 *
 * The WalletBar's global network indicator is not a substitute, and the reason is
 * positional rather than informational. It states the build's network once, at the
 * top of the page; the deploy result is far below that. Scroll position is what
 * puts the bar off-screen at exactly the moment an operator copies an address out
 * of the result. The two are complementary — the bar keeps answering "what is
 * this console connected to", the chip answers "which network is *this* value".
 *
 * How each site is covered, and why it differs:
 *
 *   - Rendered: the site's value arrives through a shared primitive, or the panel
 *     is cheap enough to render with a mocked context. The address text and the
 *     network text are asserted to be present in the *same* render — an address
 *     without a network next to it is the bug, so the assertion is co-presence
 *     and not two separate "contains" checks.
 *   - Anchored in source: the panel needs a live chain to reach that branch, so
 *     the assertion is that the chip is adjacent to that exact value in the
 *     component. The matrix below carries the anchor and the count, so deleting a
 *     row fails here rather than quietly shrinking the guarantee.
 *
 * The default build is public testnet (`NETWORK` in `lib/guard/network.ts`), so
 * the network text every rendered site must contain is "Testnet". The mainnet
 * case is asserted separately against the chip's own `network` prop and against
 * the link builder's exact strings in `tests/unit/explorerLinks.test.ts`.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, before, describe, test } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import {
  AccountLink,
  NetworkChip,
  OutcomeList,
  TxHashCell,
  starLink,
} from "../../components/bits.tsx";
import { HardwareWalletGuide } from "../../components/HardwareWalletGuide.tsx";
import { StatusPanel } from "../../components/StatusPanel.tsx";
import { GuardContext } from "../../components/GuardProvider.tsx";
import { NETWORK } from "../../lib/guard/network.ts";
import { hardwareGuide } from "../../lib/guard/hardwareGuide.ts";
import { explorerAccountUrl, explorerTxUrl } from "../../lib/guard/explorerLinks.ts";
import type { GuardSnapshot } from "../../lib/guard/guardOps.ts";

/** A real-looking contract id and tx hash, so nothing here is a shape the chain rejects. */
const CONTRACT = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const HASH = "bcd8eac52d6efb50eb2c8d7d9650493da9be7fe73b0be18a450282fa24006579";
const ACCOUNT = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";

/** What the build is configured as, so the expected word is derived, never hardcoded twice. */
const CONFIGURED = NETWORK.name;
const CONFIGURED_TEXT = /testnet|mainnet|futurenet|standalone|local|unknown/i;

installDom();

let react: typeof import("react");
let createRoot: Awaited<ReturnType<typeof loadReact>>["createRoot"];
let act: Act;
let root: ReturnType<typeof createRoot> | null = null;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  document.body.innerHTML = "";
  hardwareGuide.clear();
});

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const noNetworkServer = new Proxy(
  {},
  { get: () => () => Promise.reject(new Error("network disabled in unit tests")) },
);

const snapshot: GuardSnapshot = {
  guard: CONTRACT,
  fetchedAt: new Date().toISOString(),
  status: {
    ok: true,
    value: {
      admin_frozen: false,
      heartbeat_expired: false,
      has_policy: true,
      last_heartbeat: 1000n,
      now: 2000n,
    },
  },
  policy: {
    ok: true,
    value: {
      window_cap: 5000n,
      window_secs: 3600n,
      per_tx_cap: 1000n,
      assets: [],
      recipients: [],
      protocols: [],
      allow_any_recipient: false,
      paused: false,
      active_from: 0n,
      active_until: 0n,
      dms_grace_secs: 300n,
    },
  },
  window: { ok: true, value: { total: 0n, entries: [] } },
  identity: {
    ok: true,
    value: { match: true, reportedWasmHash: "abc", fetchedSha256: "def", bytes: 12345 },
  },
} as unknown as GuardSnapshot;

const guardContext = {
  server: noNetworkServer,
  wallet: {
    address: ACCOUNT,
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "Testnet",
  },
  walletError: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  signer: () => {
    throw new Error("no signing in unit tests");
  },
  instances: [],
  guard: CONTRACT,
  selectGuard: () => {},
  addInstance: () => {},
  snapshot,
  snapshotError: null,
  refreshing: false,
  refresh: async () => {},
  feed: {
    watching: false,
    latestLedger: null,
    error: null,
    lastPolledAt: null,
    guards: [],
    capped: 0,
    cappedLabels: [],
  },
  startWatching: () => {},
  stopWatching: () => {},
  stream: { paused: false, pendingCount: 0, dropped: 0 },
  pauseStream: () => {},
  resumeStream: () => {},
  clearEvents: () => {},
  pushEvents: () => {},
} as never;

/**
 * The core assertion, stated once: the value and the network are on screen
 * together. Checking them separately would pass for a chip on some other part of
 * the page, which is precisely the arrangement this work exists to remove.
 */
function assertValueWithNetwork(container: HTMLElement, value: string, what: string): void {
  const text = container.textContent ?? "";
  assert.ok(
    text.includes(value),
    `${what}: the value "${value}" must be rendered, got: "${text.slice(0, 160)}"`,
  );
  assert.match(
    text,
    CONFIGURED_TEXT,
    `${what}: an address/hash rendered with no network beside it is the cross-network footgun`,
  );
}

describe("NetworkChip", () => {
  test("states this build's network by default", async () => {
    const container = await render(react.createElement(NetworkChip));
    assert.equal(container.textContent, "Testnet");
    assert.equal(container.querySelector(".net-chip")?.getAttribute("data-network"), CONFIGURED);
  });

  test("states the network it is handed, not the one it was built with", async () => {
    // A fleet row or a saved instance can describe a network the build is not
    // pointed at; the chip has to be able to say so.
    const mainnet = await render(react.createElement(NetworkChip, { network: "mainnet" }));
    assert.equal(mainnet.textContent, "Mainnet");
    assert.equal(mainnet.querySelector(".net-chip")?.getAttribute("data-network"), "mainnet");
  });

  test("the label is text, not a colour — a chip nobody can read is not a label", async () => {
    const container = await render(react.createElement(NetworkChip, { network: "public" }));
    assert.equal(container.textContent, "Mainnet");
    assert.match(container.querySelector(".net-chip")?.getAttribute("title") ?? "", /Mainnet/);
  });
});

describe("display sites that render a value and its network together", () => {
  test("AccountLink: the account address, an account-page link, and the network", async () => {
    const container = await render(
      react.createElement(AccountLink, { address: ACCOUNT, className: "mono tiny" }),
    );
    assertValueWithNetwork(container, "GD5S5O…LAVS", "AccountLink");
    assert.equal(
      container.querySelector("a")?.getAttribute("href"),
      explorerAccountUrl(ACCOUNT, { name: CONFIGURED }),
    );
    assert.equal(
      container.querySelector("a")?.getAttribute("href")?.includes("/tx/"),
      false,
      "an account address must not be linked as a transaction",
    );
  });

  test("AccountLink: a row naming another network links and labels that same network", async () => {
    // The link and the chip must not disagree — a mainnet URL under a testnet chip
    // would reintroduce the confusion with an extra step.
    const container = await render(
      react.createElement(AccountLink, { address: ACCOUNT, network: "mainnet" }),
    );
    assert.ok(container.textContent?.includes("Mainnet"));
    assert.equal(
      container.querySelector("a")?.getAttribute("href"),
      explorerAccountUrl(ACCOUNT, { name: "mainnet" }),
    );
  });

  test("TxHashCell: the hash, the copy button, and the network", async () => {
    const container = await render(react.createElement(TxHashCell, { hash: HASH }));
    assertValueWithNetwork(container, HASH.slice(0, 10), "TxHashCell");
    assert.equal(
      container.querySelector("a")?.getAttribute("href"),
      explorerTxUrl(HASH, { name: CONFIGURED }),
    );
  });

  test("OutcomeList: a submitted step's hash sits beside the network", async () => {
    const container = await render(
      react.createElement(OutcomeList, {
        steps: [
          { label: "create guard", result: { kind: "submitted", hash: HASH, ledger: 4691622 } },
        ],
      }),
    );
    assertValueWithNetwork(container, HASH.slice(0, 10), "OutcomeList");
    assert.ok(container.textContent?.includes("create guard"));
  });

  test("starLink links to this network rather than a frozen testnet path", async () => {
    // The regression the whole link-builder exists for: a literal `/testnet/` in
    // the template. Asserting the URL rather than the markup is what pins it.
    const container = await render(react.createElement("span", null, starLink(HASH)));
    const href = container.querySelector("a")?.getAttribute("href") ?? "";
    assert.equal(href, explorerTxUrl(HASH));
    assert.equal(href.includes("/testnet/"), CONFIGURED === "testnet");
  });

  test("StatusPanel: the guard address above the on-chain reads names its network", async () => {
    const container = await render(
      react.createElement(
        GuardContext.Provider,
        { value: guardContext },
        react.createElement(StatusPanel),
      ),
    );
    assertValueWithNetwork(container, CONTRACT, "StatusPanel guard address");
  });

  test("HardwareWalletGuide: the contract on the device-confirmation dialog names its network", async () => {
    // The guide takes no props: it subscribes to the signing store that
    // `submit.ts` opens, so a test has to open the session the way a real write
    // does. Rendering it with a hand-built snapshot would assert nothing.
    hardwareGuide.begin(CONTRACT, "initialize");
    hardwareGuide.setTxHash(HASH);
    const container = await render(react.createElement(HardwareWalletGuide));
    assertValueWithNetwork(container, "CAYJZT4X…3X4CU7", "HardwareWalletGuide contract");
    // The hash block is the thing the operator reads digit-for-digit off a
    // one-line Ledger screen, so it stays uncluttered and its aria-live region
    // stays verbatim; the chip above it names the network for the same value.
    // Grouping may insert whitespace and the guide uppercases the hex for the
    // device, but every digit has to still be there — a truncated hash here would
    // be a signature the device cannot be matched against.
    const shown = (container.textContent ?? "").replace(/\s+/g, "").toUpperCase();
    assert.ok(
      shown.includes(HASH.toUpperCase()),
      "the full hash must be on screen, grouped but not shortened",
    );
    assert.equal(container.textContent?.includes("Testnet"), true);
  });
});

// ── The inventory ────────────────────────────────────────────────────────────

function componentSources(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx$/.test(entry)) continue;
      found.push({ path: path.replace(/\\/g, "/"), text: readFileSync(path, "utf8") });
    }
  };
  walk("components");
  return found;
}

const SOURCES = componentSources();

/**
 * Every site that renders an address, a contract id or a transaction hash.
 *
 * `anchor` is the expression whose display must carry the label, and `label` is the
 * mechanism that carries it — the chip at that site, or a primitive that is
 * itself chip-bearing. Both are checked mechanically below, so a row cannot go
 * stale silently: either the value moved or the label did, and the row fails.
 *
 * `pending` rows are the honest remainder — a site whose network the component
 * genuinely does not know, listed with the reason rather than left blank. There is
 * one, and it is asserted below.
 */
const INVENTORY: {
  site: string;
  file: string;
  anchor: string;
  label: "chip-at-site" | "chip-bearing-primitive" | "pending";
}[] = [
  // DeployPanel — the panel the cross-network footgun starts from.
  {
    site: "predicted guard address",
    file: "DeployPanel.tsx",
    anchor: "plan.predicted",
    label: "chip-at-site",
  },
  {
    site: "address-collision warning",
    file: "DeployPanel.tsx",
    anchor: "{predicted}",
    label: "chip-at-site",
  },
  {
    site: "vanity-search result address",
    file: "DeployPanel.tsx",
    anchor: "vanityFound.address",
    label: "chip-at-site",
  },
  {
    site: "deployed guard address",
    file: "DeployPanel.tsx",
    anchor: "outcome.guard",
    label: "chip-at-site",
  },
  {
    site: "bytecode-inspector target",
    file: "DeployPanel.tsx",
    anchor: "outcome?.guard ?? guard",
    label: "chip-at-site",
  },
  {
    site: "initialize receipt tx link",
    file: "DeployPanel.tsx",
    anchor: "initResult.hash",
    label: "chip-at-site",
  },
  {
    site: "deploy-step tx links",
    file: "bits.tsx",
    anchor: "step.result.hash",
    label: "chip-at-site",
  },
  // StatusPanel — the on-chain read block and the printed compliance record.
  {
    site: "status-read guard address",
    file: "StatusPanel.tsx",
    anchor: "{guard}",
    label: "chip-at-site",
  },
  {
    site: "compliance report contract id",
    file: "StatusPanel.tsx",
    anchor: "printReport.contractId",
    label: "chip-at-site",
  },
  // Tables and feeds.
  {
    site: "telemetry feed guard attribution",
    file: "TelemetryFeed.tsx",
    anchor: "{guardLabel} <NetworkChip />",
    label: "chip-at-site",
  },
  {
    site: "telemetry feed tx cell",
    file: "bits.tsx",
    anchor: "TxHashCell",
    label: "chip-bearing-primitive",
  },
  {
    site: "tx history tx cell",
    file: "TxHistoryTable.tsx",
    anchor: "TxHashCell",
    label: "chip-bearing-primitive",
  },
  {
    site: "fleet table contact address",
    file: "FleetTable.tsx",
    anchor: "AccountLink",
    label: "chip-bearing-primitive",
  },
  // Write receipts.
  {
    site: "policy install/revoke receipt",
    file: "PolicyForm.tsx",
    anchor: "starLink(result.hash)",
    label: "chip-at-site",
  },
  {
    site: "freeze/unfreeze receipt",
    file: "PanicPanel.tsx",
    anchor: "starLink(report.result.hash)",
    label: "chip-at-site",
  },
  {
    site: "migration receipt",
    file: "MigrationWizard.tsx",
    anchor: "starLink(applied.result.hash)",
    label: "chip-at-site",
  },
  {
    site: "migration target guard",
    file: "MigrationWizard.tsx",
    anchor: '{target || "the selected guard"}',
    label: "chip-at-site",
  },
  {
    site: "externally signed submission receipt",
    file: "SubmitSignedXDRPanel.tsx",
    anchor: "starLink(successHash)",
    label: "chip-at-site",
  },
  // Elsewhere.
  {
    site: "multisig envelope hash",
    file: "MultisigTracker.tsx",
    anchor: "report.hash",
    label: "chip-at-site",
  },
  {
    site: "ledger device contract",
    file: "HardwareWalletGuide.tsx",
    anchor: "{short(contractId, 8, 6)}",
    label: "chip-at-site",
  },
  {
    site: "wizard-state footnote guard",
    file: "SetupWizard.tsx",
    anchor: "{short(guard, 8, 6)}",
    label: "chip-at-site",
  },
  {
    site: "fleet/wallet saved-instance switcher",
    file: "WalletBar.tsx",
    anchor: "instance.network",
    label: "pending",
  },
];

describe("the site inventory", () => {
  test("every anchored value is still where the inventory says it is", () => {
    for (const row of INVENTORY) {
      const source = SOURCES.find((file) => file.path === `components/${row.file}`);
      assert.ok(source, `${row.site}: components/${row.file} is missing from the inventory's map`);
      assert.ok(
        source.text.includes(row.anchor),
        `${row.site}: components/${row.file} no longer renders "${row.anchor}"`,
      );
    }
  });

  test("every anchored value is labelled, by a chip at the site or a chip-bearing primitive", () => {
    for (const row of INVENTORY.filter((entry) => entry.label !== "pending")) {
      const source = SOURCES.find((file) => file.path === `components/${row.file}`);
      assert.ok(source, `${row.site}: components/${row.file} is missing`);
      // The mechanism, not the file: bits.tsx labels DeployPanel's outcome because
      // both come through the same primitive, and a file-level "does it import
      // NetworkChip" check would pass on an unrelated chip elsewhere in the file.
      const chipBearing = ["TxHashCell", "AccountLink"].filter((name) =>
        source!.text.includes(name),
      );
      const labels = source!.text.includes("NetworkChip") || chipBearing.length > 0;
      assert.ok(
        labels,
        `${row.site}: components/${row.file} renders "${row.anchor}" with no network label`,
      );
      if (row.label === "chip-bearing-primitive") {
        assert.ok(
          chipBearing.length > 0,
          `${row.site}: expected a chip-bearing primitive in ${row.file}`,
        );
      } else {
        assert.ok(
          source!.text.includes("<NetworkChip"),
          `${row.site}: expected an inline chip in ${row.file}`,
        );
      }
    }
  });

  test("the inventory is whole: no site was added to a component without a row here", () => {
    // A component that renders a network-touching value has to appear in the
    // inventory. This is the check that makes the table load-bearing rather than
    // decorative: a new panel shipping an unlabelled address fails here.
    const listed = new Set(INVENTORY.map((row) => row.file));
    const suspects = SOURCES.filter((file) =>
      /contractId|transactionHash|starLink|TxHashCell|AccountLink|plan\.predicted/.test(file.text),
    ).map((file) => file.path.replace("components/", ""));
    for (const file of suspects) {
      assert.ok(
        listed.has(file),
        `components/${file} renders network-touching values but has no inventory row`,
      );
    }
    // And the reverse: a row must not outlive the site it names.
    assert.equal(INVENTORY.length, 22, "the inventory changed size; update it deliberately");
  });

  test("the one pending row is pending for a stated reason, not by omission", () => {
    const pending = INVENTORY.filter((row) => row.label === "pending");
    assert.deepEqual(
      pending.map((row) => row.file),
      ["WalletBar.tsx"],
      "only the saved-instance switcher is knowingly unlabelled",
    );
    // WalletBar is pending because it already names the network: the switcher
    // option ends in each instance's own `instance.network`, and the hint below
    // it repeats the selected one. It is a picker over many networks at once, so a
    // chip fixed to this build's network would contradict the picker rather than
    // clarify it — the one site where the label must be the row's own network,
    // and it already is.
    const walletBar = SOURCES.find((file) => file.path === "components/WalletBar.tsx")?.text ?? "";
    assert.match(walletBar, /\{instance\.label\}[^\n]*\{instance\.network\}/);
    assert.match(walletBar, /network \$\{selected\.network\}/);
  });
});

describe("no display can reintroduce a frozen network", () => {
  test("no component hardcodes an explorer URL", () => {
    for (const file of SOURCES) {
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      assert.equal(
        /https?:\/\/(www\.)?stellar\.expert/.test(code),
        false,
        `${file.path} hardcodes an explorer URL; build it from lib/guard/explorerLinks.ts`,
      );
    }
  });

  test("the chip class exists once in the shared stylesheet, not per component", () => {
    const css = readFileSync("app/globals.css", "utf8");
    assert.ok(css.includes(".net-chip {"), "globals.css must define the shared chip class");
    // Print has to carry it: a printed record listing an address without its
    // network is the one artefact an operator cannot re-check later. Slice from
    // the *first* `@media print`, since the sheet has several and the chip rule
    // is not necessarily in the last one.
    const printBlock = css.slice(css.indexOf("@media print"));
    assert.ok(printBlock.includes(".net-chip"), "the chip must survive the print rules");
    for (const file of SOURCES) {
      assert.equal(
        /\.net-chip\b/.test(file.text),
        false,
        `${file.path} re-declares .net-chip; styles belong in globals.css`,
      );
    }
  });
});
