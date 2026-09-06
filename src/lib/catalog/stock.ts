/** Storefront stock status (spec §7.2): in stock / low stock / out of stock. */
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export function stockStatus(quantity: number, lowStockThreshold: number): StockStatus {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= lowStockThreshold) return "low_stock";
  return "in_stock";
}

export const STOCK_LABELS: Record<StockStatus, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Sold out",
};
