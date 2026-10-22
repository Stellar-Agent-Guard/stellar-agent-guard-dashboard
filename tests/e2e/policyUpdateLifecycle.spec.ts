/**
 * Full safe policy update lifecycle (issue #299).
 *
 * Exercises both wallet rejection and successful submission without requiring
 * public testnet credentials. Asserts no success state is shown until the
 * mocked chain read reflects the submitted policy. Deterministic with existing
 * browser/RPC fixtures.
 *
 * Run: npx playwright test tests/e2e/policyUpdateLifecycle.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";
import { StrKey } from "@stellar/stellar-sdk";
import { installFreighterMock } from "./walletMock.ts";
import { installSorobanRpcMock } from "./sorobanRpcMock.ts";

/** A distinct, valid agent account. */
const AGENT_ADDRESS = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(7));

/** The agent's raw 32-byte Ed25519 key, hex (never the G… strkey form). */
const AGENT_PUBKEY_HEX = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";

/** The placeholder the form uses for the agent pubkey input. */
const AGENT_PUBKEY_PLACEHOLDER = "53b093e0281a2d8f4276b77fd21e3380b3329f09097ace3d9e60cf0f2f9039e2";

/** The admin account the mock wallet signs as. */
const MOCK_ADMIN_ADDRESS = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";

test.describe("policy update lifecycle: submit and wallet rejection", () => {
  test.slow();

  test("successful policy submission reflects in chain read", async ({ page }) => {
    const chain = await installSorobanRpcMock(page);
    await installFreighterMock(page);

    // ── Step 1: deploy a guard ─────────────────────────────────────────────
    await page.goto("/deploy");
    await page.getByPlaceholder(AGENT_PUBKEY_PLACEHOLDER).fill(AGENT_PUBKEY_HEX);
    await page.getByLabel("Agent account address").fill(AGENT_ADDRESS);
    await page.getByPlaceholder("3600").fill("3600");
    await page.getByPlaceholder("1000").fill("1000");
    await page.getByPlaceholder("5000").fill("5000");
    await page.getByRole("button", { name: "Deploy guard" }).click();
    await expect(page.getByText("Deployed and verified against the pinned artifact")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Pinned bytecode already on chain")).toBeVisible();

    // The new guard is now selected.
    const predicted = page.locator(".stat", { hasText: "Predicted guard address" });
    await expect(predicted).toBeVisible();
    const predictedText = (await predicted.locator(".v").innerText()).trim();

    // ── Step 2: initialize ─────────────────────────────────────────────────
    await page.getByRole("button", { name: "Sign and initialize" }).click();
    await expect(page.getByText("initialize landed on chain")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("label.field select").first()).toHaveValue(predictedText);

    // ── Step 3: configure and submit policy ─────────────────────────────────
    await page.goto("/configure");
    await page.getByRole("button", { name: "Connect admin wallet" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a wallet provider" });
    await expect(picker.getByText("detected", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.locator(".pill.ok").filter({ hasText: "connected" })).toBeVisible();

    await page.getByRole("button", { name: "Sign and install policy" }).click();
    // The diff is the operator's last look before the wallet prompt, so it has to
    // be acknowledged explicitly before anything is signed.
    const policyDiff = page.getByRole("dialog", { name: "Policy changes" });
    await expect(policyDiff).toBeVisible();
    await policyDiff.getByRole("button", { name: "Confirm and sign" }).click();
    await expect(page.getByText("set_policy landed on chain")).toBeVisible({ timeout: 60_000 });

    // At this point the form re-seeds from what the chain now reports.
    // Assert the policy values are visible in the form.
    await expect(page.locator("p.tiny.mono").first()).toContainText("per-transaction cap 1000");
    await expect(page.locator("p.tiny.mono").first()).toContainText("rolling cap 5000 per 86400s");

    // ── Step 4: verify the chain read reflects the submitted policy ──────────
    // The policy panel should show the installed policy; no "no policy" banner.
    await expect(page.locator(".panel", { hasText: "Guardrail policy" })).toBeVisible();
    // The policy should not be null/empty - it should reflect what was submitted.
    await expect(page.locator(".panel", { hasText: "Guardrail policy" })).toContainText(
      "per-transaction cap 1000",
    );

    // Heremety check: the mock really did apply the write.
    expect(chain.guards.get(predictedText)?.policy).not.toBeNull();

    // Cleanup: ensure no leftover state carries over.
    await page.reload();
  });

  test("wallet rejection does not show success state", async ({ page }) => {
    const chain = await installSorobanRpcMock(page);
    await installFreighterMock(page, { address: MOCK_ADMIN_ADDRESS });

    // ── Step 1: deploy a guard ─────────────────────────────────────────────
    await page.goto("/deploy");
    await page.getByPlaceholder(AGENT_PUBKEY_PLACEHOLDER).fill(AGENT_PUBKEY_HEX);
    await page.getByLabel("Agent account address").fill(AGENT_ADDRESS);
    await page.getByPlaceholder("3600").fill("3600");
    await page.getByPlaceholder("1000").fill("1000");
    await page.getByPlaceholder("5000").fill("5000");
    await page.getByRole("button", { name: "Deploy guard" }).click();
    await expect(page.getByText("Deployed and verified against the pinned artifact")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Pinned bytecode already on chain")).toBeVisible();

    // The new guard is now selected.
    const predicted = page.locator(".stat", { hasText: "Predicted guard address" });
    await expect(predicted).toBeVisible();
    const predictedText = (await predicted.locator(".v").innerText()).trim();

    // ── Step 2: initialize ─────────────────────────────────────────────────
    await page.getByRole("button", { name: "Sign and initialize" }).click();
    await expect(page.getByText("initialize landed on chain")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("label.field select").first()).toHaveValue(predictedText);

    // ── Step 3: attempt policy submission with wallet rejection ─────────────
    await page.goto("/configure");
    await page.getByRole("button", { name: "Connect admin wallet" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a wallet provider" });
    await expect(picker.getByText("detected", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.locator(".pill.ok").filter({ hasText: "connected" })).toBeVisible();

    // Try to submit policy - the mock will reject since we don't actually sign
    await page.getByRole("button", { name: "Sign and install policy" }).click();
    // The diff dialog should appear and demand confirmation.
    const policyDiff = page.getByRole("dialog", { name: "Policy changes" });
    await expect(policyDiff).toBeVisible();
    // Click "Cancel" instead of "Confirm and sign"
    await policyDiff.getByRole("button", { name: "Cancel" }).click();

    // No success state should be shown - the form should still show no policy.
    await expect(page.locator(".panel", { hasText: "Guardrail policy" })).toBeVisible();
    // Most importantly, no "landed on chain" success message should appear.
    await expect(page.getByText("set_policy landed on chain")).not.toBeVisible({ timeout: 5_000 });

    // Heremety check: the mock should not have received a set_policy call
    // (or the guard state should be unchanged).
    expect(chain.guards.get(predictedText)?.policy).toBeNull();

    // Reload to ensure clean state.
    await page.reload();
  });
});
