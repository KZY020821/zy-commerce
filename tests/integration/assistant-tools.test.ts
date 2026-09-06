/**
 * The assistant's tools must obey tenant isolation like everything else:
 * a client scoped to tenant A never surfaces tenant B's products.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantDb } from "@/lib/db/tenant-client";
import { runAssistantTool } from "@/lib/ai/tools";
import { createTenantFixture, resetDatabase, type TenantFixture } from "./helpers";

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  await resetDatabase();
  A = await createTenantFixture("alpha", "Alpha");
  B = await createTenantFixture("beta", "Beta");
  await unscopedDb.product.update({ where: { id: A.product.id }, data: { brand: "Selkirk", specs: { "Core Thickness": "16mm", "Skill Level": "Advanced" } } });
  await unscopedDb.product.update({ where: { id: B.product.id }, data: { brand: "Selkirk", specs: { "Core Thickness": "13mm" } } });
});
afterAll(async () => { await unscopedDb.$disconnect(); });

const ctxFor = (tenantId: string) => ({ db: createTenantDb(tenantId), currency: "USD", locale: "en-US" });

describe("assistant tools are tenant-scoped", () => {
  it("search_products only returns the tenant's products, with specs", async () => {
    const res = JSON.parse(await runAssistantTool("search_products", { query: "widget", category: null, minPrice: null, maxPrice: null, inStockOnly: false }, ctxFor(A.tenant.id)));
    expect(res.products.map((p: { sku: string }) => p.sku)).toEqual([A.product.sku]);
    expect(res.products[0].specs["Core Thickness"]).toBe("16mm");
    const spec = JSON.parse(await runAssistantTool("search_products", { query: "16mm", category: null, minPrice: null, maxPrice: null, inStockOnly: false }, ctxFor(A.tenant.id)));
    expect(spec.total).toBe(1);
    const none = JSON.parse(await runAssistantTool("search_products", { query: "13mm", category: null, minPrice: null, maxPrice: null, inStockOnly: false }, ctxFor(A.tenant.id)));
    expect(none.total).toBe(0);
  });

  it("get_product refuses another tenant's SKU or slug", async () => {
    const own = JSON.parse(await runAssistantTool("get_product", { skuOrSlug: A.product.sku }, ctxFor(A.tenant.id)));
    expect(own.sku).toBe(A.product.sku);
    expect(own.variants[0].sku).toBe(A.variant.sku);
    const foreign = JSON.parse(await runAssistantTool("get_product", { skuOrSlug: B.product.sku }, ctxFor(A.tenant.id)));
    expect(foreign.error).toBeDefined();
    const bySlug = JSON.parse(await runAssistantTool("get_product", { skuOrSlug: "widget" }, ctxFor(B.tenant.id)));
    expect(bySlug.sku).toBe(B.product.sku);
  });

  it("compare_products drops SKUs from other tenants and reports them as missing", async () => {
    const res = JSON.parse(await runAssistantTool("compare_products", { skusOrSlugs: [A.product.sku, B.product.sku] }, ctxFor(A.tenant.id)));
    expect(res.products.map((p: { sku: string }) => p.sku)).toEqual([A.product.sku]);
    expect(res.missing).toEqual([B.product.sku]);
  });

  it("list_categories and price filters are scoped", async () => {
    const cats = JSON.parse(await runAssistantTool("list_categories", {}, ctxFor(A.tenant.id)));
    expect(cats).toHaveLength(1);
    expect(cats[0].products).toBe(1);
    const pricey = JSON.parse(await runAssistantTool("search_products", { query: "", category: "widgets", minPrice: 100, maxPrice: null, inStockOnly: true }, ctxFor(A.tenant.id)));
    expect(pricey.total).toBe(0);
    const ok = JSON.parse(await runAssistantTool("search_products", { query: "", category: "widgets", minPrice: 10, maxPrice: 30, inStockOnly: true }, ctxFor(A.tenant.id)));
    expect(ok.total).toBe(1);
  });

  it("category filter accepts the display name and any casing, not just the exact slug", async () => {
    // Found live: the catalogue overview shows category *names* ("Widgets"), but a
    // model without deep reasoning sometimes passes that instead of the slug
    // ("widgets") — the filter must not silently return zero results for that.
    const byName = JSON.parse(await runAssistantTool("search_products", { query: "", category: "Widgets", minPrice: null, maxPrice: null, inStockOnly: false }, ctxFor(A.tenant.id)));
    expect(byName.total).toBe(1);
    const upperSlug = JSON.parse(await runAssistantTool("search_products", { query: "", category: "WIDGETS", minPrice: null, maxPrice: null, inStockOnly: false }, ctxFor(A.tenant.id)));
    expect(upperSlug.total).toBe(1);
    const wrongName = JSON.parse(await runAssistantTool("search_products", { query: "", category: "Gadgets", minPrice: null, maxPrice: null, inStockOnly: false }, ctxFor(A.tenant.id)));
    expect(wrongName.total).toBe(0);
  });
});
