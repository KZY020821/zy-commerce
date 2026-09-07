import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SuspendedNotice } from "@/components/tenant/suspended-notice";
import { tenantCssVars } from "@/lib/tenant/branding";
import { getCurrentTenant, getCurrentTenantSlug } from "@/lib/tenant/current";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { title: "Store not found" };
  return { title: { default: tenant.name, template: `%s · ${tenant.name}` } };
}

/**
 * Every tenant route passes through here. The slug in the URL is only ever set
 * by src/proxy.ts; if it disagrees with the Host header (someone typed
 * <root>/acme/... directly) we 404 rather than serve another store.
 */
export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slugParam } = await params;
  const hostSlug = await getCurrentTenantSlug();
  if (!hostSlug || hostSlug !== slugParam) notFound();

  const tenant = await getCurrentTenant();
  if (!tenant) notFound();
  if (tenant.status !== "ACTIVE") return <SuspendedNotice storeName={tenant.name} />;

  return (
    <div className="flex min-h-full flex-1 flex-col" style={tenantCssVars(tenant)}>
      {children}
    </div>
  );
}
