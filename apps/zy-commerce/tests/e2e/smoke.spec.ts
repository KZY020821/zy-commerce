import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("platform root renders the landing page", async ({ page }) => {
    await page.goto("http://localhost:3000/");
    await expect(page.getByRole("heading", { name: /ZY Commerce/i })).toBeVisible();
  });

  test("tenant subdomain renders the demo storefront", async ({ page }) => {
    await page.goto("/");
    // The store's name comes from the seed and has already changed once
    // ("Demo Store" → "Selkirk Demo"), so assert what every storefront must
    // show instead: its heading and the demonstration notice.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Demonstration store.", { exact: true })).toBeVisible();
  });

  test("tenant admin login page is reachable and unknown tenants 404", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    const res = await page.goto("http://nope.localhost:3000/");
    expect(res?.status()).toBe(404);
  });

  test("store settings, where the logo is uploaded, require an admin session", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
