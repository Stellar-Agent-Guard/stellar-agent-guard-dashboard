/**
 * The keyboard & screen-reader guide is a set of promises (issue #541).
 *
 * `docs/guides/keyboard-and-screen-reader.md` tells operators which keys work
 * where. A guide that lists a shortcut the code does not handle is worse than
 * no guide, so this file holds it to the code in three ways:
 *
 *   1. **Vocabulary.** Every key written in a `<kbd>` must be one the console
 *      actually handles, and each such key is traced to the source that
 *      handles it. A new `<kbd>` with no handler fails here.
 *   2. **Behaviour.** The bindings with real logic behind them — undo/redo and
 *      the command palette — are exercised, not just grepped.
 *   3. **Scope and discoverability.** Statements of *where* something works
 *      (palette on /configure only; preset radios without arrow keys) are
 *      pinned to the code, so changing the behaviour forces a docs update; and
 *      the in-app links to the guide resolve to a file that exists.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, before, describe, test } from "node:test";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { historyShortcut } from "../../lib/guard/useHistoryState.ts";
import { DOCS_BASE, HELP_DOCS, helpHref } from "../../lib/guard/helpLinks.ts";

installDom();

const GUIDE_PATH = HELP_DOCS.keyboard;
const guide = readFileSync(GUIDE_PATH, "utf8");
const read = (path: string) => readFileSync(path, "utf8");

/**
 * Every key the guide may name, mapped to the source that handles it. The
 * pattern must match in the named file, so the allowlist cannot outlive the
 * code it vouches for.
 */
const VERIFIED_KEYS: Record<string, Array<[file: string, pattern: RegExp]>> = {
  Ctrl: [
    ["components/CommandPalette.tsx", /e\.ctrlKey/],
    ["lib/guard/useHistoryState.ts", /event\.ctrlKey/],
  ],
  "⌘": [
    ["components/CommandPalette.tsx", /e\.metaKey/],
    ["lib/guard/useHistoryState.ts", /event\.metaKey/],
  ],
  K: [["components/CommandPalette.tsx", /e\.key === "k"/]],
  Z: [["lib/guard/useHistoryState.ts", /key === "z"/]],
  Y: [["lib/guard/useHistoryState.ts", /key === "y"/]],
  Shift: [
    ["lib/guard/useHistoryState.ts", /event\.shiftKey/],
    ["lib/guard/useModalFocus.ts", /event\.shiftKey/],
  ],
  Alt: [["lib/guard/useHistoryState.ts", /event\.altKey/]],
  Enter: [
    ["components/CommandPalette.tsx", /e\.key === "Enter"/],
    ["components/FunctionPicker.tsx", /case "Enter"/],
  ],
  Space: [["components/FunctionPicker.tsx", /case " "/]],
  Escape: [
    ["lib/guard/useModalFocus.ts", /event\.key === "Escape"/],
    ["components/CommandPalette.tsx", /e\.key === "Escape"/],
    ["components/TelemetryChart.tsx", /event\.key === "Escape"/],
  ],
  Tab: [["lib/guard/useModalFocus.ts", /event\.key !== "Tab"/]],
  Home: [
    ["components/TelemetryChart.tsx", /event\.key === "Home"/],
    ["components/FunctionPicker.tsx", /case "Home"/],
  ],
  End: [
    ["components/TelemetryChart.tsx", /event\.key === "End"/],
    ["components/FunctionPicker.tsx", /case "End"/],
  ],
  "↑": [
    ["components/CommandPalette.tsx", /e\.key === "ArrowUp"/],
    ["components/FunctionPicker.tsx", /case "ArrowUp"/],
  ],
  "↓": [
    ["components/CommandPalette.tsx", /e\.key === "ArrowDown"/],
    ["components/FunctionPicker.tsx", /case "ArrowDown"/],
  ],
  "←": [["components/TelemetryChart.tsx", /event\.key === "ArrowLeft"/]],
  "→": [["components/TelemetryChart.tsx", /event\.key === "ArrowRight"/]],
};

describe("keyboard guide: vocabulary", () => {
  const kbd = Array.from(guide.matchAll(/<kbd>([^<]+)<\/kbd>/g), (m) => m[1]!);

  test("the guide names keys at all (sanity)", () => {
    assert.ok(kbd.length > 20, `expected many <kbd> keys, found ${kbd.length}`);
  });

  test("every <kbd> key in the guide is one the console handles", () => {
    const unsupported = [...new Set(kbd)].filter((key) => !(key in VERIFIED_KEYS));
    assert.deepEqual(unsupported, [], `unsupported keys documented: ${unsupported.join(", ")}`);
  });

  for (const [key, sources] of Object.entries(VERIFIED_KEYS)) {
    test(`"${key}" is backed by a handler in the source`, () => {
      for (const [file, pattern] of sources) {
        assert.match(read(file), pattern, `${file} no longer handles ${key}`);
      }
    });
  }

  test("no bare letter shortcut exists, matching the guide's global claim", () => {
    assert.match(guide, /binds no letter key without a modifier/);
    // The only letter-key bindings are modifier-gated.
    assert.match(
      read("components/CommandPalette.tsx"),
      /e\.key === "k" && \(e\.metaKey \|\| e\.ctrlKey\)/,
    );
    assert.match(
      read("lib/guard/useHistoryState.ts"),
      /if \(!event\.metaKey && !event\.ctrlKey\) return null;/,
    );
  });
});

