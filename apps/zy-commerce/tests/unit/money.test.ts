import { describe, expect, it } from "vitest";
import { calculateOrderTotals, calculateTax, formatMoney, majorToMinor, minorToMajor } from "@/lib/money";

describe("calculateTax", () => {
  it("applies basis points and rounds half up", () => {
    expect(calculateTax(1999, 600)).toBe(120); // 119.94 → 120
    expect(calculateTax(1000, 825)).toBe(83); // 82.5 → 83
    expect(calculateTax(1000, 0)).toBe(0);
    expect(calculateTax(0, 600)).toBe(0);
  });
  it("rejects invalid input", () => {
    expect(() => calculateTax(-1, 0)).toThrow(RangeError);
    expect(() => calculateTax(100, 10_001)).toThrow(RangeError);
    expect(() => calculateTax(10.5, 100)).toThrow(RangeError);
  });
});

describe("calculateOrderTotals", () => {
  it("sums lines, adds flat shipping, then tax on goods", () => {
    const totals = calculateOrderTotals({
      lines: [
        { unitPrice: 1999, quantity: 2 },
        { unitPrice: 500, quantity: 1 },
      ],
      shippingFlatRate: 700,
      taxRateBps: 600,
    });
    expect(totals).toEqual({ subtotal: 4498, shippingCost: 700, tax: 270, total: 5468 });
  });

  it("can tax shipping when the tenant requires it", () => {
    const totals = calculateOrderTotals({ lines: [{ unitPrice: 1000, quantity: 1 }], shippingFlatRate: 500, taxRateBps: 1000, taxShipping: true });
    expect(totals.tax).toBe(150);
    expect(totals.total).toBe(1650);
  });

  it("charges no shipping for an empty order", () => {
    expect(calculateOrderTotals({ lines: [], shippingFlatRate: 500, taxRateBps: 600 })).toEqual({ subtotal: 0, shippingCost: 0, tax: 0, total: 0 });
  });

  it("rejects fractional or negative amounts and zero quantities", () => {
    expect(() => calculateOrderTotals({ lines: [{ unitPrice: 19.99, quantity: 1 }], shippingFlatRate: 0, taxRateBps: 0 })).toThrow(RangeError);
    expect(() => calculateOrderTotals({ lines: [{ unitPrice: 100, quantity: 0 }], shippingFlatRate: 0, taxRateBps: 0 })).toThrow(RangeError);
    expect(() => calculateOrderTotals({ lines: [{ unitPrice: 100, quantity: 1 }], shippingFlatRate: -1, taxRateBps: 0 })).toThrow(RangeError);
  });
});

describe("minor/major conversion and formatting", () => {
  it("handles 2-, 0- and 3-decimal currencies", () => {
    expect(minorToMajor(1999, "USD")).toBe(19.99);
    expect(minorToMajor(1999, "JPY")).toBe(1999);
    expect(minorToMajor(1999, "KWD")).toBe(1.999);
    expect(majorToMinor("19.99", "USD")).toBe(1999);
    expect(majorToMinor(1999, "JPY")).toBe(1999);
    expect(majorToMinor("0.1", "USD")).toBe(10);
  });
  it("formats with the tenant locale", () => {
    expect(formatMoney(1999, "USD", "en-US")).toBe("$19.99");
    expect(formatMoney(1999, "MYR", "ms-MY")).toMatch(/19[.,]99/);
  });
  it("rejects negative major amounts", () => {
    expect(() => majorToMinor(-1, "USD")).toThrow(RangeError);
  });
});
