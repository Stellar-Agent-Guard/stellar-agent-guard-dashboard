/**
 * "How to read the overview status panel" (issue #531).
 *
 * The guide in `docs/screens/overview.md` explains every signal on the
 * On-chain state panel — wallet, network, policy, freeze and telemetry — and
 * the safe next step when a reading is stale or failed. Its value depends on
 * quoting the interface exactly: an operator scanning for "error state" must
 * find the words they are looking at. So this file pins:
 *
 *   - **coverage**: a section per source, and the stale/failed/unknown states;
 *   - **fidelity**: every UI string the guide quotes still exists in the
 *     component (or module) that renders it, so a copy change cannot leave the
 *     guide describing a label that no longer appears;
 *   - **safety copy**: a failed read is described as unknown, never as a safe
 *     default, and the enforcement boundary and incident runbook are linked;
 *   - **in-app link**: the panel links to the guide (at the right anchor), the
 *     enforcement scope and the runbook, as real external links.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, before, describe, test } from "node:test";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { HELP_DOCS, helpHref } from "../../lib/guard/helpLinks.ts";
import { POLL_OFF_TEXT } from "../../lib/guard/feedHealth.ts";
import { OBSERVER_BADGE_LABEL } from "../../lib/guard/observerMode.ts";

installDom();

const guide = readFileSync(HELP_DOCS.overview, "utf8");
/** The guide with line wrapping collapsed, so a quote split by Prettier still matches. */
const guideFlat = guide.replace(/\s+/g, " ");
const read = (path: string) => readFileSync(path, "utf8");
const STATUS_PANEL = "components/StatusPanel.tsx";

/** The section the in-app "How to read this panel" link targets. */
const ANCHOR = "reading-the-on-chain-state-panel";

describe("overview guide: coverage of each source and state", () => {
  test("the panel section exists at the anchor the interface links to", () => {
    assert.match(guide, /^## Reading the on-chain state panel$/m);
  });

  for (const heading of [
    "Where each signal comes from",
    "Panel-level states",
    "Wallet and network",
    "Freeze and dead-man switch",
    "Policy",
    "Rolling window and artifact identity",
    "Telemetry feed health",
    "When in doubt",
  ]) {
    test(`it has a "${heading}" section`, () => {
      assert.match(guide, new RegExp(`^### ${heading}$`, "m"));
    });
  }

  test("the source table names where every signal is read from", () => {
    for (const source of [
      "status().admin_frozen",
      "heartbeat_expired",
      "status().has_policy",
      "policy()",
      "rolling spend window",
      "Wasm hash",
      "event poll",
      "wallet extension",
    ]) {
      assert.ok(guide.includes(source), `source table is missing "${source}"`);
    }
  });

  test("every state row has a safe next step column", () => {
    const stateTables = guide
      .split("\n")
      .filter((line) => /^\| (What you see|State|Field \/ value|Feed header says)/.test(line));
    assert.ok(stateTables.length >= 5, "expected a header row per state table");
    for (const header of stateTables) {
      assert.match(header, /Safe next step/, `table without a next step: ${header}`);
    }
  });
});

describe("overview guide: quoted UI strings still exist in the interface", () => {
  const quotes: Array<[quote: string, file: string]> = [
    ["read failed", "components/bits.tsx"],
    ["stale since ", STATUS_PANEL],
    ["error state", STATUS_PANEL],
    ["could not be read", STATUS_PANEL],
    ["Read diagnostics", STATUS_PANEL],
    ["TRAINING / SIMULATION MODE", STATUS_PANEL],
    ["FROZEN", STATUS_PANEL],
    ["clear", STATUS_PANEL],
    ["FIRED", STATUS_PANEL],
    ["within grace", STATUS_PANEL],
    ["expired", STATUS_PANEL],
    ["switch disabled (grace 0)", STATUS_PANEL],
    ["never", STATUS_PANEL],
    ["stale read", STATUS_PANEL],
    ["no — default deny", STATUS_PANEL],
    ["Configure a policy for this account", STATUS_PANEL],
    ["different artifact", STATUS_PANEL],
    ["match", STATUS_PANEL],
    ["Unavailable", STATUS_PANEL],
    ["How to read this panel", STATUS_PANEL],
    ["What the guard enforces", STATUS_PANEL],
    ["Incident runbook", STATUS_PANEL],
    ["Connect admin wallet", "components/WalletBar.tsx"],
    ["Wallet connection", "components/WalletBar.tsx"],
    ["RPC endpoint health", "components/WalletBar.tsx"],
    ["Check again", "components/WalletBar.tsx"],
    ["connected", "components/WalletBar.tsx"],
    ["Wallet on ", "lib/guard/networkSwitch.ts"],
    ["Waiting for the first poll", "lib/guard/feedHealth.ts"],
    ["no poll has completed", "lib/guard/feedHealth.ts"],
    ["No poll has landed for", "lib/guard/feedHealth.ts"],
    ["The last poll failed", "lib/guard/feedHealth.ts"],
    ["returned no events", "lib/guard/feedHealth.ts"],
  ];

  for (const [quote, file] of quotes) {
    test(`"${quote}" appears in both the guide and ${file}`, () => {
      assert.ok(guideFlat.includes(quote), `the guide no longer mentions "${quote}"`);
      assert.ok(read(file).includes(quote), `${file} no longer renders "${quote}"`);
    });
  }

  test("the observer badge and the not-watching feed text are quoted verbatim", () => {
    assert.ok(guideFlat.includes(OBSERVER_BADGE_LABEL));
    // The guide quotes the feed text's first sentence ("Not watching this feed").
    const firstSentence = POLL_OFF_TEXT.split(".")[0]!;
    assert.equal(firstSentence, "Not watching this feed");
    assert.ok(guideFlat.includes(firstSentence));
  });
});

describe("overview guide: safety copy", () => {
  test("a failed read is described as unknown, never as a safe default", () => {
    assert.match(guide, /\*\*A failed read is not a safe state\.\*\*/);
    assert.match(guide, /\*\*This is not the same as no policy\.\*\*/);
    assert.match(guide, /unknown, not "matching"/);
  });

  test("chain reads are stated as authoritative and the console as non-custodial", () => {
    assert.match(guide, /Chain reads are authoritative; the console is not\./);
    assert.match(guide, /The console holds no keys\./);
  });

  test("it does not claim the console can freeze when RPC is unreachable", () => {
    // writeControlState disables freeze when the preflight read is unavailable.
    assert.match(read("lib/guard/observerMode.ts"), /preflightUnavailable/);
    assert.match(guide, /freeze button is disabled too/);
    assert.doesNotMatch(guide, /freez\w* (is )?always available/i);
  });

  test("it does not promise an RPC endpoint switcher the console lacks", () => {
    assert.match(read("lib/guard/network.ts"), /NEXT_PUBLIC_RPC_URL/);
    assert.match(guide, /The endpoint is fixed at build time/);
    assert.doesNotMatch(guide, /switch to another (configured )?endpoint/i);
  });

  test("it links the enforcement boundary and the incident runbook", () => {
    assert.match(guide, /\]\(\.\.\/enforcement-scope\.md\)/);
    assert.match(guide, /\]\(\.\.\/runbooks\/emergency-freeze\.md\)/);
    assert.match(
      guide,
      /\]\(\.\.\/runbooks\/emergency-freeze\.md#6-quick-reference-cli-fallback-web-ui-unavailable\)/,
    );
    assert.match(
      read("docs/runbooks/emergency-freeze.md"),
      /^## 6\. Quick-reference CLI fallback \(web UI unavailable\)$/m,
    );
  });
});

