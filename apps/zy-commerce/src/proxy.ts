/**
 * Subdomain → tenant routing (spec §4, §8).
 *
 *   acme.<root>/products/x   →  rewrite to  /acme/products/x   (app/[tenant]/...)
 *   <root>/...               →  untouched                       (app/(root)/...)
 *
 * The browser URL never shows the slug segment. `app/[tenant]/layout.tsx`
 * re-derives the slug from the Host header and 404s if the route param
 * disagrees, which blocks `<root>/acme/...` path-based access.
 *
 * Keep this file dependency-light: it runs on every request.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requestHost, resolveTenantSlug } from "@/lib/tenant/resolve";

export const TENANT_SLUG_HEADER = "x-tenant-slug";

export function proxy(request: NextRequest) {
  const host = requestHost(request.headers);
  const slug = resolveTenantSlug(host);

  const requestHeaders = new Headers(request.headers);
  // Never trust a client-supplied tenant header.
  requestHeaders.delete(TENANT_SLUG_HEADER);
  // Make the public host survive Next's internal Server Action redirect fetch.
  if (host && !requestHeaders.get("x-forwarded-host")) requestHeaders.set("x-forwarded-host", host);

  if (!slug) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  requestHeaders.set(TENANT_SLUG_HEADER, slug);
  const url = request.nextUrl.clone();
  url.pathname = `/${slug}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals, and static assets.
    "/((?!api/|_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|txt|xml|json|woff2?)$).*)",
  ],
};
