/**
 * Fleet registration and removal in concurrent tabs (issue #545).
 *
 * Two tabs of the console share the saved registry (browser storage) and the
 * cross-tab channel. Each adds a different guard, then one removes the guard
 * the other added. The registry must merge deterministically — both tabs end
 * up with the same list — an addition made in one tab must not be hidden in
 * the other, and a removal must not be resurrected by a refresh or reload.
 *
 * Registering and removing guards is browser-local bookkeeping: the add flow
 * reads the guard's `status()` to confirm it is live, but nothing is ever
 * signed or submitted, which the shared mock chain asserts.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { StrKey } from "@stellar/stellar-sdk";
import { SorobanRpcMock } from "./sorobanRpcMock.ts";

const RPC_HOST = "soroban-testnet.stellar.org";
const GUARD_X = StrKey.encodeContract(Buffer.alloc(32, 0x11));
const GUARD_Y = StrKey.encodeContract(Buffer.alloc(32, 0x22));

/** The label the add flow gives a guard: `Guard <first 6>…<last 4>`. */
function labelOf(address: string): string {
  return `Guard ${address.slice(0, 6)}…${address.slice(-4)}`;
}

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

async function addGuard(page: Page, address: string): Promise<void> {
  await page.getByLabel("Guard contract address").fill(address);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: `Select ${labelOf(address)}` })).toBeVisible({
    timeout: 15_000,
  });
}

function row(page: Page, address: string) {
  return page.getByRole("checkbox", { name: `Select ${labelOf(address)}` });
}

test("two tabs add and remove separate guards and converge on one registry", async ({
  context,
}) => {
  test.slow();
  const chain = await installSharedChain(context);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const tab of [tabA, tabB]) {
    tab.setDefaultTimeout(15_000);
    await tab.goto("/fleet", { timeout: 90_000 });
    await expect(tab.getByLabel("Guard contract address")).toBeVisible();
  }

  // Each tab registers a different guard.
  await addGuard(tabA, GUARD_X);
  await addGuard(tabB, GUARD_Y);

  // Neither addition is hidden in the other tab: both converge on X and Y,
  // without waiting for the poll or a reload.
  for (const tab of [tabA, tabB]) {
    await expect(row(tab, GUARD_X)).toBeVisible({ timeout: 4_000 });
    await expect(row(tab, GUARD_Y)).toBeVisible({ timeout: 4_000 });
  }

  // Tab A removes the guard tab B added.
  await row(tabA, GUARD_Y).check();
  await tabA.getByRole("button", { name: /Remove selected \(1\)/ }).click();
  await tabA.getByRole("button", { name: "Remove 1 guard", exact: true }).click();
  await expect(tabA.getByTestId("registry-cleanup-undo")).toContainText("Nothing on chain");

  // The removal reaches tab B, and X — added in A — is untouched there.
  await expect(row(tabB, GUARD_Y)).toHaveCount(0, { timeout: 4_000 });
  await expect(row(tabB, GUARD_X)).toBeVisible();

  // A refresh does not resurrect the removal or drop the addition, in either tab.
  for (const tab of [tabA, tabB]) {
    await tab.reload({ timeout: 90_000 });
    await expect(row(tab, GUARD_X)).toBeVisible();
    await expect(row(tab, GUARD_Y)).toHaveCount(0);
  }

  // Both tabs hold the same registry, read back from storage.
  const registries = await Promise.all(
    [tabA, tabB].map((tab) =>
      tab.evaluate(() =>
        Object.keys(window.localStorage)
          .filter((key) => key.includes("instances"))
          .map((key) => window.localStorage.getItem(key))
          .join("|"),
      ),
    ),
  );
  expect(registries[0]).toBe(registries[1]);

  // Registry bookkeeping never writes to the chain.
  expect(chain.requests).not.toContain("sendTransaction");
});

test("the same guard added in both tabs is registered once", async ({ context }) => {
  await installSharedChain(context);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  for (const tab of [tabA, tabB]) {
    tab.setDefaultTimeout(15_000);
    await tab.goto("/fleet", { timeout: 90_000 });
  }
  await addGuard(tabA, GUARD_X);
  await expect(row(tabB, GUARD_X)).toBeVisible({ timeout: 4_000 });

  // Adding it again from the other tab does not duplicate it.
  await tabB.getByLabel("Guard contract address").fill(GUARD_X);
  await tabB.getByRole("button", { name: "Add", exact: true }).click();
  await tabB.waitForTimeout(1_000);
  for (const tab of [tabA, tabB]) {
    await tab.reload({ timeout: 90_000 });
    await expect(row(tab, GUARD_X)).toHaveCount(1);
  }
});
