import { Badge } from "@/components/ui/badge";
import { STOCK_LABELS, stockStatus } from "@/lib/catalog/stock";

export function StockBadge({ quantity, lowStockThreshold }: { quantity: number; lowStockThreshold: number }) {
  const status = stockStatus(quantity, lowStockThreshold);
  const variant = status === "in_stock" ? "secondary" : status === "low_stock" ? "outline" : "destructive";
  return <Badge variant={variant}>{STOCK_LABELS[status]}</Badge>;
}
