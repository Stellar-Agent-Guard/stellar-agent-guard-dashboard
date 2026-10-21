/**
 * Contrast contract for status, severity and disabled-action presentation (issue #367).
 *
 * The dashboard's operator has to tell frozen from clear, blocked from allowed,
 * and disabled from ready — sometimes in bright light, sometimes without
 * reliable colour perception. jsdom cannot compute rendered contrast (see the
 * axe-core note in a11yAudit.test.ts), so this test does the arithmetic itself:
 * it parses the theme token blocks out of `app/globals.css`, computes WCAG 2.1
 * relative-luminance contrast for the representative token pairs, and asserts
 * the non-colour severity cues exist right beside the colour ones.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CSS_PATH = "app/globals.css";
const css = readFileSync(CSS_PATH, "utf8");

/** One gamma-expanded channel: red (0), green (2) or blue (4) of a hex colour. */
function channel(hex: string, offset: number): number {
  const raw = parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
  return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  assert.match(hex, /^#([0-9a-f]{6})$/i, `expected a #rrggbb token, got ${JSON.stringify(hex)}`);
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4);
}

/** WCAG 2.1 contrast ratio, in either direction. */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

interface CssBlock {
  selector: string;
  body: string;
}

/** Every top-level css rule the stylesheet defines, with its captured groups typed. */
function cssBlocks(): CssBlock[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const selector = match[1];
    const body = match[2];
    if (selector === undefined || body === undefined) {
      throw new Error(`unexpected css block match: ${match[0]}`);
    }
    return { selector, body };
  });
}

/** Look a token up out of a parsed theme; a missing token aborts the test. */
function token(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (value === undefined) {
    throw new Error(`the theme does not declare ${name}`);
  }
  return value;
}

/** Pull `--token: value` declarations out of the rule whose selector contains `needle`. */
function tokensIn(selectorNeedle: string): Record<string, string> {
  for (const block of cssBlocks()) {
    if (block.selector.includes(selectorNeedle)) {
      const tokens: Record<string, string> = {};
      for (const declaration of block.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        const name = declaration[1];
        const value = declaration[2];
        if (name === undefined || value === undefined) {
          throw new Error(`unexpected declaration match: ${declaration[0]}`);
        }
        tokens[name] = value.trim();
      }
      if (Object.keys(tokens).length > 0) return tokens;
    }
  }
  throw new Error(`no declarations found for selector containing ${JSON.stringify(selectorNeedle)}`);
}

/** One #rrggbb value out of a rule (e.g. a surface overridden per theme). */
function hexIn(selectorNeedle: string, property: string): string | null {
  for (const block of cssBlocks()) {
    if (block.selector.includes(selectorNeedle)) {
      const match = new RegExp(`${property}\\s*:\\s*(#[0-9a-f]{6})`, "i").exec(block.body);
      const colour = match?.[1];
      if (colour) return colour;
    }
  }
  return null;
}

interface Theme {
  name: string;
  tokens: Record<string, string>;
  /** Severity pill surfaces, from this theme's own overrides when it has them. */
  pill: { ok: string; warn: string; danger: string };
}

