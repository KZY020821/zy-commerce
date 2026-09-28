import { describe, expect, it } from "vitest";
import { assessCatalogue } from "catalog-concierge";
import selkirkJson from "../../prisma/seed-data/selkirk.json";
import type { SeedCatalog, SeedProduct } from "../../prisma/seed-data/types";
import {
  ALL_CATEGORIES,
  CATEGORY_DEFS,
  OTHER_CATEGORY,
  parseImportArgs,
  resolveRate,
  storeKey,
  toEvaluateCatalogue,
  toMinor,
  triageFeed,
  triageProduct,
  triageReport,
  type ShopifyProduct,
} from "../../scripts/lib/shopify-catalog";

const selkirk = selkirkJson as unknown as SeedCatalog;

function shopify(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 1, title: "Test Paddle", handle: "test-paddle", body_html: "", vendor: "Acme", product_type: "Paddle", tags: [], options: [],
    variants: [{ id: 11, title: "Default Title", option1: null, option2: null, option3: null, sku: null, available: true, price: "129.00", compare_at_price: null, grams: 0, featured_image: null, position: 1 }],
    images: [],
    ...overrides,
  };
}

describe("importer arguments", () => {
  it("defaults to re-importing Selkirk exactly as the committed seed file was made", () => {
    expect(parseImportArgs([])).toEqual({
      store: "www.selkirk.com", storeName: "Selkirk Sport", out: "prisma/seed-data/selkirk.json",
      targetCurrency: "MYR", sourceCurrency: "USD", concurrency: 2, cacheDir: "node_modules/.cache/zy-import/www.selkirk.com",
      skuPrefix: "SLK", includeOther: false,
    });
  });

  it("reads the trial command for a store that already prices in ringgit", () => {
    const options = parseImportArgs(["--store", "www.mypickleball.my", "--name", "MyPickleball", "--source-currency", "myr", "--currency", "myr", "--out", "/tmp/mpb.json", "--evaluate-out", "/tmp/mpb.evaluate.json"]);
    expect(options).toMatchObject({ store: "www.mypickleball.my", storeName: "MyPickleball", sourceCurrency: "MYR", targetCurrency: "MYR", out: "/tmp/mpb.json", evaluateOut: "/tmp/mpb.evaluate.json", skuPrefix: "MYP" });
  });

  it("never lets another store's import overwrite selkirk.json", () => {
    const options = parseImportArgs(["--store", "www.mypickleball.my"]);
    expect(options.out).toBe("prisma/seed-data/mypickleball.json");
    expect(options.storeName).toBe("www.mypickleball.my");
    expect(options.skuPrefix).toBe("MYP");
  });

  it("takes --include-other as a switch, wherever it sits, without eating the next option", () => {
    expect(parseImportArgs(["--include-other", "--out", "x.json"])).toMatchObject({ includeOther: true, out: "x.json" });
    expect(parseImportArgs(["--out", "x.json", "--include-other"])).toMatchObject({ includeOther: true, out: "x.json" });
  });

  it("refuses an option with nothing after it rather than taking the next option as its value", () => {
    expect(() => parseImportArgs(["--out"])).toThrow("--out needs a value");
    expect(() => parseImportArgs(["--out", "--include-other"])).toThrow("--out needs a value");
  });

  it("accepts the store as a pasted URL", () => {
    expect(parseImportArgs(["--store", "https://www.mypickleball.my/"])).toMatchObject({ store: "www.mypickleball.my", out: "prisma/seed-data/mypickleball.json" });
  });

  it("uses the SKU prefix it is given", () => {
    expect(parseImportArgs(["--store", "www.mypickleball.my", "--sku-prefix", "mpb"]).skuPrefix).toBe("MPB");
  });

  it("refuses a misspelt option rather than silently converting at the wrong rate", () => {
    expect(() => parseImportArgs(["--source-curency", "MYR"])).toThrow(/Unknown argument --source-curency/);
    expect(() => parseImportArgs(["www.mypickleball.my"])).toThrow(/Unknown argument www\.mypickleball\.my/);
  });

  it("refuses a concurrency that would fetch nothing", () => {
    expect(() => parseImportArgs(["--concurrency", "0"])).toThrow(/--concurrency/);
    expect(() => parseImportArgs(["--concurrency", "two"])).toThrow(/--concurrency/);
    expect(parseImportArgs(["--concurrency", "4"]).concurrency).toBe(4);
  });

  it("names a store by its domain without www or the top-level domain", () => {
    expect(storeKey("www.selkirk.com")).toBe("selkirk");
    expect(storeKey("www.mypickleball.my")).toBe("mypickleball");
    expect(storeKey("https://shop.example.com.my/")).toBe("shop-example-com");
    expect(storeKey("localhost:8443")).toBe("localhost");
    expect(storeKey("...")).toBe("store");
  });
});

