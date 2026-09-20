/**
 * Rebuilding what the customer saw. The Server Action tests cover the whole
 * path; these cover the parts that have to be exactly right on their own:
 * which page counts as a product page, and which cards a turn gets back.
 */
import { describe, expect, it, vi } from "vitest";
import { formatMoney, type ProductCard } from "catalog-concierge";
import type { StoredTurn } from "@/lib/ai/chat-history";
import { productCardsBySku, productSlugFromPath, referencedSkus, toRestoredMessages } from "@/lib/ai/transcript";

const card = (ref: string): ProductCard => ({ ref, name: `Paddle ${ref}`, url: `/products/${ref}`, imageUrl: null, price: 1000, priceFrom: false, priceLabel: formatMoney(1000, "MYR", "en-MY"), stockLabel: "In stock" });

describe("productSlugFromPath", () => {
  it("reads the slug of a storefront product page", () => {
    expect(productSlugFromPath("/products/slk-atlas-max")).toBe("slk-atlas-max");
    expect(productSlugFromPath("/products/slk-atlas-max/")).toBe("slk-atlas-max");
    expect(productSlugFromPath("/Products/SLK-Atlas-Max?utm=x#top")).toBe("slk-atlas-max");
  });

  it("refuses anything that is not one", () => {
    for (const path of ["", "/", "/products", "/products/", "/products/a/b", "/products/../admin", "//evil.example/products/x", "https://evil.example/products/x", "/search?q=/products/atlas", `/products/${"x".repeat(200)}`]) {
      expect(productSlugFromPath(path), path).toBeNull();
    }
    expect(productSlugFromPath(undefined)).toBeNull();
    expect(productSlugFromPath(null)).toBeNull();
  });
});

describe("referencedSkus", () => {
  it("lists every product the turns mention, once each, in the order they appeared", () => {
    const turns: StoredTurn[] = [
      { role: "user", content: "paddles?" },
      { role: "assistant", content: "Two options.", productSkus: ["PAD-2", "PAD-1"] },
      { role: "assistant", content: "And this one.", productSkus: ["PAD-1", "BALL-3"] },
    ];
    expect(referencedSkus(turns)).toEqual(["PAD-2", "PAD-1", "BALL-3"]);
    expect(referencedSkus([{ role: "user", content: "hi" }])).toEqual([]);
  });
});

describe("toRestoredMessages", () => {
  it("keeps the chips and attaches the cards that still exist", () => {
    const turns: StoredTurn[] = [
      { role: "user", content: "which paddle?", at: "2026-09-20T00:00:00.000Z" },
      { role: "assistant", content: "This one.", suggestions: ["Compare them"], productSkus: ["PAD-1", "GONE"], toolCalls: ["search_products"] },
      { role: "assistant", content: "It seems like the question is not related…", blocked: "no-signal" },
    ];

    expect(toRestoredMessages(turns, new Map([["PAD-1", card("PAD-1")]]))).toEqual([
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "This one.", suggestions: ["Compare them"], products: [card("PAD-1")] },
      // A refusal was on the screen too; leaving it out would rewrite history.
      { role: "assistant", content: "It seems like the question is not related…" },
    ]);
  });
});

describe("toRestoredMessages — the reasons on the cards", () => {
  it("puts each reason back on the card it belonged to, even when one product has gone", () => {
    const turns: StoredTurn[] = [
      { role: "assistant", content: "Two options.", productSkus: ["GONE", "PAD-1"], productNotes: ["cheapest", "16mm core, easiest on the arm"] },
    ];

    expect(toRestoredMessages(turns, new Map([["PAD-1", card("PAD-1")]]))).toEqual([
      { role: "assistant", content: "Two options.", products: [{ ...card("PAD-1"), note: "16mm core, easiest on the arm" }] },
    ]);
  });

  it("leaves the card alone when that turn recorded no reasons", () => {
    const turns: StoredTurn[] = [{ role: "assistant", content: "One option.", productSkus: ["PAD-1"] }];

    expect(toRestoredMessages(turns, new Map([["PAD-1", card("PAD-1")]]))[0]!.products![0]).toEqual(card("PAD-1"));
  });
});

describe("productCardsBySku", () => {
  const row = (over: Partial<{ sku: string; name: string; slug: string; price: number; hasVariants: boolean; stockQuantity: number | null; lowStockThreshold: number | null; images: { url: string }[] }> = {}) => ({
    sku: "PAD-1",
    name: "Atlas",
    slug: "atlas",
    price: 22090,
    hasVariants: false,
    stockQuantity: 12,
    lowStockThreshold: 5,
    images: [] as { url: string }[],
    ...over,
  });

  const store = { currency: "MYR", locale: "en-MY" };

  it("asks the database for nothing when no turn mentioned a product", async () => {
    const findMany = vi.fn(async () => []);

    expect((await productCardsBySku({ product: { findMany } } as never, store, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("builds a card per product, with its first photo or none at all", async () => {
    const findMany = vi.fn(async () => [row(), row({ sku: "PAD-2", name: "Vanguard", slug: "vanguard", hasVariants: true, images: [{ url: "https://img.test/v.png" }, { url: "https://img.test/v2.png" }] })]);

    const cards = await productCardsBySku({ product: { findMany } } as never, store, ["PAD-1", "PAD-2"]);

    expect(cards.get("PAD-1")).toEqual({
      ref: "PAD-1",
      name: "Atlas",
      url: "/products/atlas",
      imageUrl: null,
      price: 22090,
      priceFrom: false,
      priceLabel: formatMoney(22090, "MYR", "en-MY"),
      stockLabel: "In stock",
    });
    expect(cards.get("PAD-2")).toMatchObject({ imageUrl: "https://img.test/v.png", priceFrom: true });
  });

  it("has no card for a product that has left the catalogue", async () => {
    const findMany = vi.fn(async () => []);

    expect((await productCardsBySku({ product: { findMany } } as never, store, ["GONE"])).has("GONE")).toBe(false);
  });
});
