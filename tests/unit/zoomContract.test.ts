/**
 * The 200% zoom contract (issue #530).
 *
 * jsdom has no layout engine, so this asserts the wiring that makes zoom safe
 * rather than the pixels: the zoom breakpoint rules exist, the critical action
 * rows opt into them, the shell re-evaluates the breakpoint on `resize` (which
 * browser zoom fires), and the visible focus indicator is never removed.
 *
 * Layout at 200% is a manual check, named in docs/screens/overview.md and in the
 * PR checklist: a 1280px monitor at 200% is a 640 CSS px viewport.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stylesheet = readFileSync("app/globals.css", "utf8");
const panicSource = readFileSync("components/PanicPanel.tsx", "utf8");
const walletSource = readFileSync("components/WalletBar.tsx", "utf8");
const policySource = readFileSync("components/PolicyForm.tsx", "utf8");
const shellSource = readFileSync("components/LayoutShell.tsx", "utf8");

/** Extract a top-level `@media` block's body by brace matching. */
function mediaBlock(query: string): string {
  const start = stylesheet.indexOf(`@media ${query}`);
  assert.ok(start >= 0, `expected an @media ${query} block in globals.css`);
  let depth = 0;
  let i = stylesheet.indexOf("{", start);
  const open = i;
  for (; i < stylesheet.length; i++) {
    if (stylesheet[i] === "{") depth += 1;
    if (stylesheet[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return stylesheet.slice(open, i + 1);
}

const zoomBlock = mediaBlock("(max-width: 720px)");

test("the zoom breakpoint covers 200% of a 1280px window", () => {
  // 1280 / 2 = 640 CSS px, comfortably inside the 720px block.
  assert.ok(640 < 720);
});

test("critical actions stack full-width with a 44px target instead of clipping", async (t) => {
  await t.test("the action row becomes a column", () => {
    assert.match(zoomBlock, /\.critical-actions\s*\{[^}]*flex-direction:\s*column/);
    assert.match(zoomBlock, /\.critical-actions\s*\{[^}]*align-items:\s*stretch/);
  });

  await t.test("its buttons fill the row at a >=44px height", () => {
    assert.match(
      zoomBlock,
      /\.critical-actions > button,\s*\.critical-actions \.row > button\s*\{[^}]*width:\s*100%/,
    );
    assert.match(
      zoomBlock,
      /\.critical-actions > button,\s*\.critical-actions \.row > button\s*\{[^}]*min-height:\s*44px/,
    );
  });

  await t.test("the panic freeze actions opt in", () => {
    assert.match(panicSource, /className="row critical-actions"/);
  });

  await t.test("the network switch opts in", () => {
    assert.match(walletSource, /className="row critical-actions"/);
  });

  await t.test("the submit bar keeps its existing 44px full-width contract", () => {
    assert.match(zoomBlock, /\.form-actions button\s*\{[^}]*width:\s*100%/);
    assert.match(zoomBlock, /\.form-actions button\s*\{[^}]*min-height:\s*44px/);
    assert.match(policySource, /className="form-actions row"/);
  });
});

test("dialogs stay inside the viewport and scroll internally at high zoom", async (t) => {
  await t.test("the backdrop loses its fixed 20px gutter", () => {
    assert.match(zoomBlock, /\.modal-backdrop\s*\{[^}]*padding:\s*10px/);
  });

  await t.test("the card is capped and keeps its actions tappable", () => {
    assert.match(zoomBlock, /\.modal\s*\{[^}]*max-height:\s*calc\(100vh - 20px\)/);
    assert.match(zoomBlock, /\.modal \.row > button\s*\{[^}]*min-height:\s*44px/);
    assert.match(zoomBlock, /\.modal \.row\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

test("wide content scrolls rather than clipping at zoom", () => {
  assert.match(zoomBlock, /\.tchart-frame\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(zoomBlock, /\.scrolly\s*\{[^}]*overflow-x:\s*auto/);
});

test("the shell re-evaluates the breakpoint when zoom changes", async (t) => {
  await t.test("isMobile is state, updated on resize", () => {
    assert.match(shellSource, /const \[isMobile, setIsMobile\] = useState\(false\)/);
    assert.match(shellSource, /window\.addEventListener\("resize", update\)/);
    assert.match(shellSource, /window\.innerWidth < 768/);
    assert.doesNotMatch(
      shellSource,
      /const isMobile = typeof window !== "undefined" \? window\.innerWidth < 768 : false/,
      "a render-time-only read never sees the zoom that happened after load",
    );
  });

  await t.test("the drawer still closes when a zoom-out crosses back to desktop", () => {
    assert.match(shellSource, /window\.innerWidth >= 768 && drawerOpen/);
  });
});

test("visible focus and labels survive the zoom rules", () => {
  // The shared indicator is the same one the a11y audit relies on; no zoom rule
  // may replace it with outline:none or a colour-only cue.
  assert.match(stylesheet, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  assert.doesNotMatch(stylesheet, /outline:\s*none/);
  assert.doesNotMatch(zoomBlock, /outline:\s*none/);

  // The critical controls keep their accessible names: the freeze and switch
  // buttons render text, so stacking cannot leave an unlabelled control.
  assert.match(panicSource, /Freeze this account/);
  assert.match(walletSource, /switchButtonLabel\(networkMismatch\)/);
});
