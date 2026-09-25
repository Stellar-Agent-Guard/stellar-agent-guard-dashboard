import { defineConfig, devices } from "@playwright/test";

/**
 * E2E configuration for the wallet network-mismatch suite.
 *
 * The suite serves the production build through `next start` and answers every
 * Soroban RPC call with a local fixture, so a test run never touches the real
 * testnet and never needs a wallet extension: the wallet is mocked in-page (see
 * `tests/e2e/walletMock.ts`).
 *
 * The webServer reuses an already-running instance on the port when present, so
 * the suite can be pointed at a manually started server with
 * `PLAYWRIGHT_TEST_BASE_URL=http://localhost:3000 npx playwright test`.
 */
const PORT = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 3_100);
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL
    ? undefined
    : {
        command: `npm run start -- -p ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
