/**
 * Tenant resolution from the request Host header.
 *
 * Pure functions only — this module is imported by `src/proxy.ts`, which must stay
 * free of heavy dependencies, and by unit tests.
 *
 * Routing model (spec §4):
 *   {slug}.<ROOT_DOMAIN>        → tenant storefront / admin
 *   <ROOT_DOMAIN>, www.<ROOT>   → platform root (landing + super-admin)
 *
 * Custom domains are a documented v2 extension point: add a `customDomain`
 * column on Tenant and check it here before the subdomain rule.
 */

/** Slugs that can never be assigned to a tenant because they collide with
 *  platform routes, infrastructure hostnames, or would confuse users. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "admin",
  "api",
  "app",
  "platform",
  "login",
  "auth",
  "mail",
  "smtp",
  "imap",
  "ftp",
  "static",
  "assets",
  "cdn",
  "docs",
  "status",
  "support",
  "help",
  "blog",
  "dev",
  "staging",
  "test",
  "localhost",
  "vercel",
  "stripe",
  "webhooks",
  "_next",
]);

/** DNS-label safe: lowercase alphanumerics and hyphens, 3–63 chars, no leading/trailing hyphen. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export function isValidTenantSlug(slug: string): boolean {
  return TENANT_SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Root domain the platform is served from, e.g. "localhost:3000" or "zycommerce.com". */
export function getRootDomain(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000").trim().toLowerCase();
}

/**
 * The public host a request was made to.
 *
 * Prefers `x-forwarded-host` over `host` because Next.js renders Server Action
 * redirects by fetching its *own* listening origin (e.g. localhost:3000) with
 * the original headers forwarded; the Fetch API replaces `Host` with that
 * origin, so only `x-forwarded-host` still names the tenant subdomain. Hosting
 * platforms (Vercel) set the same header in front of the app.
 *
 * Trusting it is no weaker than trusting `Host`: both are client-controlled on
 * a bare server, and tenant selection is not a privilege — sessions are bound
 * to a tenant separately in src/lib/auth/guards.ts.
 */
export function requestHost(headers: Pick<Headers, "get">): string | null {
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("host");
}

/** Lower-cases and strips the port and any trailing dot from a Host value. */
export function normalizeHostname(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

/**
 * Returns the tenant slug for a Host header, or `null` when the request targets
 * the platform root. Nested subdomains (a.b.root) are rejected (null).
 *
 * Examples with rootDomain "localhost:3000":
 *   "acme.localhost:3000" → "acme"
 *   "localhost:3000"      → null
 *   "www.localhost:3000"  → null
 *   "a.b.localhost:3000"  → null
 */
export function resolveTenantSlug(
  host: string | null | undefined,
  rootDomain: string = getRootDomain(),
): string | null {
  if (!host) return null;
  const hostname = normalizeHostname(host);
  const root = normalizeHostname(rootDomain);

  if (hostname === root || hostname === `www.${root}`) return null;
  if (!hostname.endsWith(`.${root}`)) return null;

  const label = hostname.slice(0, -(root.length + 1));
  if (label.includes(".")) return null; // nested subdomain
  if (!TENANT_SLUG_PATTERN.test(label)) return null;
  if (RESERVED_SLUGS.has(label)) return null;
  return label;
}

/** Builds an absolute origin for a tenant, e.g. "http://acme.localhost:3000". */
export function tenantOrigin(slug: string, rootDomain: string = getRootDomain()): string {
  const protocol = rootDomain.startsWith("localhost") || rootDomain.includes("localhost:") ? "http" : "https";
  return `${protocol}://${slug}.${rootDomain}`;
}

/** Builds the platform root origin, e.g. "http://localhost:3000". */
export function platformOrigin(rootDomain: string = getRootDomain()): string {
  const protocol = rootDomain.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${rootDomain}`;
}
