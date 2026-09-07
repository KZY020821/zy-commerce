/**
 * Search, ranking and the tool executor, driven through a plain in-memory
 * adapter. No database, no network — which is exactly the point of the
 * adapter boundary: a host can validate its own catalogue the same way.
 */
import { describe, expect, it } from "vitest";
import { runAssistantTool, searchCatalogue, summariseCategories } from "../src/tools";
import type { CatalogAdapter, CatalogueProduct, CatalogueProductDetail, StoreProfile } from "../src/types";

const store: StoreProfile = { storeName: "Test Shop", assistantName: "Helper", currency: "USD", locale: "en-US" };

const catalogue: CatalogueProduct[] = [
  { ref: "SH-1", name: "Trail Runner", brand: "Acme", category: { slug: "shoes", name: "Shoes" }, price: 12000, stockQuantity: 20, specs: { Weight: "9.1 oz", Cushioning: "High", Terrain: "Trail" }, description: "For loose ground." },
  { ref: "SH-2", name: "Road Racer", brand: "Acme", category: { slug: "shoes", name: "Shoes" }, price: 18000, stockQuantity: 0, specs: { Weight: "6.4 oz", Cushioning: "Low", Terrain: "Road" } },
  { ref: "SH-3", name: "Daily Trainer", brand: "Zenith", category: { slug: "shoes", name: "Shoes" }, price: 9000, stockQuantity: 3, lowStockThreshold: 5, specs: { Weight: "10.2 oz", Cushioning: "High", Terrain: "Road" } },
  { ref: "AC-1", name: "Wool Socks", brand: "Zenith", category: { slug: "accessories", name: "Accessories" }, price: 1500, stockQuantity: 50, specs: { Material: "Merino" } },
];

const detail: Record<string, CatalogueProductDetail> = {
  "SH-1": { ...catalogue[0]!, variants: [{ ref: "SH-1-9", name: "US 9", attributes: { Size: "9" }, price: 12000, stockQuantity: 4 }, { ref: "SH-1-10", name: "US 10", attributes: { Size: "10" }, price: 12000, stockQuantity: 0 }] },
  "SH-3": { ...catalogue[2]! },
};

const adapter: CatalogAdapter = {
  listCatalogue: async () => catalogue,
  getProduct: async (ref) => detail[ref] ?? catalogue.find((p) => p.ref.toLowerCase() === ref.toLowerCase()) ?? null,
};
const ctx = { adapter, catalogue, store };

describe("searchCatalogue", () => {
  it("ranks a name hit above a specification hit", () => {
    const results = searchCatalogue(catalogue, { query: "trail", category: null, minPrice: null, maxPrice: null, inStockOnly: false });
    // "Trail Runner" matches by name (+5) and by its Terrain spec (+2); the
    // Road Racer matches nothing, so it must not appear at all.
    expect(results.map((p) => p.ref)).toEqual(["SH-1"]);
  });

  it("finds products by specification value alone", () => {
    const results = searchCatalogue(catalogue, { query: "merino", category: null, minPrice: null, maxPrice: null, inStockOnly: false });
    expect(results.map((p) => p.ref)).toEqual(["AC-1"]);
  });

  it("filters by category using either the slug or the display name", () => {
    const bySlug = searchCatalogue(catalogue, { query: "", category: "shoes", minPrice: null, maxPrice: null, inStockOnly: false });
    const byName = searchCatalogue(catalogue, { query: "", category: "Shoes", minPrice: null, maxPrice: null, inStockOnly: false });
    const byCase = searchCatalogue(catalogue, { query: "", category: "SHOES", minPrice: null, maxPrice: null, inStockOnly: false });
    expect(bySlug).toHaveLength(3);
    expect(byName).toEqual(bySlug);
    expect(byCase).toEqual(bySlug);
    expect(searchCatalogue(catalogue, { query: "", category: "hats", minPrice: null, maxPrice: null, inStockOnly: false })).toEqual([]);
  });

  it("applies price bounds in major units and hides sold-out items on request", () => {
    const budget = searchCatalogue(catalogue, { query: "", category: "shoes", minPrice: null, maxPrice: 100, inStockOnly: false });
    expect(budget.map((p) => p.ref)).toEqual(["SH-3"]);
    const inStock = searchCatalogue(catalogue, { query: "", category: "shoes", minPrice: null, maxPrice: null, inStockOnly: true });
    expect(inStock.map((p) => p.ref)).not.toContain("SH-2");
  });

  it("with no keywords, browses cheapest first", () => {
    const all = searchCatalogue(catalogue, { query: "", category: null, minPrice: null, maxPrice: null, inStockOnly: false });
    expect(all.map((p) => p.price)).toEqual([1500, 9000, 12000, 18000]);
  });
});

describe("summariseCategories", () => {
  it("counts products per category, largest first", () => {
    expect(summariseCategories(catalogue)).toEqual([
      { slug: "shoes", name: "Shoes", products: 3 },
      { slug: "accessories", name: "Accessories", products: 1 },
    ]);
  });
});

describe("runAssistantTool", () => {
  it("search_products returns formatted prices, stock labels and key specs", async () => {
    const res = JSON.parse(await runAssistantTool("search_products", { query: "cushioning", category: null, minPrice: null, maxPrice: null, inStockOnly: false }, ctx));
    expect(res.total).toBeGreaterThan(0);
    const first = res.products[0];
    expect(first.price).toMatch(/^\$/);
    expect(["In stock", "Low stock", "Sold out"]).toContain(first.stock);
    expect(first.specs.Cushioning).toBeDefined();
  });

  it("get_product returns full detail including variants and their stock", async () => {
    const res = JSON.parse(await runAssistantTool("get_product", { ref: "SH-1" }, ctx));
    expect(res.ref).toBe("SH-1");
    expect(res.description).toBe("For loose ground.");
    expect(res.variants).toHaveLength(2);
    expect(res.variants[0]).toMatchObject({ ref: "SH-1-9", stock: "Low stock" });
    expect(res.variants[1].stock).toBe("Sold out");
  });

  it("get_product reports a helpful error for an unknown reference", async () => {
    const res = JSON.parse(await runAssistantTool("get_product", { ref: "NOPE" }, ctx));
    expect(res.error).toContain("NOPE");
  });

  it("compare_products builds a spec matrix and lists what it could not find", async () => {
    const res = JSON.parse(await runAssistantTool("compare_products", { refs: ["SH-1", "SH-3", "GHOST"] }, ctx));
    expect(res.products.map((p: { ref: string }) => p.ref)).toEqual(["SH-1", "SH-3"]);
    expect(res.missing).toEqual(["GHOST"]);
    const weight = res.specs.find((s: { key: string }) => s.key === "Weight");
    expect(weight.values).toEqual({ "SH-1": "9.1 oz", "SH-3": "10.2 oz" });
    // A spec only one product has is still shown, with an em dash for the other.
    const material = res.specs.find((s: { key: string }) => s.key === "Material");
    expect(material).toBeUndefined();
  });

  it("list_categories mirrors the catalogue snapshot", async () => {
    const res = JSON.parse(await runAssistantTool("list_categories", {}, ctx));
    expect(res).toEqual(summariseCategories(catalogue));
  });

  it("an unknown tool name fails loudly rather than silently", async () => {
    const res = JSON.parse(await runAssistantTool("drop_database", {}, ctx));
    expect(res.error).toContain("drop_database");
  });
});
