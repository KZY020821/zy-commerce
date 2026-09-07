import { expect, test } from "@playwright/test";

test.describe("Phase 0 smoke", () => {
  test("platform root renders the landing page", async ({ page }) => {
    await page.goto("http://localhost:3000/");
    await expect(page.getByRole("heading", { name: /ZY Commerce/i })).toBeVisible();
  });

  test("tenant subdomain renders the demo storefront", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Demo Store/i })).toBeVisible();
  });

  test("tenant admin login page is reachable and unknown tenants 404", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    const res = await page.goto("http://nope.localhost:3000/");
    expect(res?.status()).toBe(404);
  });
});
