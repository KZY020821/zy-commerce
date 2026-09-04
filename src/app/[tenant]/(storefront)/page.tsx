import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

export default async function StorefrontHomePage() {
  const tenant = await requireCurrentTenant();
  const db = await getTenantDb();
  const [productCount, categoryCount] = await Promise.all([db.product.count({ where: { active: true } }), db.category.count()]);

  return (
    <section className="space-y-6">
      <div className="rounded-xl bg-primary px-8 py-16 text-primary-foreground">
        <h1 className="text-4xl font-semibold tracking-tight">{tenant.name}</h1>
        <p className="mt-3 max-w-xl text-primary-foreground/80">Welcome to our store.</p>
      </div>
      <p className="text-sm text-muted-foreground">
        {productCount} {productCount === 1 ? "product" : "products"} in {categoryCount} {categoryCount === 1 ? "category" : "categories"}. Catalog browsing arrives in Phase 2.
      </p>
    </section>
  );
}
