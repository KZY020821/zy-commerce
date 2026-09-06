import Image from "next/image";
import Link from "next/link";
import { StockBadge } from "@/components/storefront/stock-badge";
import { formatMoney } from "@/lib/money";

export interface ProductCardData {
  slug: string;
  name: string;
  price: number;
  currency: string;
  stockQuantity: number;
  lowStockThreshold: number;
  hasVariants: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  categoryName: string | null;
}

export function ProductCard({ product, locale }: { product: ProductCardData; locale: string }) {
  return (
    <Link href={`/products/${product.slug}`} className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {product.imageUrl ? (
          <Image src={product.imageUrl} alt={product.imageAlt ?? product.name} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.categoryName ? <p className="text-xs uppercase tracking-wide text-muted-foreground">{product.categoryName}</p> : null}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</h3>
        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="font-semibold">
            {product.hasVariants ? <span className="text-xs font-normal text-muted-foreground">from </span> : null}
            {formatMoney(product.price, product.currency, locale)}
          </p>
          <StockBadge quantity={product.stockQuantity} lowStockThreshold={product.lowStockThreshold} />
        </div>
      </div>
    </Link>
  );
}
