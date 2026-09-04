import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStoreAdmin } from "@/lib/auth/guards";
import { getTenantDb } from "@/lib/tenant/current";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const { tenant } = await requireStoreAdmin(); // re-checked per page, not just in the layout (spec §9)
  const db = await getTenantDb();
  const [products, categories, orders, customers] = await Promise.all([
    db.product.count(),
    db.category.count(),
    db.order.count(),
    db.customer.count(),
  ]);

  return (
    <>
      <PageHeader title="Dashboard" description={`Overview for ${tenant.name}`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Products" value={products} />
        <StatCard label="Categories" value={categories} />
        <StatCard label="Orders" value={orders} />
        <StatCard label="Customers" value={customers} />
      </div>
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