describe("currency", () => {
  it("needs no rate when the store already prices in the target currency", () => {
    expect(resolveRate("MYR", "MYR")).toEqual({ rate: 1, rateSource: "none: the store already prices in MYR" });
    expect(resolveRate("USD", "USD").rate).toBe(1);
  });

  it("records the rate it actually used, and for USD → MYR the same source the Selkirk seed carries", () => {
    expect(resolveRate("USD", "MYR")).toEqual({ rate: selkirk.pricing.rate, rateSource: selkirk.pricing.rateSource });
    expect(resolveRate("USD", "SGD")).toEqual({ rate: 1.29, rateSource: "https://wise.com/gb/currency-converter/usd-to-sgd-rate (2026-09-06)" });
  });

  it("says which rate is missing", () => {
    expect(() => resolveRate("SGD", "MYR")).toThrow("No conversion rate for SGD:MYR; add it to RATES");
    expect(() => resolveRate("USD", "MYR", {})).toThrow("No conversion rate for USD:MYR");
  });

  it("keeps a same-currency price to the sen", () => {
    expect(toMinor("129.00", 1)).toBe(12900);
    expect(toMinor("89.9", 1)).toBe(8990);
    expect(toMinor("19.99", 1)).toBe(1999);
  });

  it("rounds a converted price to a whole unit ending .90, never below 1.00", () => {
    expect(toMinor("80.00", 4.415)).toBe(35290); // SLK-001 in the committed seed
    expect(toMinor("199.99", 4.415)).toBe(88290);
    expect(toMinor("0.10", 4.415)).toBe(100);
  });

  it("reads a price that is not a number as zero", () => {
    expect(toMinor("n/a", 1)).toBe(0);
  });
});

