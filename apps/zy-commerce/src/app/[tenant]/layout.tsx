import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SuspendedNotice } from "@/components/tenant/suspended-notice";
import { tenantCssVars } from "@/lib/tenant/branding";
import { getCurrentTenant, getCurrentTenantSlug } from "@/lib/tenant/current";
import { tenantOrigin } from "@/lib/tenant/resolve";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { title: "Store not found" };

  // What someone sees when this link is pasted into Facebook or WhatsApp.
  // Named as a demo here as well as on the page, because a link preview is
  // often the only thing that gets read.
  const description = `A demonstration storefront for the Catalog Concierge assistant. Ask ${tenant.assistantName} about any product and it answers from this catalogue's own specifications.`;

  // The image is named by hand rather than left to the `opengraph-image` file
  // convention. Left alone, Next builds the URL from the matched route and
  // emits `/{slug}/opengraph-image` — but the slug is internal, added by
  // src/proxy.ts, so a crawler fetching that path gets it prefixed a second
  // time and 404s. `/opengraph-image` is the URL the outside world can reach.
  const image = { url: "/opengraph-image", width: 1200, height: 630, alt: `${tenant.name} — ask the store anything` };

  return {
    metadataBase: new URL(tenantOrigin(tenant.slug)),
    title: { default: tenant.name, template: `%s · ${tenant.name}` },
    description,
    openGraph: { type: "website", siteName: tenant.name, title: tenant.name, description, images: [image] },
    twitter: { card: "summary_large_image", title: tenant.name, description, images: [image] },
  };
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
