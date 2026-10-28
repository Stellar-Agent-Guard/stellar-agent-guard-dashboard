/**
 * E2E responsive test covering critical status and error states at mobile (375x667)
 * and desktop (1280x800) viewports (issue #358).
 *
 * Verifies:
 * - Long addresses (56-character G... and C... strkeys) do not cause horizontal overflow.
 * - Long RPC error copy wraps cleanly without breaking layout.
 * - Pending transaction states and panic controls remain visible, named, and keyboard reachable.
 * - Touch targets on mobile meet height requirements.
 */

import { expect, test, type Page } from "@playwright/test";
import { PHASE1_ARTIFACT } from "../../lib/guard/network.ts";
import { installFreighterMock, MOCK_ADMIN_ADDRESS } from "./walletMock.ts";
import { installSorobanRpcMock, type SorobanRpcMock } from "./sorobanRpcMock.ts";

const TEST_GUARD = PHASE1_ARTIFACT.guard;
const LONG_RPC_ERROR =
  "RPC_ERROR_SIMULATION_FAILED_TRANSACTION_EXPIRED_OR_RESOURCE_LIMIT_EXCEEDED_FOR_OPERATION_INVOKE_CONTRACT_WITH_EXTENDED_DIAGNOSTIC_XDR_AND_TRACE_DATA_CONTAINING_UNSPACED_IDENTIFIER_STRING_0123456789ABCDEF_END_OF_DIAGNOSTIC";

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
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

const VIEWPORTS = [
  { name: "mobile phone", width: 375, height: 667 },
  { name: "desktop", width: 1280, height: 800 },
];

test.describe("Responsive viewports & critical states (#358)", () => {
  test.slow();

  let chain: SorobanRpcMock;

  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} (${vp.width}x${vp.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        chain = await installSorobanRpcMock(page);
        await installFreighterMock(page);
      });

      test("renders long addresses and primary controls without horizontal overflow", async ({
        page,
      }) => {
        await page.goto("/panic");
        await ensureWalletConnected(page);

        // Assert 56-char guard address is visible
        await expect(page.getByText(TEST_GUARD).first()).toBeVisible();
        await expect(page.getByTitle(MOCK_ADMIN_ADDRESS)).toBeVisible();

        await assertNoHorizontalOverflow(page);

        // Assert panic button is visible, named, and keyboard reachable
        const freezeBtn = page.getByRole("button", { name: "Freeze this account" });
        await expect(freezeBtn).toBeVisible();
        await freezeBtn.focus();
        await expect(freezeBtn).toBeFocused();

        const unfreezeBtn = page.getByRole("button", { name: "Unfreeze", exact: true });
        await expect(unfreezeBtn).toBeVisible();
      });

      test("renders long RPC error copy cleanly without horizontal overflow", async ({ page }) => {
        await page.goto("/panic");
        await ensureWalletConnected(page);

        chain.nextStatusError = LONG_RPC_ERROR;

        await page.getByRole("button", { name: "Freeze this account" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await dialog.locator("#ack-freeze").check();
        await dialog.getByRole("button", { name: "Sign freeze" }).click();

        // Assert error block with long un-spaced string is visible and wrapped
        await expect(page.getByText("Freeze NOT confirmed")).toBeVisible();
        const errorBlock = page.locator(".error", { hasText: "Freeze NOT confirmed" });
        await expect(errorBlock).toContainText("could not be re-read to confirm its effect");

        await assertNoHorizontalOverflow(page);
      });

      test("modal and pending states are visible, reachable, and sized for viewport", async ({
        page,
      }) => {
        await page.goto("/panic");
        await ensureWalletConnected(page);

        await page.getByRole("button", { name: "Freeze this account" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();

        // Modal should fit within viewport
        const dialogBox = await dialog.boundingBox();
        expect(dialogBox).not.toBeNull();
        expect(dialogBox!.width).toBeLessThanOrEqual(vp.width);

        // Buttons in modal must be visible and keyboard reachable
        const signBtn = dialog.getByRole("button", { name: "Sign freeze" });
        const cancelBtn = dialog.getByRole("button", { name: "Cancel" });

        await cancelBtn.focus();
        await expect(cancelBtn).toBeFocused();

        if (vp.width <= 720) {
          // Touch target height assertion on mobile
          const cancelBox = await cancelBtn.boundingBox();
          expect(cancelBox!.height).toBeGreaterThanOrEqual(44);
        }

        await dialog.locator("#ack-freeze").check();
        await signBtn.click();

        // Check pending/verifying state notice
        await expect(page.getByText(/Waiting for the wallet…|Verifying on chain…/)).toBeVisible();

        await assertNoHorizontalOverflow(page);
      });
    });
  }
});
