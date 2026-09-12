import { defineConfig, devices } from "@playwright/test";

/**
 * Read-only checks against the live deployment, run by
 * .github/workflows/deploy-verify.yml after every production deploy.
 *
 * Nothing here writes: no sign-in, no chat message (which would spend model
 * tokens and add to the store's conversation log), no upload.
 *
 *   EXPECTED_COMMIT=<sha> pnpm test:live
 */
export default defineConfig({
  testDir: "tests/live",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The public internet, not a local server: allow for a transient blip.
  retries: 2,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
