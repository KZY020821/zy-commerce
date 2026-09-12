import { describe, expect, it } from "vitest";
import { currencyFractionDigits, majorToMinor, minorToMajor } from "@/lib/money";

describe("currency conversion edges", () => {
  it("assumes two decimals for something that is not a currency code", () => {
    expect(currencyFractionDigits("not-a-currency")).toBe(2);
  });

  it("converts what an admin types into minor units, per currency", () => {
    expect(majorToMinor("19.99", "USD")).toBe(1999);
    expect(majorToMinor(1500, "JPY")).toBe(1500);
    expect(majorToMinor("1.234", "KWD")).toBe(1234);
    expect(minorToMajor(1999, "USD")).toBe(19.99);
  });

  it("refuses text that is not a number", () => {
    expect(() => majorToMinor("abc", "USD")).toThrow(RangeError);
    expect(() => majorToMinor(Number.NaN, "USD")).toThrow(RangeError);
    expect(() => majorToMinor(Number.POSITIVE_INFINITY, "USD")).toThrow(RangeError);
  });
});
