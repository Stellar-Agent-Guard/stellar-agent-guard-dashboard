/**
 * A wallet network switch invalidates every cached guard summary (issue #544).
 *
 * With the overview's panels open (status, policy, spend window and the rest
 * of the grid), the operator connects a wallet on the wrong network and then
 * switches it back. Each switch must drop what was read before it: the
 * console starts fresh chain reads rather than keeping the pre-switch values
 * on screen. What the operator chose about *presentation* — layout, density,
 * theme — is local preference, not chain data, and must survive untouched.
 *
 * Reads are counted at the RPC route (`simulateTransaction` is how every guard
 * summary is read), so "fresh values" is asserted as new reads after the
 * switch, not inferred from a re-render.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import {
  connectWalletFromUi,
  installWalletMock,
  MAINNET_PASSPHRASE,
  switchWalletNetwork,
} from "./networkMismatchWalletMock.ts";
import { handleRpcRequest } from "./rpcFixtures.ts";

const MISMATCH_BANNER = /Wallet on Mainnet, dashboard on Testnet/;
const PRESENTATION_KEY = /layout|density|theme|grid|columns/i;

interface ReadCounter {
  reads: () => number;
}

async function mockSorobanRpc(page: Page): Promise<ReadCounter> {
  let reads = 0;
  await page.route("https://soroban-testnet.stellar.org/**", (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") return void route.fulfill({ status: 405, body: "" });
    const body = request.postDataJSON() as { method?: string };
    if (body.method === "simulateTransaction") reads++;
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: handleRpcRequest(body).body,
    });
  });
  return { reads: () => reads };
}

/** Every presentation preference the page has stored, keyed by storage key. */
async function presentationPrefs(page: Page): Promise<Record<string, string>> {
  return await page.evaluate((pattern) => {
    const re = new RegExp(pattern, "i");
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && re.test(key)) out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  }, PRESENTATION_KEY.source);
}

/** Wait until the read count stops moving, so later deltas are attributable. */
async function settle(page: Page, counter: ReadCounter): Promise<number> {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const now = counter.reads();
    if (now === last && now > 0) return now;
    last = now;
    await page.waitForTimeout(500);
  }
  return counter.reads();
}

test.describe("network switch invalidates cached guard summaries", () => {
  test("switching back to the dashboard's network re-reads every summary and keeps preferences", async ({
    page,
  }) => {
    const counter = await mockSorobanRpc(page);
    await installWalletMock(page, { networkPassphrase: MAINNET_PASSPHRASE, network: "Mainnet" });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Stellar Agent Guard" })).toBeVisible();

    // A presentation choice the operator made: toggle the theme so a
    // preference is actually stored, whatever its key.
    const themeToggle = page.getByRole("button", { name: /theme|dark|light/i }).first();
    if (await themeToggle.isVisible()) await themeToggle.click();
    const theme = await page.locator("html").getAttribute("data-theme");

    await connectWalletFromUi(page);
    await expect(page.getByText(MISMATCH_BANNER)).toBeVisible();
    const before = await settle(page, counter);
    const prefsBefore = await presentationPrefs(page);

    // The operator fixes the wallet's network and reconnects.
    await switchWalletNetwork(page, "testnet");
    await connectWalletFromUi(page);
    await expect(page.getByText(MISMATCH_BANNER)).toHaveCount(0);
    await expect(page.getByText("connected", { exact: true })).toBeVisible();

    // Fresh chain reads were started for the summaries after the switch...
    await expect.poll(() => counter.reads(), { timeout: 15_000 }).toBeGreaterThan(before);
    // ...and the panels show those values again rather than staying empty.
    await expect(page.getByRole("button", { name: "Freeze this account" })).toBeEnabled();

    // Presentation preferences are untouched by the invalidation.
    expect(await presentationPrefs(page)).toEqual(prefsBefore);
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
  });

  test("moving into a mismatch also drops the summaries read before it", async ({ page }) => {
    const counter = await mockSorobanRpc(page);
    await installWalletMock(page, { networkPassphrase: MAINNET_PASSPHRASE, network: "Mainnet" });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Stellar Agent Guard" })).toBeVisible();

    // Start on the right network.
    await switchWalletNetwork(page, "testnet");
    await connectWalletFromUi(page);
    await expect(page.getByText("connected", { exact: true })).toBeVisible();
    const before = await settle(page, counter);

    // Then the wallet moves to mainnet and is reconnected: a switch the other way.
    await page.getByRole("button", { name: "Disconnect" }).click();
    await switchWalletNetwork(page, "mainnet");
    await connectWalletFromUi(page);
    await expect(page.getByText(MISMATCH_BANNER)).toBeVisible();
    await expect.poll(() => counter.reads(), { timeout: 15_000 }).toBeGreaterThan(before);
  });
});
