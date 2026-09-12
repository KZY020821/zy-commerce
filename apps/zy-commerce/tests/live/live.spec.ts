/**
 * The live site, checked after every production deploy. Read-only by design.
 *
 * With EXPECTED_COMMIT set, every host must report exactly that commit from
 * /api/health — so these checks can never pass by testing the previous build.
 */
import { expect, test } from "@playwright/test";

const PLATFORM = process.env.LIVE_PLATFORM_URL ?? "https://zy-commerce.vercel.app";
const STORES = [
  { name: "Selkirk Demo", url: process.env.LIVE_SELKIRK_URL ?? "https://zy-commerce-demo.vercel.app" },
  { name: "Nike Demo", url: process.env.LIVE_NIKE_URL ?? "https://zy-commerce-nike.vercel.app" },
];
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT;

for (const url of [PLATFORM, ...STORES.map((s) => s.url)]) {
  test(`${url} is healthy${EXPECTED_COMMIT ? ` and serving ${EXPECTED_COMMIT.slice(0, 7)}` : ""}`, async ({ request }) => {
    const res = await request.get(`${url}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, database: "ok", environment: "production" });
    if (EXPECTED_COMMIT) expect(body.commit).toBe(EXPECTED_COMMIT);
  });
}

test("the platform landing page renders, and its admin is behind a login", async ({ page }) => {
  await page.goto(PLATFORM);
  await expect(page.getByRole("heading", { name: "ZY Commerce" })).toBeVisible();
  await page.goto(`${PLATFORM}/platform`);
  await expect(page).toHaveURL(`${PLATFORM}/platform/login`);
});

for (const store of STORES) {
  test.describe(store.name, () => {
    test("renders the storefront with the demonstration notice and the assistant", async ({ page }) => {
      const res = await page.goto(store.url);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: store.name })).toBeVisible();
      await expect(page.getByText("Demonstration store.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Ask / })).toBeVisible();
    });

    test("sends the security headers and asks not to be indexed", async ({ request }) => {
      const res = await request.get(store.url);
      const headers = res.headers();
      expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      // Vercel adds HSTS at the edge; a plain-http rehearsal cannot have it.
      if (store.url.startsWith("https://")) expect(headers["strict-transport-security"]).toBeTruthy();
      expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow"/>');
      expect(await (await request.get(`${store.url}/robots.txt`)).text()).toMatch(/Disallow: \//);
    });

    test("serves its link-preview image", async ({ request }) => {
      const res = await request.get(`${store.url}/opengraph-image`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
    });

    test("keeps its admin behind a login, and answers 404 for an unknown product", async ({ page }) => {
      await page.goto(`${store.url}/admin/settings`);
      await expect(page).toHaveURL(`${store.url}/admin/login`);
      const res = await page.goto(`${store.url}/products/this-product-does-not-exist`);
      expect(res?.status()).toBe(404);
    });
  });
}