describe("keyboard guide: undo/redo bindings match historyShortcut", () => {
  const ev = (key: string, mods: Partial<Record<"ctrl" | "meta" | "shift" | "alt", boolean>>) => ({
    key,
    ctrlKey: Boolean(mods.ctrl),
    metaKey: Boolean(mods.meta),
    shiftKey: Boolean(mods.shift),
    altKey: Boolean(mods.alt),
  });

  test("Ctrl/⌘ + Z undoes", () => {
    assert.equal(historyShortcut(ev("z", { ctrl: true })), "undo");
    assert.equal(historyShortcut(ev("z", { meta: true })), "undo");
  });

  test("Ctrl/⌘ + Shift + Z redoes (Shift reports an upper-case key)", () => {
    assert.equal(historyShortcut(ev("Z", { ctrl: true, shift: true })), "redo");
    assert.equal(historyShortcut(ev("Z", { meta: true, shift: true })), "redo");
  });

  test("Ctrl/⌘ + Y redoes", () => {
    assert.equal(historyShortcut(ev("y", { ctrl: true })), "redo");
    assert.equal(historyShortcut(ev("y", { meta: true })), "redo");
  });

  test("Alt cancels the shortcut, and a bare Z is never a shortcut", () => {
    assert.equal(historyShortcut(ev("z", { ctrl: true, alt: true })), null);
    assert.equal(historyShortcut(ev("z", {})), null);
    assert.equal(historyShortcut(ev("y", { ctrl: true, shift: true })), null);
  });

  test("the guide documents exactly these bindings", () => {
    assert.match(guide, /<kbd>Ctrl<\/kbd> \+ <kbd>Z<\/kbd>[^\n]*Undo/);
    assert.match(guide, /<kbd>Ctrl<\/kbd> \+ <kbd>Shift<\/kbd> \+ <kbd>Z<\/kbd>[^\n]*Redo/);
    assert.match(guide, /<kbd>Ctrl<\/kbd> \+ <kbd>Y<\/kbd>[^\n]*Redo/);
  });
});

describe("keyboard guide: command palette behaviour", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let act: Act;
  let CommandPaletteInner: typeof import("../../components/CommandPalette.tsx").CommandPaletteInner;
  let root: ReturnType<typeof createRoot> | null = null;

  before(async () => {
    const loaded = await loadReact();
    React = loaded.react;
    createRoot = loaded.createRoot;
    act = loaded.act;
    ({ CommandPaletteInner } = await import("../../components/CommandPalette.tsx"));
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      await act(async () => current.unmount());
      root = null;
    }
    document.body.innerHTML = "";
  });

  async function mount(): Promise<HTMLButtonElement> {
    const host = document.createElement("div");
    const trigger = document.createElement("button");
    trigger.id = "before-palette";
    trigger.textContent = "Some control";
    document.body.append(trigger, host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        React.createElement(CommandPaletteInner, {
          router: { push: () => {} },
          guard: null,
          instances: [],
          selectGuard: () => {},
        }),
      );
    });
    return trigger;
  }

  async function ctrlK(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
      );
    });
  }

  const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]');

  test("Ctrl+K opens a labelled modal dialog and focuses the search box", async () => {
    const trigger = await mount();
    trigger.focus();
    await ctrlK();
    const dialog = document.querySelector('[role="dialog"][aria-label="Command palette"]');
    assert.ok(dialog, "the palette is exposed as a labelled dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(document.activeElement, input());
  });

  test("Escape closes the palette and returns focus to the previous control", async () => {
    const trigger = await mount();
    trigger.focus();
    await ctrlK();
    await act(async () => {
      input()!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(input(), null);
    assert.equal(document.activeElement, trigger);
  });

  test("pressing Ctrl+K again toggles it closed and also restores focus", async () => {
    const trigger = await mount();
    trigger.focus();
    await ctrlK();
    await ctrlK();
    assert.equal(input(), null);
    assert.equal(document.activeElement, trigger);
  });

  test("focus restore is skipped when the previous control left the document (edge case)", async () => {
    const trigger = await mount();
    trigger.focus();
    await ctrlK();
    trigger.remove();
    await ctrlK();
    assert.equal(input(), null);
    assert.notEqual(document.activeElement, trigger, "a detached node never takes focus");
  });

  test("the palette offers the keyboard guide and opens it in a new tab", async () => {
    const opened: unknown[][] = [];
    const original = window.open;
    window.open = ((...args: unknown[]) => {
      opened.push(args);
      return null;
    }) as typeof window.open;
    try {
      const trigger = await mount();
      trigger.focus();
      await ctrlK();
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
        el.textContent?.includes("Keyboard & Screen-Reader Guide"),
      ) as HTMLElement | undefined;
      assert.ok(option, "the guide is listed as a palette command");
      assert.match(option.textContent ?? "", /^Docs/, "under the Docs category");
      await act(async () => option.click());
      await act(async () => sleep(0));
      assert.equal(opened.length, 1);
      assert.equal(opened[0]![0], helpHref("keyboard"));
      assert.equal(opened[0]![1], "_blank");
      assert.match(String(opened[0]![2]), /noopener/);
    } finally {
      window.open = original;
    }
  });
});