describe("status panel: in-app help links", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let act: Act;
  let StatusHelpLinks: typeof import("../../components/StatusPanel.tsx").StatusHelpLinks;
  let root: ReturnType<typeof createRoot> | null = null;

  before(async () => {
    const loaded = await loadReact();
    React = loaded.react;
    createRoot = loaded.createRoot;
    act = loaded.act;
    ({ StatusHelpLinks } = await import("../../components/StatusPanel.tsx"));
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      await act(async () => current.unmount());
      root = null;
    }
    document.body.innerHTML = "";
  });

  async function renderLinks(): Promise<HTMLAnchorElement[]> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host);
      root.render(React.createElement(StatusHelpLinks));
    });
    const nav = host.querySelector('nav[aria-label="Status panel help"]');
    assert.ok(nav, "the help links are a labelled navigation landmark");
    assert.ok(nav.classList.contains("no-print"), "help links stay out of the printed report");
    return Array.from(nav.querySelectorAll("a"));
  }

  test("links the guide at the panel section, the enforcement scope, and the runbook", async () => {
    const links = await renderLinks();
    assert.deepEqual(
      links.map((a) => [a.textContent, a.getAttribute("href")]),
      [
        ["How to read this panel", helpHref("overview", ANCHOR)],
        ["What the guard enforces", helpHref("enforcementScope")],
        ["Incident runbook", helpHref("incidentRunbook")],
      ],
    );
  });

  test("links open in a new tab without leaking an opener", async () => {
    for (const link of await renderLinks()) {
      assert.equal(link.getAttribute("target"), "_blank");
      assert.match(link.getAttribute("rel") ?? "", /noopener/);
      assert.match(link.getAttribute("rel") ?? "", /noreferrer/);
    }
  });

  test("every linked document exists in the repository", () => {
    for (const key of ["overview", "enforcementScope", "incidentRunbook"] as const) {
      assert.ok(existsSync(HELP_DOCS[key]), `${HELP_DOCS[key]} is missing`);
    }
  });

  test("the status panel renders the help links", () => {
    assert.match(read(STATUS_PANEL), /<StatusHelpLinks \/>/);
  });
});
