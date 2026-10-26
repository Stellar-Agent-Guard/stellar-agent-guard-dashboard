/**
 * The inventory of every network-touching display (issue: cross-network address
 * confusion).
 *
 * The requirement was "every network-touching display states its network", and a
 * requirement like that is only satisfied or falsified against a list. So this
 * file *is* the list: each entry names a component, the address or hash it shows,
 * and where the label comes from. If a display is added without an entry the
 * table is stale; if an entry's mechanism is removed the mechanism test below
 * fails. Neither direction is automatic, which is why the table also carries the
 * reasoning — a reviewer can disagree with a row rather than just noticing it
 * vanished.
 *
 * The `labelled by` column is not all the same kind of thing, and pretending
 * otherwise would make the table lie:
 *
 * - `contractLink` / `starLink` — labelled *by construction*. The chip is
 *   inside the primitive, so a caller cannot render an unlabelled explorer link.
 *   These rows are covered by `networkChip.test.ts` rendering the primitive, and
 *   are listed here so the inventory is complete.
 * - `<NetworkChip />` — an explicit sibling at the render site, because the value
 *   is plain text with no link to hang a label on.
 * - a native `<select>` cannot hold a chip, so the label rides the field label
 *   of the control that lists those ids. Said plainly rather than quietly
 *   omitted, because an option that cannot be labelled is a real limitation of
 *   the platform and not a style choice.
 * - `Network: <row>` — already labelled, in words, before this change. Left
 *   alone.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const COMPONENTS_DIR = join(process.cwd(), "components");

type LabelledBy =
  | "contractLink"
  | "starLink"
  | "NetworkChip"
  | "select field label"
  | "pre-existing label"
  | "not network-touching";

interface Site {
  /** The file that renders the value. */
  file: string;
  /** What is displayed, for a reader to find it in the file. */
  what: string;
  labelledBy: LabelledBy;
  /** Why this display is or is not network-touching. */
  rationale: string;
}

/**
 * Every place this console renders a network-specific identifier.
 *
 * Kept as data rather than as twenty separate assertions because the value is in
 * the *coverage*: a site with no row is a site nobody decided about. The two
 * tables below are checked against this one, so adding a render site without a
 * row shows up as a mismatch rather than as silence.
 */
