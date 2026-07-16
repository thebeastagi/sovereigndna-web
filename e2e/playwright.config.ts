import { defineConfig, devices } from "@playwright/test";

/**
 * SovereignDNA — E2E test configuration.
 *
 * Tests run against the LIVE deployment by default. Override with BASE_URL.
 * The site is a Cloudflare Worker (static assets + API + SSE) at
 * https://sovereigndna.thebeastagi.com.
 */
const BASE_URL = process.env.BASE_URL || "https://sovereigndna.thebeastagi.com";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./utils/global-setup.ts",
  globalTeardown: "./utils/global-teardown.ts",
  // The SSE ingestion demo runs ~40 ticks * 45ms ≈ 2s; large genomes + network
  // headroom → generous per-test timeout.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 2 : 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "results/results.json" }],
  ],
  outputDir: "results/artifacts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } },
    },
    {
      name: "mobile-chromium",
      // iPhone 13 metrics/UA, rendered on the Chromium engine (the only engine
      // installed in this container). Exercises the mobile layout + burger nav.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
      },
    },
    // Firefox / WebKit projects are enabled automatically when those browser
    // binaries are installed (ENABLE_ALL_BROWSERS=1). Chromium is the baseline.
    ...(process.env.ENABLE_ALL_BROWSERS
      ? [
          { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
          { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
        ]
      : []),
  ],
});
