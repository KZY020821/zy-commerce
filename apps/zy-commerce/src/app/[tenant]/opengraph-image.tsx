import { renderLinkPreview } from "@/lib/og/link-preview";

export { alt, size, contentType } from "@/lib/og/link-preview";

/**
 * Serves the link preview for tenant storefronts.
 *
 * A crawler asks for `/opengraph-image` on the storefront's own hostname, and
 * src/proxy.ts rewrites that to `/{slug}/opengraph-image` — this segment. The
 * public URL is pinned in `generateMetadata` in the layout next door, because
 * the one Next would generate carries the internal slug and 404s once the
 * proxy prefixes it a second time.
 *
 * This is also where a per-store preview would go, if branding one is ever
 * worth it: the tenant is resolvable from the request here.
 */
export default function TenantOpengraphImage() {
  return renderLinkPreview();
}
