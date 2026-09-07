/**
 * Money helpers. All amounts are integers in the currency's minor unit.
 * Tax rates are basis points (1 bp = 0.01%).
 */

/** Rounds half away from zero, like a till would. */
function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** tax = subtotal × rateBps / 10 000, rounded to the nearest minor unit. */
export function calculateTax(subtotalMinor: number, taxRateBps: number): number {
  if (!Number.isInteger(subtotalMinor) || subtotalMinor < 0) throw new RangeError("subtotal must be a non-negative integer");
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) throw new RangeError("taxRateBps must be an integer in 0..10000");
  return roundHalfUp((subtotalMinor * taxRateBps) / 10_000);
}

export interface OrderTotals {
  subtotal: number;
  shippingCost: number;
  tax: number;
  total: number;
}

export interface OrderTotalsInput {
  /** [{ unitPrice, quantity }] in minor units */
  lines: ReadonlyArray<{ unitPrice: number; quantity: number }>;
  shippingFlatRate: number;
  taxRateBps: number;
  /** Whether tax applies to shipping too. Default false (tax on goods only). */
  taxShipping?: boolean;
}

/** Spec §10: total = subtotal + shipping + tax. Pure and unit-tested. */
export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  const subtotal = input.lines.reduce((sum, l) => {
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new RangeError("unitPrice must be a non-negative integer");
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new RangeError("quantity must be a positive integer");
    return sum + l.unitPrice * l.quantity;
  }, 0);
  if (!Number.isInteger(input.shippingFlatRate) || input.shippingFlatRate < 0) throw new RangeError("shippingFlatRate must be a non-negative integer");
  const shippingCost = input.lines.length === 0 ? 0 : input.shippingFlatRate;
  const taxableBase = input.taxShipping ? subtotal + shippingCost : subtotal;
  const tax = calculateTax(taxableBase, input.taxRateBps);
  return { subtotal, shippingCost, tax, total: subtotal + shippingCost + tax };
}

/** Number of minor-unit digits for a currency (JPY=0, KWD=3, most=2). */
export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Converts minor units to a major-unit number, e.g. 1999 USD → 19.99. */
export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyFractionDigits(currency);
}

/** Converts a major-unit decimal (as typed by an admin) to minor units, e.g. "19.99" → 1999. */
export function majorToMinor(amountMajor: number | string, currency: string): number {
  const n = typeof amountMajor === "string" ? Number(amountMajor) : amountMajor;
  if (!Number.isFinite(n) || n < 0) throw new RangeError("amount must be a non-negative number");
  return Math.round(n * 10 ** currencyFractionDigits(currency));
}

/** Formats minor units for display using the tenant's locale, e.g. 1999 → "$19.99". */
export function formatMoney(amountMinor: number, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minorToMajor(amountMinor, currency));
}
