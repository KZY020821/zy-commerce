/**
 * Request-scoped tenant context for Server Components, Server Actions and
 * Route Handlers. All functions are memoised per request with React `cache`.
 *
 * The tenant is derived from the Host header (the same rule `src/proxy.ts`
 * uses), never from a client-controllable header or route param alone.
 */
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Tenant } from "@/generated/prisma/client";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantDb, type TenantDb } from "@/lib/db/tenant-client";
import { requestHost, resolveTenantSlug } from "./resolve";

export class TenantSuspendedError extends Error {
  constructor(slug: string) {
    super(`Tenant "${slug}" is suspended`);
    this.name = "TenantSuspendedError";
  }
}

/** Slug from the Host header, or null on the platform root domain. */
export const getCurrentTenantSlug = cache(async (): Promise<string | null> => {
  const h = await headers();
  return resolveTenantSlug(requestHost(h));
});

/** Tenant row for the current host, or null if none / unknown slug. */
export const getCurrentTenant = cache(async (): Promise<Tenant | null> => {
  const slug = await getCurrentTenantSlug();
  if (!slug) return null;
  return unscopedDb.tenant.findUnique({ where: { slug } });
});

/** Tenant row or a 404. Does not check status — layouts render a suspended notice. */
export async function requireCurrentTenant(): Promise<Tenant> {
  const tenant = await getCurrentTenant();
  if (!tenant) notFound();
  return tenant;
}

/** Tenant-scoped Prisma client for the current request. Refuses suspended tenants. */
export const getTenantDb = cache(async (): Promise<TenantDb> => {
  const tenant = await requireCurrentTenant();
  if (tenant.status !== "ACTIVE") throw new TenantSuspendedError(tenant.slug);
  return createTenantDb(tenant.id);
});
