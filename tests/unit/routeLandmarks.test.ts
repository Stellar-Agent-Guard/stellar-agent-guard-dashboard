import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Landmark and heading contract for every route (#534).
 *
 * The root layout owns the page-level structure: one banner with the only `<h1>`,
 * a labelled navigation, a skip link and one `<main>` around the route. A route
 * therefore must not add its own `<h1>` or `<main>` (a second one makes the page
 * ambiguous for screen-reader landmark navigation), and its first heading is an
 * `<h2>`. The rendered result, with heading order checked in a real browser, is
 * asserted in `tests/e2e/routeLandmarks.spec.ts`; this file pins the source
 * contract so a regression fails in the fast unit run too.
 */

const ROUTES = {
  overview: "app/page.tsx",
  configure: "app/configure/page.tsx",
  deploy: "app/deploy/page.tsx",
  fleet: "app/fleet/page.tsx",
  panic: "app/panic/page.tsx",
} as const;

const layout = readFileSync("app/layout.tsx", "utf8");

test("the layout provides one h1, one main landmark, a skip link and labelled navigation", () => {
  assert.equal((layout.match(/<h1\b/g) ?? []).length, 1, "exactly one h1");
  assert.equal((layout.match(/<main\b/g) ?? []).length, 1, "exactly one main");
  assert.match(layout, /<main id="main-content"[^>]*>\s*\{children\}\s*<\/main>/);
  assert.match(layout, /<a className="skip-link" href="#main-content">/);
  assert.match(readFileSync("components/bits.tsx", "utf8"), /<nav className="tabs" aria-label=/);
});

test("the skip link is the first focusable element and becomes visible on focus", () => {
  assert.ok(layout.indexOf('className="skip-link"') < layout.indexOf("<header"));
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.skip-link\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.skip-link:focus\s*\{[^}]*top:\s*8px/);
});

for (const [name, file] of Object.entries(ROUTES)) {
  test(`the ${name} route adds no second h1 or main`, () => {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<h1\b/, `${file} must not declare an h1`);
    assert.doesNotMatch(source, /<main\b/, `${file} must not declare a main landmark`);
    assert.doesNotMatch(source, /role="main"/);
  });
}

test("no component renders an h1 or a second main landmark", () => {
  const files = [
    "components/StatusPanel.tsx",
    "components/PanicPanel.tsx",
    "components/DeployPanel.tsx",
    "components/FleetTable.tsx",
    "components/PolicyForm.tsx",
    "components/TelemetryFeed.tsx",
    "components/DashboardGrid.tsx",
    "components/SetupWizard.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<h1\b/, `${file} must not render an h1`);
    assert.doesNotMatch(source, /<main\b/, `${file} must not render a main`);
  }
});
