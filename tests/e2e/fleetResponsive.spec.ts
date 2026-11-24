/**
 * Fleet recovery states on phones (#538).
 *
 * `tests/visual/responsive.spec.ts` guards populated screens with pixel baselines.
 * This spec covers the states an operator hits when something is wrong, with
 * geometry assertions instead of screenshots, so it needs no baselines and cannot
 * drift with fonts: at 320 and 375 px wide there must be no horizontal overflow, no
 * element poking past the viewport, no clipped text, and the explanation of a
 * failure must be printed in the page, not hidden in a tooltip.
 *
 *   loading  the RPC never answers, so the first fleet read stays pending and the
 *            skeleton rows hold the table's shape
 *   error    every read fails; each guard says why in visible text
 *   empty    a search that matches nothing, with its recovery button
 *
 * The "registry empty" state is not reachable in a browser: the build always seeds
 * known guards, so the registry is never empty. `fleetTableState` unit tests cover
 * that branch; the filter-empty state shares its markup and is exercised here.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const SOROBAN_RPC = /soroban-testnet\.stellar\.org/;

const PHONES = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
] as const;

/** The page must not scroll sideways. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "document wider than the viewport").toBeLessThanOrEqual(innerWidth);
}

/** Every matched element sits inside the viewport horizontally and none of its text is clipped. */
async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const width = page.viewportSize()!.width;
  const elements = await locator.all();
  expect(elements.length).toBeGreaterThan(0);
  for (const element of elements) {
    await expect(element).toBeVisible();
    const box = (await element.boundingBox())!;
    expect(box.x, "left edge off screen").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "right edge off screen").toBeLessThanOrEqual(width + 0.5);
    const clipped = await element.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, "text is clipped by its own box").toBe(false);
  }
}

for (const phone of PHONES) {
  test.describe(`fleet on a ${phone.name} phone`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height } });

    test("loading: skeleton rows fit the screen while the first read is pending", async ({
      page,
    }) => {
      // Held, never answered: the fleet stays in its pending state.
      await page.route(SOROBAN_RPC, () => new Promise(() => {}));
      await page.goto("/fleet", { timeout: 90_000 });
      const skeletons = page.locator("table.events tbody tr[aria-busy='true']");
      await expect(skeletons).toHaveCount(3, { timeout: 60_000 });
      await expectInsideViewport(page, skeletons);
      await expectNoHorizontalOverflow(page);
      // A pending read is never rendered as a verdict.
      await expect(page.getByText("Read failed")).toHaveCount(0);
    });

    test("error: every failed read explains itself in visible, unclipped text", async ({
      page,
    }) => {
      await page.route(SOROBAN_RPC, (route) => route.abort());
      await page.goto("/fleet", { timeout: 90_000 });
      const reasons = page.getByTestId("fleet-read-error");
      await expect(reasons.first()).toBeVisible({ timeout: 90_000 });
      await expect(reasons.first()).toContainText("Read failed:");
      await expectInsideViewport(page, reasons);
      // Unknown is the status of an unread guard, shown alongside its reason.
      await expect(
        page.locator("table.events .pill", { hasText: "Unknown" }).first(),
      ).toBeVisible();
      // No row's reason lives only in a tooltip: the old warning glyph is gone.
      await expect(page.locator("table.events [title]", { hasText: "⚠" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    test("empty: a search with no match shows its message and recovery button", async ({
      page,
    }) => {
      await page.route(SOROBAN_RPC, (route) => route.abort());
      await page.goto("/fleet", { timeout: 90_000 });
      await expect(page.getByTestId("fleet-read-error").first()).toBeVisible({ timeout: 90_000 });

      await page.getByLabel("Search").fill("no-such-guard-zzz");
      const title = page.getByText("No guards match the current search or filters");
      const recover = page.getByRole("button", { name: "Clear search and filters" });
      await expect(title).toBeVisible();
      await expect(
        page.getByText("Clear the search or set the filters back to All."),
      ).toBeVisible();
      await expectInsideViewport(page, title);
      await expectInsideViewport(page, recover);
      await expectNoHorizontalOverflow(page);

      // The recovery control does what it says, and the table comes back.
      await recover.click();
      await expect(page.getByTestId("fleet-read-error").first()).toBeVisible();
    });
  });
}
