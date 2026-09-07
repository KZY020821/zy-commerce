/**
 * Server-side authorisation guards (spec §5, §9).
 *
 * Every guard re-reads the user from the database on each request, so a
 * revoked role, deleted account or suspended tenant takes effect immediately
 * even though the JWT cookie is still valid.
 *
 *   require*() — for pages/layouts: redirects to the right login page.
 *   assert*()  — for Server Actions / route handlers: throws instead.
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Tenant } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { unscopedDb } from "@/lib/db/prisma";
import { getCurrentTenant, requireCurrentTenant } from "@/lib/tenant/current";
import { auth } from "./index";

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface VerifiedUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string | null;
}

/** The session user, re-verified against the database. Null when signed out or stale. */
export const getVerifiedUser = cache(async (): Promise<VerifiedUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const user = await unscopedDb.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, tenantId: true },
  });
  if (!user) return null;
  // The token is only a hint; the database is the authority.
  if (user.role !== session.user.role || user.tenantId !== session.user.tenantId) return null;
  return user;
});

// --- Super admin (platform root) -------------------------------------------

export async function getSuperAdmin(): Promise<VerifiedUser | null> {
  const user = await getVerifiedUser();
  return user?.role === UserRole.SUPER_ADMIN && user.tenantId === null ? user : null;
}

export async function requireSuperAdmin(): Promise<VerifiedUser> {
  const user = await getSuperAdmin();
  if (!user) redirect("/platform/login");
  return user;
}

export async function assertSuperAdmin(): Promise<VerifiedUser> {
  const user = await getSuperAdmin();
  if (!user) throw new ForbiddenError("Super admin required");
  return user;
}

// --- Store admin (tenant subdomain) ----------------------------------------

export interface StoreAdminContext {
  user: VerifiedUser;
  tenant: Tenant;
}

export async function getStoreAdmin(): Promise<StoreAdminContext | null> {
  const tenant = await getCurrentTenant();
  if (!tenant || tenant.status !== "ACTIVE") return null;
  const user = await getVerifiedUser();
  if (!user || user.role !== UserRole.STORE_ADMIN || user.tenantId !== tenant.id) return null;
  return { user, tenant };
}

export async function requireStoreAdmin(): Promise<StoreAdminContext> {
  await requireCurrentTenant(); // 404 on the root domain or unknown slug
  const ctx = await getStoreAdmin();
  if (!ctx) redirect("/admin/login");
  return ctx;
}

export async function assertStoreAdmin(): Promise<StoreAdminContext> {
  const ctx = await getStoreAdmin();
  if (!ctx) throw new ForbiddenError("Store admin required");
  return ctx;
}

// --- Customer (tenant subdomain) — used from Phase 3/4 onwards --------------

export interface CustomerContext {
  user: VerifiedUser;
  tenant: Tenant;
}

export async function getCustomerUser(): Promise<CustomerContext | null> {
  const tenant = await getCurrentTenant();
  if (!tenant || tenant.status !== "ACTIVE") return null;
  const user = await getVerifiedUser();
  if (!user || user.role !== UserRole.CUSTOMER || user.tenantId !== tenant.id) return null;
  return { user, tenant };
}
