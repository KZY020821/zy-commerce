import { describe, expect, it } from "vitest";
import { currencyFractionDigits, formatMoney, specsToRecord, STOCK_LABELS, stockLabel, stockStatus, toProductCard } from "../src/format";

/** Intl uses non-breaking spaces in some locales; compare on ordinary ones. */
const plain = (s: string) => s.replace(/\u00a0|\u202f/g, " ");

describe("currencyFractionDigits", () => {
  it("knows how many minor digits a currency has", () => {
    expect(currencyFractionDigits("USD")).toBe(2);
    expect(currencyFractionDigits("MYR")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KWD")).toBe(3);
  });

  it("assumes two digits for something that is not a currency code", () => {
    expect(currencyFractionDigits("not-a-currency")).toBe(2);
  });
});

describe("formatMoney", () => {
  it("formats minor units in the store's currency and locale", () => {
    expect(plain(formatMoney(35290, "MYR", "en-MY"))).toBe("RM 352.90");
    expect(formatMoney(1999, "USD", "en-US")).toBe("$19.99");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
  });

  it("falls back to a plain number instead of throwing on a bad currency", () => {
    expect(formatMoney(1999, "not-a-currency")).toBe("not-a-currency 19.99");
  });
});

describe("stock", () => {
  it("treats untracked stock as available", () => {
    expect(stockStatus(null)).toBe("in_stock");
    expect(stockStatus(undefined)).toBe("in_stock");
  });

  it("is sold out at zero or below", () => {
    expect(stockStatus(0)).toBe("out_of_stock");
    expect(stockStatus(-3)).toBe("out_of_stock");
  });

  it("is low at or below the threshold, which defaults to 5", () => {
    expect(stockStatus(5)).toBe("low_stock");
    expect(stockStatus(6)).toBe("in_stock");
    expect(stockStatus(9, 10)).toBe("low_stock");
    expect(stockStatus(2, null)).toBe("low_stock");
  });

  it("labels each status for display", () => {
    expect(stockLabel({ stockQuantity: 0 })).toBe(STOCK_LABELS.out_of_stock);
    expect(stockLabel({ stockQuantity: 3, lowStockThreshold: 5 })).toBe("Low stock");
    expect(stockLabel({ stockQuantity: 50 })).toBe("In stock");
  });
});

describe("specsToRecord", () => {
  it("returns an empty record for anything that is not a plain object", () => {
    expect(specsToRecord(null)).toEqual({});
    expect(specsToRecord(undefined)).toEqual({});
    expect(specsToRecord(["16mm"] as never)).toEqual({});
  });

  it("stringifies, trims, and drops empty values", () => {
    expect(specsToRecord({ Weight: 8, Core: " 16mm ", Blank: "   ", Missing: null })).toEqual({ Weight: "8", Core: "16mm" });
  });
});

describe("toProductCard", () => {
  it("renders a catalogue product the way the widget shows it", () => {
    expect(
      toProductCard(
        { ref: "PAD-1", name: "Atlas", url: "/products/atlas", imageUrl: "https://img.test/a.png", price: 22090, priceFrom: true, stockQuantity: 2, lowStockThreshold: 5 },
        { currency: "MYR", locale: "en-MY" },
      ),
    ).toEqual({
      ref: "PAD-1",
      name: "Atlas",
      url: "/products/atlas",
      imageUrl: "https://img.test/a.png",
      price: 22090,
      priceFrom: true,
      priceLabel: formatMoney(22090, "MYR", "en-MY"),
      stockLabel: "Low stock",
    });
  });

  it("fills in what a sparse product leaves out", () => {
    expect(toProductCard({ ref: "B-1", name: "Ball", price: 3090 }, { currency: "USD" })).toMatchObject({
      url: null,
      imageUrl: null,
      priceFrom: false,
      // No stock figure means stock is not tracked, not that it is sold out.
      stockLabel: "In stock",
    });
  });
});
