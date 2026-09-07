/**
 * The catalogue adapter is the assistant's only route to product data, so it
 * must inherit tenant isolation exactly like every other query in the app:
 * an adapter built for tenant A can never surface tenant B's products.
 */
import { runAssistantTool, searchCatalogue } from "catalog-concierge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaCatalogAdapter } from "@/lib/ai/prisma-adapter";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantDb } from "@/lib/db/tenant-client";
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
afterAll(async () => {
  await unscopedDb.$disconnect();
});

const adapterFor = (tenantId: string) => createPrismaCatalogAdapter(createTenantDb(tenantId));
const store = { storeName: "Test", assistantName: "Helper", currency: "USD", locale: "en-US" };

describe("Prisma catalogue adapter is tenant-scoped", () => {
  it("listCatalogue returns only this tenant's products, with specs and images", async () => {
    const catalogue = await adapterFor(A.tenant.id).listCatalogue();
    expect(catalogue.map((p) => p.ref)).toEqual([A.product.sku]);
    expect(catalogue[0]!.specs?.["Core Thickness"]).toBe("16mm");
    expect(catalogue[0]!.imageUrl).toBe(A.image.url);
    expect(catalogue[0]!.url).toBe(`/products/${A.product.slug}`);
  });

  it("getProduct refuses another tenant's reference, by SKU or slug", async () => {
    const a = adapterFor(A.tenant.id);
    expect((await a.getProduct(A.product.sku))?.ref).toBe(A.product.sku);
    expect(await a.getProduct(B.product.sku)).toBeNull();
    // Both fixtures share the slug "widget"; each tenant must resolve its own.
    expect((await adapterFor(B.tenant.id).getProduct("widget"))?.ref).toBe(B.product.sku);
  });

  it("getProduct returns variants with their own price and stock", async () => {
    const p = await adapterFor(A.tenant.id).getProduct(A.product.sku);
    expect(p?.variants?.map((v) => v.ref)).toEqual([A.variant.sku]);
    expect(p?.variants?.[0]?.price).toBe(A.product.price);
  });

  it("search over the scoped snapshot never crosses tenants", async () => {
    const catalogue = await adapterFor(A.tenant.id).listCatalogue();
    const bySpec = searchCatalogue(catalogue, { query: "16mm", category: null, minPrice: null, maxPrice: null, inStockOnly: false });
    expect(bySpec.map((p) => p.ref)).toEqual([A.product.sku]);
    // Tenant B's distinguishing spec finds nothing in tenant A's catalogue.
    expect(searchCatalogue(catalogue, { query: "13mm", category: null, minPrice: null, maxPrice: null, inStockOnly: false })).toEqual([]);
  });

  it("the assistant's tools, run against the adapter, stay scoped", async () => {
    const adapter = adapterFor(A.tenant.id);
    const catalogue = await adapter.listCatalogue();
    const ctx = { adapter, catalogue, store };

    const search = JSON.parse(await runAssistantTool("search_products", { query: "widget", category: null, minPrice: null, maxPrice: null, inStockOnly: false }, ctx));
    expect(search.products.map((p: { ref: string }) => p.ref)).toEqual([A.product.sku]);

    const foreign = JSON.parse(await runAssistantTool("get_product", { ref: B.product.sku }, ctx));
    expect(foreign.error).toBeDefined();

    const compare = JSON.parse(await runAssistantTool("compare_products", { refs: [A.product.sku, B.product.sku] }, ctx));
    expect(compare.products.map((p: { ref: string }) => p.ref)).toEqual([A.product.sku]);
    expect(compare.missing).toEqual([B.product.sku]);

    const cats = JSON.parse(await runAssistantTool("list_categories", {}, ctx));
    expect(cats).toEqual([{ slug: "widgets", name: "Widgets", products: 1 }]);
  });

  it("category filtering accepts the display name and any casing", async () => {
    const catalogue = await adapterFor(A.tenant.id).listCatalogue();
    const byName = searchCatalogue(catalogue, { query: "", category: "Widgets", minPrice: null, maxPrice: null, inStockOnly: false });
    const upper = searchCatalogue(catalogue, { query: "", category: "WIDGETS", minPrice: null, maxPrice: null, inStockOnly: false });
    expect(byName).toHaveLength(1);
    expect(upper).toHaveLength(1);
    expect(searchCatalogue(catalogue, { query: "", category: "Gadgets", minPrice: null, maxPrice: null, inStockOnly: false })).toEqual([]);
  });
});
