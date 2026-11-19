/**
 * Deployment interrupted before and after wallet approval (issue #543).
 *
 * The deploy flow has two boundaries where an interruption means different
 * things:
 *
 *   - **Before broadcast** — the wallet refuses or is closed while the operator
 *     is approving. Nothing was signed, so nothing can have reached the chain.
 *   - **After broadcast, ambiguously** — the wallet approved and the
 *     transaction reached the network, but the response never came back (a
 *     dropped connection). The transaction may well have landed.
 *
 * In both cases the console must never replay the write on its own: a second
 * create or initialize is only ever sent because the operator asked again,
 * with a fresh wallet approval. And in the ambiguous case it must recover
 * from evidence on the chain — the predicted address now holds an instance —
 * rather than guessing, which is what stops the operator from deploying twice.
 *
 * The broadcast drop is injected with a route registered after the shared
 * mock chain: Playwright runs the newest route first, so it can let the mock
 * apply `sendTransaction` and then abort the browser's request, exactly as a
 * connection lost after submission looks to the page.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { StrKey } from "@stellar/stellar-sdk";
import { installFreighterMock } from "./walletMock.ts";
import { installSorobanRpcMock, type SorobanRpcMock } from "./sorobanRpcMock.ts";

const AGENT_ADDRESS = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(7));
const AGENT_PUBKEY_HEX = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";
const AGENT_PUBKEY_PLACEHOLDER = "53b093e0281a2d8f4276b77fd21e3380b3329f09097ace3d9e60cf0f2f9039e2";
const RPC_HOST = "soroban-testnet.stellar.org";
const DEPLOYED = "Deployed and verified against the pinned artifact";

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

async function openDeploy(page: Page): Promise<SorobanRpcMock> {
  page.setDefaultTimeout(15_000);
  const chain = await installSorobanRpcMock(page);
  await installFreighterMock(page);
  await page.goto("/deploy", { timeout: 90_000 });
  await ensureWalletConnected(page);
  await expect(page.getByText("deploy is permitted")).toBeVisible();
  await page.getByPlaceholder(AGENT_PUBKEY_PLACEHOLDER).fill(AGENT_PUBKEY_HEX);
  await page.getByLabel("Agent account address").fill(AGENT_ADDRESS);
  await page.getByPlaceholder("3600").fill("3600");
  await page.getByPlaceholder("1000").fill("1000");
  await page.getByPlaceholder("5000").fill("5000");
  return chain;
}

async function predictedAddress(page: Page): Promise<string> {
  const stat = page.locator(".stat", { hasText: "Predicted guard address" });
  await expect(stat).toBeVisible();
  return (await stat.locator(".v").innerText()).trim();
}

function sends(chain: SorobanRpcMock): number {
  return chain.requests.filter((method) => method === "sendTransaction").length;
}

test.describe("deployment interruption", () => {
  test.slow();

  test("a wallet refusal before broadcast sends nothing and is never replayed", async ({
    page,
  }) => {
    const chain = await openDeploy(page);

    await page.evaluate(() =>
      localStorage.setItem("stellar-agent-guard.e2e.reject-next-sign", "1"),
    );
    await page.getByRole("button", { name: "Deploy guard" }).click();
    await expect(
      page
        .getByText(
          "Transaction signing was declined in your wallet. Nothing was sent to the network.",
        )
        .first(),
    ).toBeVisible({ timeout: 30_000 });

    // Nothing reached the chain, and nothing is retried behind the operator's back.
    expect(sends(chain)).toBe(0);
    await page.waitForTimeout(5_000);
    expect(sends(chain)).toBe(0);
    await expect(page.getByText(DEPLOYED)).toHaveCount(0);

    // Retrying is the operator's decision, and it asks the wallet again.
    await page.getByRole("button", { name: "Deploy guard" }).click();
    await expect(page.getByText(DEPLOYED)).toBeVisible({ timeout: 60_000 });
    expect(sends(chain)).toBeGreaterThan(0);
  });

  test("a response lost after broadcast is not replayed, and the chain shows it landed", async ({
    page,
  }) => {
    const chain = await openDeploy(page);
    const predicted = await predictedAddress(page);

    // Drop the response of the first broadcast after the chain has applied it.
    let dropped = 0;
    await page.route(`https://${RPC_HOST}/**`, async (route: Route) => {
      const body = route.request().postDataJSON() as { method?: string } | null;
      if (body?.method === "sendTransaction" && dropped === 0) {
        dropped++;
        // Let the chain apply the submission, then lose the answer.
        await chain.handle({
          request: () => route.request(),
          fulfill: async () => {},
        } as unknown as Route);
        await route.abort("connectionreset");
        return;
      }
      await route.fallback();
    });

    await page.getByRole("button", { name: "Deploy guard" }).click();
    await expect.poll(() => dropped, { timeout: 60_000 }).toBe(1);

    // The page does not claim success it never saw, and says the write may
    // have landed rather than calling it a plain failure...
    await expect(
      page.getByText(/Do not retry yet: the write may have reached the network/),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(DEPLOYED)).toHaveCount(0);
    // ...and does not resubmit on its own while the outcome is unknown.
    const sendsAfterDrop = sends(chain);
    await page.waitForTimeout(8_000);
    expect(sends(chain)).toBe(sendsAfterDrop);

    // The network evidence: the create landed, so the predicted address holds
    // an instance. The panel reads that from the chain and refuses to create a
    // second one at the same address.
    expect(chain.guards.has(predicted)).toBe(true);
    // Reconnecting the wallet re-reads the predicted address from the chain.
    await page.getByRole("button", { name: "Disconnect" }).click();
    await ensureWalletConnected(page);
    await expect(page.getByText(/Address already exists on/)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("No create transaction will be submitted for this address"),
    ).toBeVisible();
    expect(sends(chain)).toBe(sendsAfterDrop);
  });
});
