import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

/**
 * End-to-end tests in a real browser.
 *
 * CI builds the app for production and runs it with `next start`; locally a
 * dev or production server already running on :3000 is reused. Either way the
 * tests and the server must share a database: global-setup.ts creates this
 * run's throwaway store in it and global-teardown.ts removes it.
 *
 *   pnpm exec playwright install chromium   (once)
 *   pnpm test:e2e
 */

// The same variables the app server reads. Values already in the environment
// (CI sets them all) win over the files.
loadEnv({ path: [".env.local", ".env"], quiet: true });

const PORT = 3000;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: `http://demo.localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    // Ready only once the database answers, not merely when the port opens.
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
