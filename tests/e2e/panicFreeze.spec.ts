/**
 * E2E test verifying freeze success requires a fresh on-chain status read (issue #350).
 *
 * Assertions:
 * - Verified-freeze message ("Freeze confirmed on chain") appears ONLY after a subsequent fresh live read reports frozen.
 * - Cover 4 cases:
 *   1. Wallet cancellation (user rejects or declines in wallet).
 *   2. Read that still reports unfrozen (`admin_frozen === false`) after submission.
 *   3. Delayed read (status re-read fails initially, verified message appears only after subsequent fresh read).
 *   4. Successful submission followed immediately by confirmed fresh status re-read.
 */

import { expect, test, type Page } from "@playwright/test";
import { PHASE1_ARTIFACT } from "../../lib/guard/network.ts";
import { installFreighterMock, MOCK_ADMIN_ADDRESS } from "./walletMock.ts";
import { installSorobanRpcMock, type SorobanRpcMock } from "./sorobanRpcMock.ts";

/** Phase 1 guard address present in KNOWN_INSTANCES. */
const TEST_GUARD = PHASE1_ARTIFACT.guard;

async function ensureWalletConnected(page: Page): Promise<void> {
  const connected = page.locator(".pill.ok").filter({ hasText: "connected" });
  try {
    await connected.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    await page.getByRole("button", { name: "Connect admin wallet" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a wallet provider" });
    await expect(picker.getByText("detected", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Connect", exact: true }).click();
    await connected.waitFor({ state: "visible" });
  }
  await expect(connected).toBeVisible();
  await expect(page.getByTitle(MOCK_ADMIN_ADDRESS)).toBeVisible();
}

async function selectGuard(page: Page, guard: string): Promise<void> {
  const selector = page.locator("label.field select").first();
  await selector.selectOption(guard);
  await expect(selector).toHaveValue(guard);
}

test.describe("E2E panic flow: freeze verification requires fresh on-chain read (#350)", () => {
  test.slow();

  let chain: SorobanRpcMock;

  test.beforeEach(async ({ page }) => {
    chain = await installSorobanRpcMock(page);
    await installFreighterMock(page);
    await page.goto("/panic");
    await ensureWalletConnected(page);
    await selectGuard(page, TEST_GUARD);
  });

  test("1. Wallet cancellation does not show verified freeze", async ({ page }) => {
    const adminFreeze = page.locator(".stat", { hasText: "Admin freeze" });
    await expect(adminFreeze.locator(".v")).toHaveText("clear");

    await page.getByRole("button", { name: "Freeze this account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#ack-freeze").check();

    // Reject next wallet transaction signing request
    await page.evaluate(() => {
      (window as unknown as { __mockFreighterRejectNext?: boolean }).__mockFreighterRejectNext =
        true;
    });

    await dialog.getByRole("button", { name: "Sign freeze" }).click();

    // Assert error is shown and verified freeze message NEVER appears
    await expect(page.getByText("The freeze could not be completed")).toBeVisible();
    await expect(page.getByText("Freeze confirmed on chain")).toHaveCount(0);
    await expect(adminFreeze.locator(".v")).toHaveText("clear");
  });

  test("2. Submission with unfrozen on-chain re-read shows NOT confirmed", async ({ page }) => {
    const adminFreeze = page.locator(".stat", { hasText: "Admin freeze" });
    await expect(adminFreeze.locator(".v")).toHaveText("clear");

    // Disable auto-freeze on mock chain so contract status remains unfrozen after tx
    chain.autoFreeze = false;

    await page.getByRole("button", { name: "Freeze this account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#ack-freeze").check();
    await dialog.getByRole("button", { name: "Sign freeze" }).click();

    // Assert "Freeze NOT confirmed" is shown and verified freeze message NEVER appears
    await expect(page.getByText("Freeze NOT confirmed")).toBeVisible();
    await expect(
      page.getByText(
        /status\(\)\.admin_frozen reads false — the intended effect is NOT visible on chain/,
      ),
    ).toBeVisible();
    await expect(page.getByText("Freeze confirmed on chain")).toHaveCount(0);
    await expect(adminFreeze.locator(".v")).toHaveText("clear");

    chain.autoFreeze = true;
  });

  test("3. Delayed status read shows unconfirmed initially, confirmed after fresh read", async ({
    page,
  }) => {
    const adminFreeze = page.locator(".stat", { hasText: "Admin freeze" });
    await expect(adminFreeze.locator(".v")).toHaveText("clear");

    // Force immediate status re-read to fail with an RPC timeout error
    chain.nextStatusError = "RPC timeout during status re-read";

    await page.getByRole("button", { name: "Freeze this account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#ack-freeze").check();
    await dialog.getByRole("button", { name: "Sign freeze" }).click();

    // Verified message MUST NOT appear on delayed/failed read
    await expect(
      page.getByText(/Freeze (NOT confirmed|submitted — verification delayed)/),
    ).toBeVisible();
    const errorNotice = page.locator(".error", {
      hasText: /Freeze (NOT confirmed|submitted — verification delayed)/,
    });
    await expect(errorNotice).toContainText("could not be re-read to confirm its effect");
    await expect(page.getByText("Freeze confirmed on chain")).toHaveCount(0);

    // Binds on-chain state to frozen, so fresh subsequent read will report true
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(adminFreeze.locator(".v")).toHaveText("FROZEN");
  });

  test("4. Successful submission with confirmed on-chain re-read shows verified freeze", async ({
    page,
  }) => {
    const adminFreeze = page.locator(".stat", { hasText: "Admin freeze" });

    // Perform freeze
    await page.getByRole("button", { name: "Freeze this account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#ack-freeze").check();
    await dialog.getByRole("button", { name: "Sign freeze" }).click();

    // Assert verified freeze message appears ONLY when fresh read confirms frozen
    await expect(page.getByText("Freeze confirmed on chain")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/status\(\)\.admin_frozen now reads true/)).toBeVisible();
    await expect(adminFreeze.locator(".v")).toHaveText("FROZEN");
  });
});