function theme(needle: string, name: string): Theme {
  const tokens = tokensIn(needle);
  // A theme may restyle a pill's border without redefining its tinted surface;
  // the base rule (selector exactly `.pill.tier`) supplies the surface then.
  const baseHex = (tier: string): string => {
    for (const block of cssBlocks()) {
      if (block.selector.trim() === `.pill.${tier}`) {
        const match = /background:\s*(#[0-9a-f]{6})/i.exec(block.body);
        const colour = match?.[1];
        if (colour) return colour;
      }
    }
    throw new Error(`no base pill surface for ${tier}`);
  };
  const surface = (tier: string) =>
    hexIn(`${needle} .pill.${tier}`, "background") ?? baseHex(tier);
  return {
    name,
    tokens,
    pill: {
      ok: surface("ok"),
      warn: surface("warn"),
      danger: surface("danger"),
    },
  };
}

const THEMES: Theme[] = [
  theme("[data-theme=\"light\"]", "light"),
  theme("[data-theme=\"high-contrast\"]", "high-contrast"),
  // The dark theme has no pill-surface overrides; it owns the base rule.
  theme(":root", "dark"),
];

const REQUIRED_TOKENS = [
  "--bg",
  "--panel",
  "--panel-2",
  "--line",
  "--text",
  "--muted",
  "--accent",
  "--ok",
  "--warn",
  "--danger",
];

test("every theme declares the full token set", () => {
  for (const { name, tokens } of THEMES) {
    for (const token of REQUIRED_TOKENS) {
      assert.match(tokens[token] ?? "", /^#/, `${name} must define ${token}`);
    }
  }
});

test("body and panel text meet AA contrast in every theme", () => {
  for (const { name, tokens } of THEMES) {
    const pairs: Array<[string, string, number]> = [
      ["--text", "--bg", 7],
      ["--text", "--panel", 7],
      ["--text", "--panel-2", 7],
      ["--muted", "--bg", 4.5],
      ["--muted", "--panel", 4.5],
      ["--muted", "--panel-2", 4.5],
    ];
    for (const [fg, bg, minimum] of pairs) {
      const ratio = contrast(token(tokens, fg), token(tokens, bg));
      assert.ok(
        ratio >= minimum,
        `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
      );
    }
  }
});

test("the high-contrast theme clears the stronger body-text target", () => {
  const tokens = tokensIn("[data-theme=\"high-contrast\"]");
  for (const bg of ["--bg", "--panel", "--panel-2"]) {
    const ratio = contrast(token(tokens, "--text"), token(tokens, bg));
    assert.ok(ratio >= 14, `high-contrast text on ${bg} is ${ratio.toFixed(2)}:1, needs 14:1`);
  }
});

test("interactive accents meet AA against the surfaces they sit on", () => {
  for (const { name, tokens } of THEMES) {
    for (const bg of ["--bg", "--panel", "--panel-2"]) {
      const ratio = contrast(token(tokens, "--accent"), token(tokens, bg));
      assert.ok(ratio >= 4.5, `${name}: accent on ${bg} is ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
});

test("status and severity colours read on their own pill surfaces", () => {
  for (const { name, tokens, pill } of THEMES) {
    const severity: Array<[string, string, string]> = [
      ["--ok", pill.ok, "ok pill"],
      ["--warn", pill.warn, "warn pill"],
      ["--danger", pill.danger, "danger pill"],
    ];
    for (const [fg, bg, label] of severity) {
      const ratio = contrast(token(tokens, fg), bg);
      assert.ok(ratio >= 4.5, `${name}: ${label} text is ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
});

test("light-theme solid buttons keep AA text contrast", () => {
  // The light theme overrides button text colour because the dark theme's ink
  // would fail on the darker accent; the pair it forms is asserted here.
  const accent = token(tokensIn('[data-theme="light"]'), "--accent");
  const rule = cssBlocks().find((block) =>
    block.selector.includes('[data-theme="light"] button'),
  );
  assert.ok(rule, "the light theme must override button text");
  const colour = /color:\s*(#[0-9a-f]{6})/i.exec(rule.body)?.[1];
  assert.ok(colour, "the light-theme button override must name a hex colour");
  assert.ok(contrast(colour, accent) >= 4.5, "light-theme buttons must carry AA text");
});

test("severity is never colour alone: pills and buttons carry glyphs", () => {
  assert.match(css, /\.pill\.danger::before\s*\{[^}]*content:/, "danger pills need a glyph");
  assert.match(css, /\.pill\.warn::before\s*\{[^}]*content:/, "warn pills need a glyph");
  assert.match(
    css,
    /button:disabled::before\s*\{[^}]*content:/,
    "disabled actions need a non-colour cue",
  );
  assert.match(css, /button:disabled\s*\{[^}]*cursor:\s*not-allowed/, "and a not-allowed cursor");
});

test("the high-contrast tier keeps a theme-coloured border on severity pills", () => {
  // Even a greyscale render must separate the tiers; the border colour is the
  // tier token, which does not depend on the pill's tinted surface.
  const block = cssBlocks().find((candidate) =>
    candidate.selector.includes('[data-theme="high-contrast"] .pill.danger'),
  );
  assert.ok(block, "the high-contrast theme must restyle the danger pill");
  assert.match(block.body, /border-color:\s*var\(--danger\)/);
});