describe("categorisation", () => {
  it("files a Selkirk-shaped product under its category", () => {
    expect(triageProduct(shopify())).toEqual({ category: "paddles" });
    expect(triageProduct(shopify({ product_type: "", tags: ["bags"] }))).toEqual({ category: "bags" });
  });

  it("leaves out what is not merchandise, even with --include-other", () => {
    expect(triageProduct(shopify({ title: "Gift Card" }), true)).toEqual({ dropped: "excluded" });
    expect(triageProduct(shopify({ product_type: "Offsite" }), true)).toEqual({ dropped: "excluded" });
    expect(triageProduct(shopify({ tags: ["hide"] }), true)).toEqual({ dropped: "excluded" });
  });

  it("leaves out a product with nothing to sell it for", () => {
    const free = shopify();
    free.variants[0]!.price = "0.00";
    expect(triageProduct(free, true)).toEqual({ dropped: "unpriced" });
  });

  it("drops what no category recognises unless told to keep it under Other", () => {
    const unknown = shopify({ product_type: "Pickleball Paddles" });
    expect(triageProduct(unknown)).toEqual({ dropped: "unrecognised" });
    expect(triageProduct(unknown, true)).toEqual({ category: "other" });
  });

  it("lists Other last and gives every category a description blurb", () => {
    expect(ALL_CATEGORIES.at(-1)).toBe(OTHER_CATEGORY);
    expect(new Set(ALL_CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORY_DEFS.length + 1);
    for (const c of ALL_CATEGORIES) expect(c.blurb).toContain("{brand}");
  });
});

describe("what the import leaves out", () => {
  const feed = [
    shopify({ title: "Kept Paddle" }),
    shopify({ title: "JOOLA Perseus", product_type: "Pickleball Paddles" }),
    shopify({ title: "Gearbox CX14", product_type: "Pickleball Paddles" }),
    shopify({ title: "Franklin X-40", product_type: "Pickleball Balls" }),
    shopify({ title: "Mystery", product_type: "  " }),
    shopify({ title: "Gift Card" }),
    shopify({ title: "Free Sample", variants: [{ ...shopify().variants[0]!, price: "0" }] }),
  ];

  it("counts every dropped product by reason and unrecognised ones by product_type", () => {
    const triage = triageFeed(feed);
    expect(triage.kept.map((k) => k.p.title)).toEqual(["Kept Paddle"]);
    expect(triage.excluded).toBe(1);
    expect(triage.unpriced).toBe(1);
    expect(triage.unrecognised).toEqual([
      { productType: "Pickleball Paddles", count: 2, examples: ["JOOLA Perseus", "Gearbox CX14"] },
      { productType: "", count: 1, examples: ["Mystery"] },
      { productType: "Pickleball Balls", count: 1, examples: ["Franklin X-40"] },
    ]);
  });

  it("keeps at most three example titles per product_type", () => {
    const many = Array.from({ length: 5 }, (_, i) => shopify({ title: `Shoe ${i}`, product_type: "Court Shoes" }));
    expect(triageFeed(many).unrecognised).toEqual([{ productType: "Court Shoes", count: 5, examples: ["Shoe 0", "Shoe 1", "Shoe 2"] }]);
  });

  it("prints the drops and how to keep them", () => {
    const lines = triageReport(triageFeed(feed), feed.length, false);
    expect(lines[0]).toBe("  7 products in feed, 1 importable, 6 dropped");
    expect(lines).toContain("    1 excluded as not merchandise (gift cards, memberships, demos, hidden)");
    expect(lines).toContain("    1 with no price above zero");
    expect(lines).toContain("    4 matched no category and were dropped, by product_type:");
    expect(lines).toContain('         2  "Pickleball Paddles"  e.g. JOOLA Perseus; Gearbox CX14');
    expect(lines).toContain("         1  (no product_type)  e.g. Mystery");
    expect(lines.at(-1)).toMatch(/--include-other/);
  });

  it("with --include-other, keeps them under Other in feed order and still says which types they were", () => {
    const triage = triageFeed(feed, true);
    expect(triage.kept.map((k) => [k.p.title, k.category])).toEqual([
      ["Kept Paddle", "paddles"], ["JOOLA Perseus", "other"], ["Gearbox CX14", "other"], ["Franklin X-40", "other"], ["Mystery", "other"],
    ]);
    const lines = triageReport(triage, feed.length, true);
    expect(lines[0]).toBe("  7 products in feed, 5 importable, 2 dropped");
    expect(lines).toContain('    4 matched no category and were filed under "Other", by product_type:');
    expect(lines.join("\n")).not.toMatch(/Re-run/);
  });

  it("says nothing more when the whole feed was imported", () => {
    expect(triageReport(triageFeed([shopify()]), 1, false)).toEqual(["  1 products in feed, 1 importable"]);
  });
});

describe("the catalog-concierge evaluate shape", () => {
  const product = (overrides: Partial<SeedProduct> = {}): SeedProduct => ({
    sku: "MYP-001", slug: "joola-perseus", name: "JOOLA Perseus", brand: "JOOLA", category: "paddles", description: "Pickleball paddle from JOOLA.",
    price: 99900, specs: { "Core Thickness": "16mm" }, stockQuantity: 34, lowStockThreshold: 5,
    images: [{ url: "https://cdn.example/a.jpg?width=1200", alt: "JOOLA Perseus" }, { url: "https://cdn.example/b.jpg?width=1200", alt: "view 2" }],
    source: { url: "https://www.mypickleball.my/products/joola-perseus", handle: "joola-perseus", originalPrice: "999.00", originalCurrency: "MYR", productType: "Paddle", tags: [] },
    ...overrides,
  });
  const catalog = (products: SeedProduct[]): SeedCatalog => ({
    generatedAt: "2026-09-28T00:00:00.000Z",
    source: { store: "www.mypickleball.my", storeName: "MyPickleball", feedUrl: "https://www.mypickleball.my/products.json", currency: "MYR" },
    pricing: { currency: "MYR", rate: 1, rateSource: "none: the store already prices in MYR" },
    categories: [{ slug: "paddles", name: "Paddles", description: "", sortOrder: 0 }],
    products,
  });

  it("maps a seed product to what the evaluate command reads: ref, name, numeric price, named category, one image, the store's own link", () => {
    expect(toEvaluateCatalogue(catalog([product()]))).toEqual([{
      ref: "MYP-001", name: "JOOLA Perseus", url: "https://www.mypickleball.my/products/joola-perseus", brand: "JOOLA",
      category: { slug: "paddles", name: "Paddles" }, description: "Pickleball paddle from JOOLA.", price: 99900, priceFrom: false,
      stockQuantity: null, specs: { "Core Thickness": "16mm" }, imageUrl: "https://cdn.example/a.jpg?width=1200",
    }]);
  });

  it("carries only the stock the store published: sold out, or in stock with no invented count", () => {
    const [soldOut] = toEvaluateCatalogue(catalog([product({ stockQuantity: 0 })]));
    expect(soldOut!.stockQuantity).toBe(0);
    const [low] = toEvaluateCatalogue(catalog([product({ stockQuantity: 2 })]));
    expect(low!.stockQuantity).toBeNull();
    expect(low).not.toHaveProperty("lowStockThreshold");
  });

  it("keeps variants with their own price and availability, and marks a price that varies as 'from'", () => {
    const [p] = toEvaluateCatalogue(catalog([product({
      variants: [
        { sku: "V-1", name: "Blue", attributes: { Color: "Blue" }, stockQuantity: 12 },
        { sku: "V-2", name: "Red", attributes: { Color: "Red" }, priceOverride: 109900, stockQuantity: 0 },
      ],
    })]));
    expect(p!.priceFrom).toBe(true);
    expect(p!.variants).toEqual([
      { ref: "V-1", name: "Blue", attributes: { Color: "Blue" }, price: 99900, stockQuantity: null },
      { ref: "V-2", name: "Red", attributes: { Color: "Red" }, price: 109900, stockQuantity: 0 },
    ]);
  });

  it("has no image rather than a broken one", () => {
    expect(toEvaluateCatalogue(catalog([product({ images: [] })]))[0]!.imageUrl).toBeNull();
  });

  it("refuses a product whose category the file does not declare, as the seed does", () => {
    expect(() => toEvaluateCatalogue(catalog([product({ category: "balls" })]))).toThrow("Unknown category balls for MYP-001");
  });

  it("reads every product of the committed Selkirk seed, as the jq bridge did", () => {
    const products = toEvaluateCatalogue(selkirk);
    expect(products).toHaveLength(selkirk.products.length);
    for (const [i, p] of products.entries()) {
      const seed = selkirk.products[i]!;
      expect(p.ref).toBe(seed.sku);
      expect(typeof p.price).toBe("number");
      expect(p.category).toEqual({ slug: seed.category, name: selkirk.categories.find((c) => c.slug === seed.category)!.name });
      expect(p.url).toBe(seed.source.url);
      expect(p.imageUrl).toBe(seed.images[0]?.url ?? null);
    }
    expect(assessCatalogue(products).products).toBe(selkirk.products.length);
  });
});
