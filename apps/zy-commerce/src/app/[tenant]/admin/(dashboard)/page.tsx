import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { assessCatalogue } from "catalog-concierge";
import { createPrismaCatalogAdapter } from "@/lib/ai/prisma-adapter";
import { requireStoreAdmin } from "@/lib/auth/guards";
import { getTenantDb } from "@/lib/tenant/current";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const { tenant } = await requireStoreAdmin(); // re-checked per page, not just in the layout (spec §9)
  const db = await getTenantDb();
  const [products, categories, orders, customers, conversations, catalogue] = await Promise.all([
    db.product.count(),
    db.category.count(),
    db.order.count(),
    db.customer.count(),
    db.chatConversation.count(),
    // The same catalogue the assistant sees, judged by the same function it
    // ships with — so this page cannot disagree with the package.
    createPrismaCatalogAdapter(db).listCatalogue(),
  ]);
  const readiness = assessCatalogue(catalogue);

  return (
    <>
      <PageHeader title="Dashboard" description={`Overview for ${tenant.name}`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Products" value={products} />
        <StatCard label="Categories" value={categories} />
        <StatCard label="Orders" value={orders} />
        <StatCard label="Customers" value={customers} />
        <StatCard label="Assistant chats" value={conversations} hint="See Conversations" />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>How much your assistant has to work with</CardTitle>
          <CardDescription>
            It answers from your product specifications: a product without them can be found and priced, but not compared or recommended for a reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-2xl font-semibold">{readiness.specCoverage}%</p>
              <p className="text-sm text-muted-foreground">
                have specifications ({readiness.withSpecs} of {readiness.products})
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{readiness.withDescription}</p>
              <p className="text-sm text-muted-foreground">have a description</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{readiness.withImage}</p>
              <p className="text-sm text-muted-foreground">have a photo</p>
            </div>
          </div>
          {readiness.thinnest.some((p) => p.specCount === 0) ? (
            <div className="text-sm">
              <p className="mb-1 text-muted-foreground">Least to say about:</p>
              <ul className="space-y-1">
                {readiness.thinnest.map((p) => (
                  <li key={p.ref} className="flex items-center justify-between gap-3 border-b py-1 last:border-0">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {p.specCount === 0 ? "no specifications" : `${p.specCount} specifications`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Store settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Currency:</span> {tenant.currency} ({tenant.country}, {tenant.locale})
          </p>
          <p>
            <span className="text-muted-foreground">Flat shipping:</span> {tenant.shippingFlatRate} minor units
          </p>
          <p>
            <span className="text-muted-foreground">Tax rate:</span> {(tenant.taxRateBps / 100).toFixed(2)}%
          </p>
          <p>
            <span className="text-muted-foreground">Brand colour:</span> <span className="inline-block size-3 rounded-sm bg-primary align-middle" /> {tenant.primaryColor}
          </p>
        </CardContent>
      </Card>
    </>
  );
}