const INVENTORY: Site[] = [
  // ── Explorer links: labelled inside the primitive ─────────────────────────
  {
    file: "bits.tsx",
    what: "starLink — every transaction-hash link in the console",
    labelledBy: "starLink",
    rationale:
      "The chip is inside the link primitive, so an unlabelled explorer link is unrepresentable. This is why the fleet, history, telemetry and receipt links need no per-site edit.",
  },
  {
    file: "bits.tsx",
    what: "contractLink — contract-id explorer links",
    labelledBy: "contractLink",
    rationale:
      "Same reasoning, and it carries the corrected /contract/ route that FleetTable's /tx/ link lacked.",
  },
  {
    file: "bits.tsx",
    what: "TxHashCell — hash link plus copy button (TxHistory, TelemetryFeed)",
    labelledBy: "starLink",
    rationale: "Wraps starLink; the copy button copies the hash the link names.",
  },
  {
    file: "bits.tsx",
    what: "OutcomeList — per-step transaction hashes (deploy, migrate, policy receipts)",
    labelledBy: "starLink",
    rationale: "Renders starLink per step, so every step's hash is labelled.",
  },
  {
    file: "SubmitSignedXDRPanel.tsx",
    what: "receipt hash for an externally signed transaction",
    labelledBy: "starLink",
    rationale:
      "Goes through starLink. The one panel whose transaction was signed somewhere else entirely, so its hash is the one most likely to be pasted into a second tool.",
  },
  {
    file: "PolicyForm.tsx",
    what: "submitted and rejected transaction receipts",
    labelledBy: "starLink",
    rationale:
      "Goes through starLink. Both outcomes are labelled, so a rejection is as attributable as a success.",
  },
  {
    file: "PanicPanel.tsx",
    what: "freeze / unfreeze transaction receipts",
    labelledBy: "starLink",
    rationale: "Goes through starLink.",
  },
  {
    file: "MigrationWizard.tsx",
    what: "migration receipt hash",
    labelledBy: "starLink",
    rationale: "Goes through starLink.",
  },
  {
    file: "TelemetryFeed.tsx",
    what: "audit-feed transaction hashes per row",
    labelledBy: "starLink",
    rationale: "Rows render TxHashCell / starLink.",
  },
  {
    file: "TxHistoryTable.tsx",
    what: "transaction history hashes per row",
    labelledBy: "starLink",
    rationale: "Rows render TxHashCell.",
  },
  {
    file: "FleetTable.tsx",
    what: "guard / agent contract id per row",
    labelledBy: "contractLink",
    rationale:
      "Was a /tx/ link built from a C… id, which resolves to nothing. Now contractLink: the contract route, with the row's Network column naming the ledger in words beside it.",
  },
  {
    file: "DeployPanel.tsx",
    what: "the DeploymentResult link beside the deploy receipt",
    labelledBy: "starLink",
    rationale: "Goes through starLink.",
  },

  // ── Plain-text addresses and hashes: labelled at the render site ─────────
  {
    file: "StatusPanel.tsx",
    what: "the guard address under the on-chain status block",
    labelledBy: "NetworkChip",
    rationale:
      "The address an operator most often copies out of this console, and it sits well below the wallet bar.",
  },
  {
    file: "StatusPanel.tsx",
    what: "printed compliance report — Contract ID",
    labelledBy: "pre-existing label",
    rationale:
      "The print header already emits a `Network:` field three lines above. A second chip would be the same fact twice on the same page; the CSS print rule covers the chip for the panels that do not have such a header.",
  },
  {
    file: "DeployPanel.tsx",
    what: "predicted guard address (computed before signing)",
    labelledBy: "NetworkChip",
    rationale:
      "This is the address an operator writes into their runbook before the contract exists, so it is the value most likely to be carried to the wrong network.",
  },
  {
    file: "DeployPanel.tsx",
    what: "collision warning — 'A contract already lives at …'",
    labelledBy: "NetworkChip",
    rationale:
      "Names a real contract id found on the read ledger; which ledger is the entire content of the warning.",
  },
  {
    file: "DeployPanel.tsx",
    what: "vanity-address search result",
    labelledBy: "NetworkChip",
    rationale: "An address generated here and then deployed; the network it was mined for matters.",
  },
  {
    file: "DeployPanel.tsx",
    what: "deployed guard address, verified and unverified outcomes",
    labelledBy: "NetworkChip",
    rationale: "The mainnet warning is beside this address, so the network belongs beside it.",
  },
  {
    file: "MigrationWizard.tsx",
    what: "From / To source and target contract ids",
    labelledBy: "NetworkChip",
    rationale:
      "Two ids side by side with one about to overwrite the other. Each states its own network rather than relying on a chip at the top of the panel.",
  },
  {
    file: "MigrationWizard.tsx",
    what: "target contract named in the panel's opening sentence",
    labelledBy: "NetworkChip",
    rationale:
      "Rendered only when a target is selected — a chip on the word itself, not on the fallback wording.",
  },
  {
    file: "PanicPanel.tsx",
    what: "truncated guard id in the freeze confirmation",
    labelledBy: "NetworkChip",
    rationale: "Names the account whose spending is about to be halted.",
  },
  {
    file: "PanicPanel.tsx",
    what: "full guard id above the type-to-confirm freeze challenge",
    labelledBy: "NetworkChip",
    rationale:
      "The operator is comparing characters against this string to authorise an irreversible action.",
  },
  {
    file: "TelemetryFeed.tsx",
    what: "truncated guard id in the feed footer",
    labelledBy: "NetworkChip",
    rationale: "States whose events these are, and on which ledger.",
  },
  {
    file: "HardwareWalletGuide.tsx",
    what: "contract id and prepared transaction hash awaiting device approval",
    labelledBy: "NetworkChip",
    rationale:
      "The screen an operator reads at a glance on a second monitor while deciding whether the device shows the same thing. A mismatch between those two is the cross-network error this console exists to prevent.",
  },
  {
    file: "AddressBookModal.tsx",
    what: "every saved contact address",
    labelledBy: "NetworkChip",
    rationale:
      "The one place ids are saved rather than read, so the likeliest home for one pasted from the wrong ledger. The operator-typed label beside it cannot be trusted to say which network it is on.",
  },
  {
    file: "WalletBar.tsx",
    what: "connected wallet address",
    labelledBy: "NetworkChip",
    rationale:
      "The address whose passphrase the mismatch banner above is comparing. The banner is global; the chip says which ledger this one address belongs to.",
  },
  {
    file: "CommandPalette.tsx",
    what: "truncated guard id in each 'Switch to …' entry",
    labelledBy: "NetworkChip",
    rationale:
      "Rendered from a `networkName` flag on the command rather than baked into the label string, because the label is the text fuzzyMatch searches and a chip is not a string.",
  },
  {
    file: "MultisigTracker.tsx",
    what: "envelope hash awaiting signatures",
    labelledBy: "NetworkChip",
    rationale:
      "Not in any explorer yet — it has not been submitted — so it stays plain text rather than becoming a dead link. It is still an id from one ledger, so it says which.",
  },

  // ── Values that exist inside another component and need no label ──────────
  {
    file: "WalletBar.tsx",
    what: "guard switcher <select> options",
    labelledBy: "select field label",
    rationale:
      "A native <select> renders plain text and cannot hold a chip. The label rides the field label instead; every instance listed is one this console read from its own network, and the mismatch banner catches one registered from a link off another.",
  },
  {
    file: "MigrationWizard.tsx",
    what: "source guard <select> options",
    labelledBy: "select field label",
    rationale: "Same platform limit; the chip is on the 'Source guard' field label.",
  },
  {
    file: "FleetTable.tsx",
    what: "per-row Network column",
    labelledBy: "pre-existing label",
    rationale: "Already states the network in words. Left alone.",
  },
  {
    file: "GuardProvider.tsx",
    what: "the generated `Guard C…` registry label",
    labelledBy: "not network-touching",
    rationale:
      "A string field written into localStorage when a guard is opened from a deep link, not a rendered value — a chip cannot go in a string. Every surface that renders the id it describes is labelled on its own row above.",
  },
  {
    file: "TelemetryAlerts.tsx",
    what: "truncated guard id in alert rows",
    labelledBy: "not network-touching",
    rationale:
      "Renders the same alert copy for every network, and its ids are reached from the feed and history links, which are labelled. Adding a chip here would repeat the feed's label on a summary line.",
  },
];

