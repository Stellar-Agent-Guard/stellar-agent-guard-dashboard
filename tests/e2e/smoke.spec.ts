/**
 * Browser smoke checks for every primary route (issue #550).
 *
 * The unit suites exercise `lib/guard` in Node and the lifecycle suites drive
 * specific writes; neither would notice a route that fails to compile, throws
 * during hydration, or renders nothing because a browser API is missing. This
 * suite is the cheap net across that gap: `/`, `/configure`, `/deploy`, `/fleet`
 * and `/panic` each load **without a wallet**, against an in-process mock chain,
 * and must render their own heading with no page error and no hydration error.
 *
 * Nothing here signs, writes, or needs credentials. The mock chain is the same
 * XDR-exact fixture set the network-mismatch suite uses, so the reads that do
 * run are shape-identical to a real testnet response. The final test does the
 * opposite on purpose: it takes the chain away and asserts the failure is shown
 * as a failure — never as zeros or an empty policy.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { NETWORK } from "../../lib/guard/network.ts";
import { handleRpcRequest } from "./rpcFixtures.ts";

/** The five routes an operator can land on directly. */
const PRIMARY_ROUTES = [
  { path: "/", name: "overview", heading: "Stellar Agent Guard" },
  { path: "/configure", name: "configure", heading: "Configure" },
  { path: "/deploy", name: "deploy", heading: "Deploy a guard" },
  { path: "/fleet", name: "fleet", heading: "Fleet Overview" },
  { path: "/panic", name: "panic", heading: "On-chain state" },
] as const;

/** Answer every Soroban RPC POST the console makes with the local fixtures. */
async function mockSorobanRpc(page: Page): Promise<void> {
  await page.route(`${NETWORK.rpcUrl}/**`, (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") return void route.fulfill({ status: 405, body: "" });
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: handleRpcRequest(request.postDataJSON()).body,
    });
  });
}

/** Take the chain away without hanging the page: every RPC call fails fast. */
async function breakSorobanRpc(page: Page): Promise<void> {
  await page.route(`${NETWORK.rpcUrl}/**`, (route: Route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "unavailable" },
      }),
    }),
  );
}

/**
 * Collect the two failure classes this smoke suite exists to catch: an
 * uncaught page error (a thrown render) and a hydration mismatch (markup the
 * server and client disagree on). Ordinary console noise — a warning, a
 * React DevTools hint, an expected failed network read — is deliberately not a
 * failure, or the suite would be flaky rather than useful.
 */
function collectRenderFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/hydrat|did not match|server rendered HTML|text content does not match/i.test(text)) {
      failures.push(`hydration error: ${text}`);
    }
  });
  return failures;
}

test.describe("primary route smoke checks", () => {
  for (const route of PRIMARY_ROUTES) {
    test(`${route.name} (${route.path}) renders without a wallet and without a render failure`, async ({
      page,
    }) => {
      const failures = collectRenderFailures(page);
      await mockSorobanRpc(page);

      const response = await page.goto(route.path);
      expect(response?.status(), `${route.path} should answer with a page`).toBe(200);

      // The route's own landmark is visible: this is the assertion a failed
      // compile, a blank export, or a crashed panel would break.
      await expect(
        page.getByRole("heading", { name: route.heading, exact: true }).first(),
      ).toBeVisible();
      // Every route is wrapped by the shared shell, so the brand is a cheap
      // "the layout hydrated too" check.
      await expect(
        page.getByRole("heading", { name: "Stellar Agent Guard", exact: true }).first(),
      ).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Application error");

      // No wallet is installed for this suite: the console must offer to
      // connect rather than claim a session, and must still render read-only.
      await expect(page.getByRole("button", { name: /Connect .*wallet/i }).first()).toBeVisible();

      expect(failures, `${route.path} produced a render failure`).toEqual([]);
    });
  }

  test("the primary navigation moves between console, fleet and configure", async ({ page }) => {
    await mockSorobanRpc(page);
    await page.goto("/");

    // The tab strip is the one nav shared by every route (`nav.tabs`); the shell
    // also renders a sidebar and a mobile drawer, so scope to the tabs.
    const tabs = page.locator("nav.tabs");
    await tabs.getByRole("link", { name: "Fleet", exact: true }).click();
    await expect(page).toHaveURL(/\/fleet$/);
    await expect(page.getByRole("heading", { name: "Fleet Overview", exact: true })).toBeVisible();

    await tabs.getByRole("link", { name: "Configure", exact: true }).click();
    await expect(page).toHaveURL(/\/configure$/);
    await expect(page.getByRole("heading", { name: "Configure", exact: true })).toBeVisible();

    await tabs.getByRole("link", { name: "Console", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "On-chain state", exact: true })).toBeVisible();
  });
});

test("an unreachable chain is surfaced as a failed read, never as zeros", async ({ page }) => {
  const failures = collectRenderFailures(page);
  await breakSorobanRpc(page);

  // The panic page pairs the status read with the freeze controls, so it is the
  // highest-stakes surface for a read that quietly renders as "not frozen".
  await page.goto("/panic");
  await expect(page.getByRole("heading", { name: "On-chain state", exact: true })).toBeVisible();
  await expect(page.getByText("The guard's state could not be read")).toBeVisible({
    timeout: 30_000,
  });
  // The tradeoff is stated, not implied: a failed read is not an empty policy.
  await expect(page.getByText(/a failed read is not an empty policy/i)).toBeVisible();

  // The fleet route must keep rendering and mark rows with a read error rather
  // than deriving a status it did not read.
  await page.goto("/fleet");
  await expect(page.getByRole("heading", { name: "Fleet Overview", exact: true })).toBeVisible();
  await expect(page.getByText(/Read error:/i).first()).toBeVisible({ timeout: 30_000 });

  expect(failures, "a failed read must not crash the page").toEqual([]);
});
