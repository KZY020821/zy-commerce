import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StockBadge } from "@/components/storefront/stock-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

type Params = Promise<{ slug: string }>;

async function loadProduct(slug: string) {
  const db = await getTenantDb();
  return db.product.findFirst({
    where: { slug, active: true },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      variants: { where: { active: true }, orderBy: { sortOrder: "asc" } },
      category: { select: { name: true, slug: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  const tenant = await requireCurrentTenant();
  const product = await loadProduct(slug);
  if (!product) notFound();

  const [primary, ...rest] = product.images;
  const specs = product.specs && typeof product.specs === "object" && !Array.isArray(product.specs) ? Object.entries(product.specs as Record<string, unknown>).map(([k, v]) => [k, String(v)] as const) : [];

  return (
    <article className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
          {primary ? <Image src={primary.url} alt={primary.alt ?? product.name} fill priority sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" /> : null}
        </div>
        {rest.length > 0 ? (
          <div className="grid grid-cols-4 gap-3">
            {rest.map((img) => (
              <div key={img.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                <Image src={img.url} alt={img.alt ?? product.name} fill sizes="25vw" className="object-cover" />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          {product.category ? (
            <Link href={`/?category=${product.category.slug}`} className="text-xs uppercase tracking-wide text-muted-foreground hover:underline">
              {product.category.name}
            </Link>
          ) : null}
          <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
          {product.brand ? <p className="text-sm text-muted-foreground">by {product.brand}</p> : null}
          <div className="flex items-center gap-3">
            <p className="text-2xl font-semibold">
              {product.hasVariants ? <span className="text-sm font-normal text-muted-foreground">from </span> : null}
              {formatMoney(product.price, product.currency, tenant.locale)}
            </p>
            <StockBadge quantity={product.stockQuantity} lowStockThreshold={product.lowStockThreshold} />
          </div>
          <p className="text-xs text-muted-foreground">SKU {product.sku}</p>
        </div>

        {product.description ? <p className="leading-relaxed text-muted-foreground">{product.description}</p> : null}

        {specs.length > 0 ? (
          <section aria-labelledby="specs-heading" className="rounded-lg border">
            <h2 id="specs-heading" className="border-b px-4 py-2 text-sm font-semibold">
              Specifications
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2">
              {specs.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 border-b px-4 py-2 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {product.variants.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Option</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Availability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.variants.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(v.priceOverride ?? product.price, product.currency, tenant.locale)}</TableCell>
                    <TableCell className="text-right">
                      <StockBadge quantity={v.stockQuantity} lowStockThreshold={product.lowStockThreshold} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <Button disabled className="w-full sm:w-auto" title="Cart and checkout arrive in Phase 3">
          Add to cart — coming in Phase 3
        </Button>
      </div>
    </article>
  );
}