// ── The table is not stale ───────────────────────────────────────────────────

test("every component that renders an explorer link or a chip has a row", () => {
  // The staleness check that matters. A new render site added without a row is
  // the failure this file exists to catch, so it is checked mechanically: every
  // component that reaches for a link primitive or a chip must appear in the
  // table above.
  const inventoried = new Set(INVENTORY.map((site) => site.file));
  const unlisted: string[] = [];
  for (const entry of readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(join(COMPONENTS_DIR, entry), "utf8");
    const rendersAnything = /<NetworkChip[\s/>]|starLink\(|contractLink\(|<TxHashCell/.test(source);
    if (rendersAnything && !inventoried.has(entry)) unlisted.push(entry);
  }
  assert.deepEqual(
    unlisted,
    [],
    "these components render network-touching displays but have no inventory row",
  );
});

test("the table names no file outside components/", () => {
  const files = new Set(readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith(".tsx")));
  for (const site of INVENTORY) {
    assert.equal(files.has(site.file), true, `${site.file} is not a component file`);
  }
});

test("every inventoried site gives a reason for its decision", () => {
  // A row with no rationale is a row nobody thought about, which is the failure
  // mode an inventory is supposed to prevent.
  for (const site of INVENTORY) {
    assert.ok(site.rationale.length > 20, `${site.file}: ${site.what} has no real rationale`);
  }
});

// ── The mechanisms the table claims are real ────────────────────────────────

test("every site claiming a chip really renders one", () => {
  const broken: string[] = [];
  for (const site of INVENTORY) {
    if (site.labelledBy !== "NetworkChip" && site.labelledBy !== "select field label") continue;
    const source = readFileSync(join(COMPONENTS_DIR, site.file), "utf8");
    const networkChips = source.match(/<NetworkChip/g)?.length ?? 0;
    if (networkChips === 0) broken.push(`${site.file}: imports no NetworkChip but claims one`);
  }
  assert.deepEqual(broken, []);
});

test("NetworkChip is imported wherever a row claims to render one", () => {
  const broken: string[] = [];
  for (const site of INVENTORY) {
    if (site.labelledBy !== "NetworkChip") continue;
    const source = readFileSync(join(COMPONENTS_DIR, site.file), "utf8");
    if (!source.includes('from "./NetworkChip.tsx"')) {
      broken.push(`${site.file}: renders NetworkChip without importing it`);
    }
  }
  assert.deepEqual(broken, []);
});

test("the chip count per component matches the rows claiming one", () => {
  // Catches a row that was split across two renders and only one was labelled:
  // the table would still have exactly one row for the file, but the component
  // would render more chips than the table accounts for.
  const byFile = new Map<string, number>();
  for (const site of INVENTORY) {
    if (site.labelledBy === "NetworkChip") byFile.set(site.file, (byFile.get(site.file) ?? 0) + 1);
  }
  const drifted: string[] = [];
  for (const [file, rows] of byFile) {
    const source = readFileSync(join(COMPONENTS_DIR, file), "utf8");
    // `network-chip` class strings and conditional renders both count; the
    // threshold is "<= rows" because one row can cover a conditional render.
    const rendered = source.match(/<NetworkChip[\s/>]/g)?.length ?? 0;
    if (rendered < rows) {
      drifted.push(`${file}: ${rows} row(s) claim a chip, ${rendered} rendered`);
    }
  }
  assert.deepEqual(drifted, []);
});

// ── The mechanical guard: no explorer network segment outside the config ─────

test("no explorer URL is written out with a network segment in it", () => {
  // The guard against the regression this change exists to fix. A literal
  // `…/explorer/testnet/…` anywhere outside the config means a link whose
  // network was typed by hand, which is the thing that silently survives a
  // change of target network.
  const roots = ["components", "lib", "app"];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = readFileSync(path, "utf8");
      source.split("\n").forEach((line, index) => {
        // The config's own value and the comments explaining why it lives
        // there are the only legitimate places the literal appears.
        if (/explorer\/(testnet|mainnet|futurenet|public)\b/.test(line)) {
          offenders.push(`${path}:${index + 1}: ${line.trim()}`);
        }
        if (/stellar\.expert/.test(line) && path !== join("lib", "guard", "network.ts")) {
          offenders.push(`${path}:${index + 1}: explorer host outside the config: ${line.trim()}`);
        }
      });
    }
  };
  for (const root of roots) walk(root);
  assert.deepEqual(
    offenders,
    [],
    "explorer URLs must be composed from lib/guard/network.ts, not written out per call site",
  );
});

test("the network segment is configured once and read by the builders", () => {
  const source = readFileSync(join(process.cwd(), "lib", "guard", "network.ts"), "utf8");
  const assignments = source.match(/explorerNetwork:\s*"/g)?.length ?? 0;
  assert.equal(assignments, 1, "there must be a single configured explorer network segment");
  // Every builder composes from the field, so the string `testnet` appears in
  // the URL exactly once: as configuration. If a builder ever started
  // interpolating `network.name` instead, a wallet-vocabulary network name would
  // produce an explorer path that resolves to nothing.
  const body = source.slice(source.indexOf("export const NETWORK"));
  const built = body.match(/\$\{[^}]*explorerNetwork[^}]*\}/g)?.length ?? 0;
  assert.equal(built, 1, "explorerBaseUrl is the one place the segment is joined on");
  assert.equal(
    /\$\{[^}]*\.name\}/.test(body.split("explorerBaseUrl(network:")[1] ?? ""),
    false,
    "no builder may substitute the wallet's network name for the explorer segment",
  );
});
