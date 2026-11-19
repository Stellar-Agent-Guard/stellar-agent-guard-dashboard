/**
 * Heading hierarchy and landmarks on every route (#534).
 *
 * Checked in a real browser against the rendered DOM, because source-level checks
 * cannot see what a route's components actually emit together. For each of the five
 * screens: exactly one banner, one main and one `<h1>`; a labelled primary
 * navigation; headings that never skip a level going down the page (h1 → h2 → h3,
 * never h1 → h3); and every landmark of a kind that appears more than once carries
 * a distinct name. The source-level half of this contract lives in
 * `tests/unit/routeLandmarks.test.ts`.
 */

import { expect, test, type Page } from "@playwright/test";

/** The app's only external dependency; failing it keeps the pages offline-deterministic. */
const SOROBAN_RPC = /soroban-testnet\.stellar\.org/;

const ROUTES = [
  { name: "overview", path: "/" },
  { name: "configure", path: "/configure" },
  { name: "deploy", path: "/deploy" },
  { name: "fleet", path: "/fleet" },
  { name: "panic", path: "/panic" },
] as const;

interface PageStructure {
  headings: Array<{ level: number; text: string }>;
  banners: number;
  mains: number;
  navLabels: Array<string | null>;
}

async function structure(page: Page): Promise<PageStructure> {
  return await page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const box = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        (box.width > 0 || box.height > 0)
      );
    };
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]"))
      .filter(visible)
      .map((el) => ({
        level: el.hasAttribute("aria-level")
          ? Number(el.getAttribute("aria-level"))
          : Number(el.tagName.slice(1)),
        text: (el.textContent ?? "").trim(),
      }));
    // A <header> is a banner only when it is not nested in main/article/section.
    const banners = Array.from(document.querySelectorAll("header, [role=banner]")).filter(
      (el) => !el.closest("main, article, section, aside, nav") && visible(el),
    ).length;
    const mains = document.querySelectorAll("main, [role=main]").length;
    const navLabels = Array.from(document.querySelectorAll("nav, [role=navigation]")).map(
      (el) => el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby"),
    );
    return { headings, banners, mains, navLabels };
  });
}

/** The first place a heading list jumps down more than one level, or null. */
export function firstHeadingSkip(headings: Array<{ level: number; text: string }>): string | null {
  let previous = 0;
  for (const heading of headings) {
    if (heading.level > previous + 1) {
      return `h${previous || "(none)"} → h${heading.level} "${heading.text}"`;
    }
    previous = heading.level;
  }
  return null;
}

test.beforeEach(async ({ page }) => {
  await page.route(SOROBAN_RPC, (route) => route.abort());
});

for (const route of ROUTES) {
  test(`${route.name} (${route.path}) has one banner, one main, one h1 and an unbroken heading order`, async ({
    page,
  }) => {
    await page.goto(route.path, { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    // The route's own content has rendered, not just the layout.
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 60_000 });

    const found = await structure(page);
    expect(found.mains, "exactly one main landmark").toBe(1);
    expect(found.banners, "exactly one banner landmark").toBe(1);
    expect(found.headings.filter((h) => h.level === 1)).toHaveLength(1);
    expect(found.headings[0]?.level, "the h1 comes first").toBe(1);
    expect(firstHeadingSkip(found.headings), "heading levels must not skip").toBeNull();

    // Every navigation landmark is named, and the names are distinct.
    expect(found.navLabels.length).toBeGreaterThan(0);
    for (const label of found.navLabels) expect(label).toBeTruthy();
    expect(new Set(found.navLabels).size).toBe(found.navLabels.length);

    // The skip link leads to the main landmark.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();
  });
}

test("the heading-order check itself reports a skipped level", () => {
  expect(
    firstHeadingSkip([
      { level: 1, text: "A" },
      { level: 3, text: "B" },
    ]),
  ).toContain("h1 → h3");
  expect(
    firstHeadingSkip([
      { level: 1, text: "A" },
      { level: 2, text: "B" },
      { level: 3, text: "C" },
      { level: 2, text: "D" },
    ]),
  ).toBeNull();
});
