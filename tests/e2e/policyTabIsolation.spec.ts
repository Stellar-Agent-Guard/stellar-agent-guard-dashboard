/**
 * Policy edits stay isolated between two browser tabs (issue #542).
 *
 * Two tabs of the same console share storage and the cross-tab channel, and
 * here they also share one mocked chain (routed on the browser context), so a
 * policy installed in tab A is genuinely on chain when tab B re-reads.
 *
 * Tab B starts its own draft first. Tab A then installs a different policy.
 * Cross-tab sync makes B re-read the chain — and B must:
 *   - keep its draft exactly as typed (no overwrite, no merge),
 *   - say that the installed policy changed while it was editing,
 *   - offer to load the newly installed policy, which then replaces the draft.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { StrKey } from "@stellar/stellar-sdk";
import { installFreighterMock } from "./walletMock.ts";
import { SorobanRpcMock } from "./sorobanRpcMock.ts";

const AGENT_ADDRESS = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(7));
const AGENT_PUBKEY_HEX = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const AGENT_PUBKEY_PLACEHOLDER = "53b093e0281a2d8f4276b77fd21e3380b3329f09097ace3d9e60cf0f2f9039e2";
const RPC_HOST = "soroban-testnet.stellar.org";
const PER_TX = "Per-transaction cap (blank = off)";
const WINDOW = "Rolling-window cap (blank = off)";

/** One chain for every tab in the context. */
async function installSharedChain(context: BrowserContext): Promise<SorobanRpcMock> {
  const chain = new SorobanRpcMock();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === RPC_HOST) return chain.handle(route);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  return chain;
}

async function ensureWalletConnected(page: Page): Promise<void> {
  const connected = page.locator(".pill.ok").filter({ hasText: "connected" });
  try {
    await connected.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    await page.getByRole("button", { name: "Connect admin wallet" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a wallet provider" });
    await expect(picker.getByText("detected", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Connect", exact: true }).click();
  }
  await expect(connected).toBeVisible();
}

async function deployGuard(page: Page): Promise<string> {
  await page.goto("/deploy", { timeout: 90_000 });
  await ensureWalletConnected(page);
  await page.getByPlaceholder(AGENT_PUBKEY_PLACEHOLDER).fill(AGENT_PUBKEY_HEX);
  await page.getByLabel("Agent account address").fill(AGENT_ADDRESS);
  await page.getByPlaceholder("3600").fill("3600");
  await page.getByPlaceholder("1000").fill("1000");
  await page.getByPlaceholder("5000").fill("5000");
  await page.getByRole("button", { name: "Deploy guard" }).click();
  await expect(page.getByText("Deployed and verified against the pinned artifact")).toBeVisible({
    timeout: 60_000,
  });
  const predicted = (
    await page.locator(".stat", { hasText: "Predicted guard address" }).locator(".v").innerText()
  ).trim();
  await page.getByRole("button", { name: "Sign and initialize" }).click();
  await expect(page.getByText("initialize landed on chain")).toBeVisible({ timeout: 60_000 });
  return predicted;
}

async function openConfigure(page: Page, guard: string): Promise<void> {
  await page.goto("/configure", { timeout: 90_000 });
  await ensureWalletConnected(page);
  const selector = page.locator("label.field select").first();
  await expect(selector.locator(`option[value="${guard}"]`)).toHaveCount(1);
  await selector.selectOption(guard);
  await expect(selector).toHaveValue(guard);
}

test("a policy installed in one tab does not overwrite a draft in another", async ({ context }) => {
  test.slow();
  const chain = await installSharedChain(context);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const tab of [tabA, tabB]) {
    tab.setDefaultTimeout(15_000);
    await installFreighterMock(tab);
  }

  const guard = await deployGuard(tabA);
  await openConfigure(tabA, guard);
  await openConfigure(tabB, guard);

  // Tab B starts its own, independent draft.
  const panelB = tabB.locator(".panel", { hasText: "Guardrail policy" });
  await panelB.getByLabel(PER_TX).fill("777");
  await panelB.getByLabel(WINDOW).fill("3333");
  await expect(tabB.getByTestId("policy-changed-under-draft")).toHaveCount(0);

  // Tab A installs a different policy.
  const panelA = tabA.locator(".panel", { hasText: "Guardrail policy" });
  await panelA.getByLabel(PER_TX).fill("1200");
  await panelA.getByLabel(WINDOW).fill("6000");
  await panelA.getByRole("button", { name: "Sign and install policy" }).click();
  const review = tabA.getByRole("dialog", { name: "Policy changes" });
  await review.getByRole("button", { name: "Confirm and sign" }).click();
  await expect(tabA.getByText("set_policy landed on chain")).toBeVisible({ timeout: 60_000 });
  expect(chain.guards.get(guard)?.policy).not.toBeNull();

  // Tab B hears about it, reports the chain change, and keeps its draft.
  const notice = tabB.getByTestId("policy-changed-under-draft");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText("The installed policy changed while you were editing");
  await expect(panelB.getByLabel(PER_TX)).toHaveValue("777");
  await expect(panelB.getByLabel(WINDOW)).toHaveValue("3333");

  // Tab A's own form is not disturbed by its own broadcast.
  await expect(tabA.getByTestId("policy-changed-under-draft")).toHaveCount(0);

  // Loading the installed policy replaces B's draft with what A installed.
  await notice.getByRole("button", { name: "Load the installed policy" }).click();
  await expect(panelB.getByLabel(PER_TX)).toHaveValue("1200");
  await expect(panelB.getByLabel(WINDOW)).toHaveValue("6000");
  await expect(tabB.getByTestId("policy-changed-under-draft")).toHaveCount(0);
});
