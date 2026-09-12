/**
 * The whole logo flow in a real browser against a production build: sign in,
 * upload to the real Blob store, see it on the storefront under the site's
 * own security headers, replace it, and remove it — checking storage directly
 * that replaced and removed files are really gone.
 *
 * Runs against the throwaway store from global-setup.ts. Skipped when no Blob
 * credentials are present, which is the case for pull requests from forks:
 * GitHub does not give them repository secrets.
 */
import { BlobNotFoundError, head } from "@vercel/blob";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PNG_SIGNATURE, solidPng } from "./png";

const store = () => `http://${process.env.E2E_TENANT_SLUG}.localhost:3000`;
const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());

test.describe("store logo", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!blobConfigured, "No Blob credentials (BLOB_READ_WRITE_TOKEN); pull requests from forks do not receive secrets.");

  // One signed-in context for the whole flow; the storefront checks open
  // sibling pages in it, which a bare browser.newPage() cannot do.
  let context: BrowserContext;
  let page: Page;
  const uploaded: string[] = [];
  const logoUrlPattern = () => new RegExp(`^https://[a-z0-9]+\\.public\\.blob\\.vercel-storage\\.com/tenants/${process.env.E2E_TENANT_ID}/logo-[A-Za-z0-9]+\\.png$`);

  async function upload(file: { name: string; buffer: Buffer }) {
    await page.goto(`${store()}/admin/settings`);
    await page.getByLabel("Upload a new logo").setInputFiles({ ...file, mimeType: "image/png" });
  }

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(`${store()}/admin/login`);
    await page.getByLabel("Email").fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${store()}/admin`);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("an uploaded logo is stored and shown on the storefront", async () => {
    await upload({ name: "logo.png", buffer: solidPng(512, 128, [34, 197, 94]) });
    await expect(page.getByRole("img", { name: "Preview of logo.png" })).toBeVisible();
    await page.getByRole("button", { name: "Save logo" }).click();
    await expect(page.getByText("Logo saved. It's now showing on your storefront.")).toBeVisible();

    const src = await page.getByRole("img", { name: "E2E Store logo" }).getAttribute("src");
    expect(src).toMatch(logoUrlPattern());
    uploaded.push(src!);

    const storefront = await context.newPage();
    await storefront.goto(`${store()}/`);
    const headerLogo = storefront.locator("header img");
    await expect(headerLogo).toHaveAttribute("src", src!);
    // Decoded at full size: the browser really fetched it past the CSP.
    await expect.poll(() => headerLogo.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBe(512);
    await storefront.close();
  });

  test("replacing the logo deletes the previous file from storage", async () => {
    await upload({ name: "logo-2.png", buffer: solidPng(256, 64, [17, 17, 17]) });
    await page.getByRole("button", { name: "Save logo" }).click();
    await expect(page.getByText("Logo saved. It's now showing on your storefront.")).toBeVisible();

    const src = await page.getByRole("img", { name: "E2E Store logo" }).getAttribute("src");
    expect(src).toMatch(logoUrlPattern());
    expect(src).not.toBe(uploaded[0]);
    uploaded.push(src!);
    await expect(head(uploaded[0]!)).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  test("a file over 1 MB is refused before anything is sent", async () => {
    const huge = Buffer.alloc(1024 * 1024 + 100_000);
    PNG_SIGNATURE.copy(huge);
    await upload({ name: "huge.png", buffer: huge });
    await expect(page.getByText("The logo must be 1 MB or smaller — this file is 1.1 MB.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save logo" })).toBeDisabled();
  });

  test("an SVG renamed to .png is refused by the server, and the current logo stays", async () => {
    await upload({ name: "logo.png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') });
    await page.getByRole("button", { name: "Save logo" }).click();
    await expect(page.getByText("Upload a PNG, JPEG or WebP image.")).toBeVisible();
    await expect(page.getByRole("img", { name: "E2E Store logo" })).toHaveAttribute("src", uploaded[1]!);
  });

  test("an admin's session does not reach another store's settings", async () => {
    await page.goto("http://demo.localhost:3000/admin/settings");
    await expect(page).toHaveURL("http://demo.localhost:3000/admin/login");
  });

  test("removing the logo clears it from the store and from storage", async () => {
    await page.goto(`${store()}/admin/settings`);
    await page.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("Logo removed. Your storefront shows the coloured square again.")).toBeVisible();
    await expect(page.getByText("No logo yet")).toBeVisible();
    await expect(head(uploaded[1]!)).rejects.toBeInstanceOf(BlobNotFoundError);

    const storefront = await context.newPage();
    await storefront.goto(`${store()}/`);
    await expect(storefront.locator("header img")).toHaveCount(0);
    await storefront.close();
  });
});
