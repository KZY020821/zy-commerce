/**
 * Rebuilding what the customer saw. The Server Action tests cover the whole
 * path; these cover the parts that have to be exactly right on their own:
 * which page counts as a product page, and which cards a turn gets back.
 */
import { describe, expect, it } from "vitest";
import { formatMoney, type ProductCard } from "catalog-concierge";
import type { StoredTurn } from "@/lib/ai/chat-history";
import { productSlugFromPath, referencedSkus, toRestoredMessages } from "@/lib/ai/transcript";

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
