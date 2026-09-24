/**
 * What a store admin writes about their shop is what the assistant offers
 * customers, in a real browser against a production build: sign in, fill the
 * assistant settings, then find the result on the storefront. Also what the
 * admin reads back — the catalogue's readiness and the conversation summary.
 *
 * Runs against the throwaway store from global-setup.ts. It needs no model
 * key: everything here is rendered from the store's own data, so it passes on
 * a deployment where the assistant is offline.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const store = () => `http://${process.env.E2E_TENANT_SLUG}.localhost:3000`;

/**
 * One conversation in this run's store, written by the same script that
 * created the store — Playwright's own loader cannot import the generated
 * Prisma client, and the script already owns the rules about which databases
 * and which stores may be touched.
 */
function writeConversation(): void {
  execFileSync("pnpm", ["exec", "tsx", "tests/e2e/fixture-store.ts", "conversation", process.env.E2E_TENANT_ID!], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

test.describe("assistant settings", () => {
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext;
  let page: Page;

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

  test("the shop's own information and contact reach the storefront widget", async () => {
    await page.goto(`${store()}/admin/settings`);
    await page.getByLabel("Shop information").fill("Delivery: free over RM 200, 2–4 working days.\nReturns: 14 days, unused.");
    await page.getByLabel("WhatsApp number").fill("+60 12-345 6789");
    await page.getByRole("button", { name: "Save assistant settings" }).click();
    await expect(page.getByText("Saved. Your storefront assistant is using it now.")).toBeVisible();

    // A second tab in the same context: the storefront as a customer sees it.
    const shop = await context.newPage();
    await shop.goto(store());
    await shop.getByRole("button", { name: /^Ask / }).click();

    const contact = shop.getByRole("link", { name: "Message the shop on WhatsApp" });
    await expect(contact).toHaveAttribute("href", "https://wa.me/60123456789");
    await expect(shop.getByText("Chats are kept for 90 days so this store can improve its answers.")).toBeVisible();
    await shop.close();
  });

  test("what was saved is still in the form when the admin comes back", async () => {
    await page.goto(`${store()}/admin/settings`);
    await expect(page.getByLabel("Shop information")).toHaveValue(/Delivery: free over RM 200/);
    await expect(page.getByLabel("WhatsApp number")).toHaveValue("+60 12-345 6789");
  });

  test("the admin can see how much the assistant has to work with", async () => {
    await page.goto(`${store()}/admin`);

    await expect(page.getByText("How much your assistant has to work with")).toBeVisible();
    await expect(page.getByText(/have specifications \(\d+ of \d+\)/)).toBeVisible();
  });

  test("the conversations page stands up with nothing to show yet", async () => {
    await page.goto(`${store()}/admin/conversations`);

    await expect(page.getByText("No conversations yet. Open the storefront and ask the assistant something.")).toBeVisible();
  });

  test("once there are conversations, it summarises them rather than only listing them", async () => {
    writeConversation();
    await page.goto(`${store()}/admin/conversations`);

    await expect(page.getByText("What customers ask most")).toBeVisible();
    await expect(page.getByText("Which paddle for a beginner?").first()).toBeVisible();
    await expect(page.getByText("What it would not answer")).toBeVisible();
    await expect(page.getByText("write me a poem").first()).toBeVisible();
    await expect(page.getByText("Answers customers marked unhelpful")).toBeVisible();
    await expect(page.getByText("turned away as off-topic")).toBeVisible();
  });

  test("a number that is not a phone number is refused, and nothing changes", async () => {
    await page.goto(`${store()}/admin/settings`);
    await page.getByLabel("WhatsApp number").fill("call me maybe");
    await page.getByRole("button", { name: "Save assistant settings" }).click();

    await expect(page.getByText(/international format/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("WhatsApp number")).toHaveValue("+60 12-345 6789");
  });
});
