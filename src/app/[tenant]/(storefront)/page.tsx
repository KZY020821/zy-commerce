import Link from "next/link";
import { ProductCard } from "@/components/storefront/product-card";
import { cn } from "@/lib/utils";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

const PAGE_SIZE = 24;

export default async function StorefrontHomePage({ searchParams }: { searchParams: Promise<{ category?: string; page?: string; q?: string }> }) {
  const tenant = await requireCurrentTenant();
  const db = await getTenantDb();
  const { category: categorySlug, page: pageParam, q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const categories = await db.category.findMany({ where: { parentId: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const activeCategory = categorySlug ? categories.find((c) => c.slug === categorySlug) ?? null : null;

  const where = {
    active: true,
    ...(activeCategory ? { categoryId: activeCategory.id } : {}),
    ...(query
      ? { OR: [{ name: { contains: query, mode: "insensitive" as const } }, { brand: { contains: query, mode: "insensitive" as const } }, { description: { contains: query, mode: "insensitive" as const } }, { sku: { contains: query, mode: "insensitive" as const } }] }
      : {}),
  };
  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { images: { orderBy: { sortOrder: "asc" }, take: 1 }, category: { select: { name: true } } },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-primary px-8 py-12 text-primary-foreground">
        <h1 className="text-4xl font-semibold tracking-tight">{tenant.name}</h1>
        <p className="mt-2 max-w-xl text-primary-foreground/80">{query ? `Results for “${query}”` : activeCategory?.description ?? "Browse the full catalogue, or ask the assistant to help you choose."}</p>
      </section>

      {categories.length > 0 ? (
        <nav aria-label="Categories" className="flex flex-wrap gap-2">
          <Link href="/" className={cn("rounded-full border px-3 py-1 text-sm", !activeCategory ? "bg-foreground text-background" : "hover:bg-muted")}>
            All
          </Link>
          {categories.map((c) => (
            <Link key={c.id} href={`/?category=${c.slug}`} className={cn("rounded-full border px-3 py-1 text-sm", activeCategory?.id === c.id ? "bg-foreground text-background" : "hover:bg-muted")}>
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {products.length === 0 ? (
        <p className="text-muted-foreground">No products found{query ? ` for “${query}”` : ""}{activeCategory ? ` in ${activeCategory.name}` : ""}.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "product" : "products"}
            {activeCategory ? ` in ${activeCategory.name}` : ""}
            {query ? ` matching “${query}”` : ""}
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                locale={tenant.locale}
                product={{
                  slug: p.slug,
                  name: p.name,
                  price: p.price,
                  currency: p.currency,
                  stockQuantity: p.stockQuantity,
                  lowStockThreshold: p.lowStockThreshold,
                  hasVariants: p.hasVariants,
                  imageUrl: p.images[0]?.url ?? null,
                  imageAlt: p.images[0]?.alt ?? null,
                  categoryName: p.category?.name ?? null,
                }}
              />
            ))}
          </div>
          {pageCount > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-center gap-3 text-sm">
              {page > 1 ? <Link href={`/?${activeCategory ? `category=${activeCategory.slug}&` : ""}page=${page - 1}`} className="hover:underline">← Previous</Link> : null}
              <span className="text-muted-foreground">Page {page} of {pageCount}</span>
              {page < pageCount ? <Link href={`/?${activeCategory ? `category=${activeCategory.slug}&` : ""}page=${page + 1}`} className="hover:underline">Next →</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