describe("keyboard guide: scope statements stay true", () => {
  test("the palette is not mounted on any screen, as the guide says", () => {
    // The guide states Ctrl/⌘+K does nothing today. If a screen starts
    // rendering <CommandPalette />, this fails so the guide is updated (and
    // its keyboard table restored) in the same change.
    assert.match(guide, /\*\*Not currently available\.\*\*/);
    for (const page of [
      "app/layout.tsx",
      "app/page.tsx",
      "app/configure/page.tsx",
      "app/deploy/page.tsx",
      "app/fleet/page.tsx",
      "app/panic/page.tsx",
      "components/LayoutShell.tsx",
    ]) {
      if (!existsSync(page)) continue;
      assert.doesNotMatch(
        read(page),
        /<CommandPalette\b/,
        `${page} mounts the palette — update the guide's "Command palette" section`,
      );
    }
  });

  test("the palette's freeze entry is documented as not freezing, and indeed only alerts", () => {
    assert.match(guide, /does \*\*not\*\* sign or submit `freeze\(\)`/);
    assert.match(read("components/CommandPalette.tsx"), /alert\("Emergency freeze triggered"\)/);
  });

  test("every dialog the guide lists under the shared focus contract uses useModalFocus", () => {
    for (const file of [
      "components/PanicPanel.tsx",
      "components/PolicyDiffModal.tsx",
      "components/PolicyForm.tsx",
      "components/DashboardGrid.tsx",
      "components/SecretKeyGuard.tsx",
    ]) {
      assert.match(read(file), /useModalFocus\(/, `${file} must use the shared focus hook`);
    }
  });

  test("every dialog the guide says closes on Escape handles Escape", () => {
    for (const file of [
      "components/AddressBookModal.tsx",
      "components/StorageExplorer.tsx",
      "components/WebhookSettings.tsx",
      "components/FleetTable.tsx",
      "components/WalletBar.tsx",
      "components/UnsavedChangesProvider.tsx",
    ]) {
      assert.match(read(file), /key === "Escape"/, `${file} no longer closes on Escape`);
    }
  });

  test("the time-range presets are radios without arrow-key movement, as documented", () => {
    const picker = read("components/DateRangePicker.tsx");
    assert.match(picker, /role="radio"/);
    assert.match(picker, /aria-checked=/);
    assert.match(guide, /arrow-key movement between presets is\s+\*\*not\*\* implemented/);
    assert.doesNotMatch(
      picker,
      /Arrow(Left|Right|Up|Down)/,
      "arrow keys were added — update the guide's telemetry time range section",
    );
  });

  test("the chart's non-visual alternative exists where the guide points", () => {
    const chart = read("components/TelemetryChart.tsx");
    assert.match(chart, /<summary className="tiny">Data table<\/summary>/);
    assert.match(chart, /role="status" aria-live="polite"/);
    assert.match(chart, /tabIndex=\{0\}/);
  });
});

describe("keyboard guide: discoverability", () => {
  test("every in-app help document exists in the repository", () => {
    for (const [name, path] of Object.entries(HELP_DOCS)) {
      assert.ok(existsSync(path), `HELP_DOCS.${name} points at a missing file: ${path}`);
    }
  });

  test("help hrefs point into this repository's docs on main", () => {
    assert.equal(
      DOCS_BASE,
      "https://github.com/Stellar-Agent-Guard/stellar-agent-guard-dashboard/blob/main",
    );
    assert.equal(helpHref("keyboard"), `${DOCS_BASE}/docs/guides/keyboard-and-screen-reader.md`);
    assert.equal(helpHref("overview", "x"), `${DOCS_BASE}/docs/screens/overview.md#x`);
  });

  test("the console header links the guide", () => {
    const layout = read("app/layout.tsx");
    assert.match(layout, /href=\{helpHref\("keyboard"\)\}/);
    assert.match(layout, /keyboard help/);
    assert.match(layout, /rel="noopener noreferrer"/);
  });

  test("the guide is listed in the docs navigation", () => {
    assert.match(
      read("docs/SUMMARY.md"),
      /\[Keyboard & Screen-Reader Guide\]\(guides\/keyboard-and-screen-reader\.md\)/,
    );
  });

  test("the guide covers the four areas operators asked for", () => {
    for (const heading of [
      /^## Command palette$/m,
      /^## Tables$/m,
      /^## Dialogs$/m,
      /^## Telemetry chart and its alternatives$/m,
    ]) {
      assert.match(guide, heading);
    }
  });
});
