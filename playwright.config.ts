import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression configuration for the operator console.
 *
 * Every screen is captured at the three viewports the interface is designed for
 * (desktop 1440, tablet 768, mobile 375), in each colour scheme the browser can
 * report (dark and light). The dashboard ships a single dark palette today, so
 * the light projects currently reproduce the dark baselines byte for byte — they
 * exist so that a light theme, once added, is covered with no further wiring.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;

const COLOR_SCHEMES = ["dark", "light"] as const;

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // A regression run that flakes teaches the team to ignore it, so CI gets one
  // retry and nothing more; a genuine diff survives a retry.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  // The project name is part of the snapshot path, so a desktop baseline can
  // never be compared against a mobile one by accident.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}",

  expect: {
    toHaveScreenshot: {
      // Less than 0.5% of pixels may differ. That headroom is for font
      // antialiasing, which is never bit-identical between runs; anything
      // structural — a shifted panel, a changed colour, a wrapped label — is far
      // larger than half a percent.
      maxDiffPixelRatio: 0.005,
      animations: "disabled",
      caret: "hide",
    },
  },

  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: VIEWPORTS.flatMap((viewport) =>
    COLOR_SCHEMES.map((colorScheme) => ({
      name: `${viewport.name}-${colorScheme}`,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme,
      },
    })),
  ),

  webServer: {
    // The suite runs against the production build, never the dev server: the dev
    // server injects its own overlay, which is not part of the shipped interface.
    // CI builds first; locally, run `npm run build` before `npm run test:visual`.
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
