import { describe, expect, it } from "vitest";
import { buildCatalogProfile, renderCatalogProfile } from "../src/profile";
import type { CatalogueProduct } from "../src/types";

let seq = 0;
const row = (over: Partial<CatalogueProduct> & { categorySlug?: string; categoryName?: string; active?: boolean } = {}): CatalogueProduct => {
  const { categorySlug = "paddles", categoryName = "Paddles", active, ...rest } = over;
  void active; // the adapter only ever returns purchasable products
  return { ref: `P${++seq}`, name: "Product", price: 10000, brand: "Selkirk", specs: {}, category: { slug: categorySlug, name: categoryName }, ...rest };
};

describe("buildCatalogProfile", () => {
  it("summarises categories, price ranges and differentiating spec facets", () => {
    const profile = buildCatalogProfile([
      row({ price: 20000, specs: { "Core Thickness": "16mm", "Skill Level": "Beginner", Face: "Carbon" } }),
      row({ price: 35000, specs: { "Core Thickness": "13mm", "Skill Level": "Advanced", Face: "Carbon" } }),
      row({ price: 50000, specs: { "Core Thickness": "16mm", "Skill Level": "Pro", Face: "Carbon" } }),
      row({ categorySlug: "shoes", categoryName: "Footwear", price: 40000, brand: "ASICS", specs: { Weight: "10.6 oz" } }),
      row({ categorySlug: "shoes", categoryName: "Footwear", price: 45000, brand: "Selkirk", specs: { Weight: "9.8 oz" } }),
    ]);
    expect(profile.productCount).toBe(5);
    const paddles = profile.categories.find((c) => c.slug === "paddles")!;
    expect(paddles.productCount).toBe(3);
    expect(paddles.priceMin).toBe(20000);
    expect(paddles.priceMax).toBe(50000);
    // "Face" is identical for every product, so it is not a differentiating facet
    expect(paddles.facets.map((f) => f.key).sort()).toEqual(["Core Thickness", "Skill Level"]);
    expect(paddles.facets.find((f) => f.key === "Core Thickness")!.values).toEqual(["16mm", "13mm"]);
    const shoes = profile.categories.find((c) => c.slug === "shoes")!;
    expect(shoes.brands.sort()).toEqual(["ASICS", "Selkirk"]);
  });

  it("collapses numeric facets into a range when there are many distinct values", () => {
    const rows = [7.7, 7.9, 8.1, 8.3, 8.5].map((w) => row({ specs: { Weight: `${w} oz` } }));
    const profile = buildCatalogProfile(rows);
    const facet = profile.categories[0]!.facets.find((f) => f.key === "Weight")!;
    expect(facet.range).toEqual({ min: 7.7, max: 8.5, unit: "oz" });
  });

  it("handles uncategorised products and null specs without throwing", () => {
    const profile = buildCatalogProfile([{ ref: "U1", name: "Loose", price: 100, specs: null }, { ref: "U2", name: "Loose 2", price: 200, specs: { Colour: "Red" } }]);
    expect(profile.categories[0]!.slug).toBe("uncategorised");
    expect(profile.categories[0]!.facets).toEqual([]);
  });

  it("renders a compact text block for the system prompt", () => {
    const profile = buildCatalogProfile([row({ specs: { "Core Thickness": "16mm" } }), row({ price: 30000, specs: { "Core Thickness": "13mm" } })]);
    const text = renderCatalogProfile(profile, "MYR", (m) => `RM${(m / 100).toFixed(0)}`);
    expect(text).toContain('Paddles [slug: "paddles"] (2 products, RM100–RM300');
    expect(text).toContain("Core Thickness: 16mm | 13mm");
  });
});
