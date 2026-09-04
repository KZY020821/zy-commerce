import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { unscopedDb } from "@/lib/db/prisma";
import { tenantOrigin } from "@/lib/tenant/resolve";

export const metadata: Metadata = { title: "Tenants" };

export default async function PlatformTenantsPage() {
  await requireSuperAdmin(); // re-checked here as well as in the layout (spec §9)

  const tenants = await unscopedDb.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { users: true, products: true, orders: true } } },
  });

  return (
    <>
      <PageHeader title="Tenants" description="Every store hosted on this platform. Provisioning UI arrives in Phase 5; use the seed script until then." />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No tenants yet. Run <code>pnpm db:seed</code>.
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <a href={tenantOrigin(t.slug)} className="hover:underline" target="_blank" rel="noreferrer">
                      {t.name}
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.slug}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "ACTIVE" ? "default" : "destructive"}>{t.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {t.currency} · {t.country}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t._count.users}</TableCell>
                  <TableCell className="text-right tabular-nums">{t._count.products}</TableCell>
                  <TableCell className="text-right tabular-nums">{t._count.orders}</TableCell>
                  <TableCell className="text-muted-foreground">{t.createdAt.toISOString().slice(0, 10)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
