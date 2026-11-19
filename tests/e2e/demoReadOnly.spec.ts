/**
 * Demo mode stays read-only on every route (issue #546).
 *
 * Demo data describes no real account, so nothing may be signed or submitted
 * while it is shown — including when an operator opens a write route
 * (`/configure`, `/deploy`, `/panic`) directly by URL rather than navigating
 * there. Each route is opened with `?demo=true` against a wallet that has
 * already authorized this site (so it would reconnect on its own if it could)
 * and a mocked chain that records every RPC method it is asked for.
 *
 * The assertions are what an operator sees — the demo badge and the read-only
 * explanation beside a disabled connect button — and the two counters that
 * prove nothing happened behind the UI: no wallet sign request and no
 * `sendTransaction`.
 */

import { expect, test, type Page } from "@playwright/test";
import { installFreighterMock, signRequestCount } from "./walletMock.ts";
import { installSorobanRpcMock, type SorobanRpcMock } from "./sorobanRpcMock.ts";
import { DEMO_BADGE_TEXT, DEMO_READ_ONLY_TEXT } from "../../lib/guard/demoFixtures.ts";

const ROUTES = ["/", "/configure", "/deploy", "/panic"] as const;

/** A wallet that already authorized the site, so it would auto-reconnect if allowed. */
async function preauthorizeWallet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("stellar-agent-guard.e2e.wallet-authorized", "1");
  });
}

async function openInDemo(page: Page, route: string): Promise<SorobanRpcMock> {
  const chain = await installSorobanRpcMock(page);
  await installFreighterMock(page);
  await preauthorizeWallet(page);
  await page.goto(`${route}?demo=true`);
  await expect(page.getByText(DEMO_BADGE_TEXT)).toBeVisible();
  return chain;
}

test.describe("demo mode is read-only on every route", () => {
  for (const route of ROUTES) {
    test(`${route} explains demo mode and offers no way to sign`, async ({ page }) => {
      const chain = await openInDemo(page, route);

      await expect(page.getByTestId("demo-read-only")).toHaveText(DEMO_READ_ONLY_TEXT);
      const connect = page.getByRole("button", { name: "Connect admin wallet" });
      await expect(connect).toBeVisible();
      await expect(connect).toBeDisabled();
      // A pre-authorized wallet did not reclaim the session either.
      await expect(page.locator(".pill.ok").filter({ hasText: "connected" })).toHaveCount(0);

      // Give any deferred effect time to fire before asserting the absence.
      await page.waitForTimeout(1_000);
      expect(await signRequestCount(page)).toBe(0);
      expect(chain.requests).not.toContain("sendTransaction");
    });
  }

  test("a write route opened directly keeps every write control unusable", async ({ page }) => {
    const chain = await openInDemo(page, "/panic");

    // Every enabled button on the page is a read or presentation control: any
    // button naming a write is disabled, because no wallet can be connected.
    const writeButtons = page.getByRole("button", {
      name: /freeze|unfreeze|deploy|install|initialize|submit|sign/i,
    });
    const count = await writeButtons.count();
    for (let i = 0; i < count; i++) {
      await expect(writeButtons.nth(i)).toBeDisabled();
    }

    expect(await signRequestCount(page)).toBe(0);
    expect(chain.requests).not.toContain("sendTransaction");
  });

  test("leaving demo mode restores the connect button", async ({ page }) => {
    await installSorobanRpcMock(page);
    await installFreighterMock(page);
    await page.goto("/");
    await expect(page.getByText(DEMO_BADGE_TEXT)).toHaveCount(0);
    await expect(page.getByTestId("demo-read-only")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect admin wallet" })).toBeEnabled();
  });
});
