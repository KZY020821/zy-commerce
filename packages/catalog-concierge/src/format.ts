/** Display helpers. Self-contained so the package has no runtime dependencies beyond the model SDK. */
import type { CatalogueProduct, StockLabel, StockStatus } from "./types";

const DEFAULT_LOW_STOCK = 5;

export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** 35290 + "MYR" → "RM 352.90". Falls back to a plain number for unknown currencies. */
export function formatMoney(amountMinor: number, currency: string, locale = "en-US"): string {
  const major = amountMinor / 10 ** currencyFractionDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

export function stockStatus(quantity: number | null | undefined, lowStockThreshold?: number | null): StockStatus {
  if (quantity === null || quantity === undefined) return "in_stock"; // stock not tracked
  if (quantity <= 0) return "out_of_stock";
  return quantity <= (lowStockThreshold ?? DEFAULT_LOW_STOCK) ? "low_stock" : "in_stock";
}

export const STOCK_LABELS: Record<StockStatus, StockLabel> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Sold out",
};

export function stockLabel(product: Pick<CatalogueProduct, "stockQuantity" | "lowStockThreshold">): StockLabel {
  return STOCK_LABELS[stockStatus(product.stockQuantity, product.lowStockThreshold)];
}

/** Normalises spec values to strings so the model always sees consistent text. */
export function specsToRecord(specs: Record<string, string | number | null> | null | undefined): Record<string, string> {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
}
