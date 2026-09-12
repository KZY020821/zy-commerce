/**
 * The storefront and platform as a visitor meets them, against a production
 * build. Everything here is also what the live checks assert after a deploy;
 * catching it here means a pull request that breaks it never merges.
 */
import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("platform root renders the landing page", async ({ page }) => {
    await page.goto("http://localhost:3000/");
    await expect(page.getByRole("heading", { name: /ZY Commerce/i })).toBeVisible();
  });

  test("a store renders its storefront with the demonstration notice", async ({ page }) => {
    await page.goto("/");
    // The seeded store's name has changed before ("Demo Store" → "Selkirk
    // Demo"), so assert what every storefront must show instead.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Demonstration store.", { exact: true })).toBeVisible();
  });

  test("the admin login is reachable and an unknown store is a 404", async ({ page }) => {
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

  test("every page carries the security headers and asks not to be indexed", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow"/>');
  });

  test("robots.txt keeps every crawler out", async ({ request }) => {
    const body = await (await request.get("http://localhost:3000/robots.txt")).text();
    expect(body).toMatch(/User-Agent: \*\s+Disallow: \//);
  });

  test("the link preview image is served on the store's own host", async ({ request }) => {
    const res = await request.get("/opengraph-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("the health check reports a reachable database", async ({ request }) => {
    const res = await request.get("http://localhost:3000/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, database: "ok" });
  });
});
