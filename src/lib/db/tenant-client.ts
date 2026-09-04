/**
 * Tenant-scoped Prisma client (spec §4 — the most important file in the repo).
 *
 * `createTenantDb(tenantId)` returns a Prisma client extension that rewrites
 * the arguments of EVERY top-level operation on EVERY tenant-scoped model so
 * that:
 *   - reads/updates/deletes gain an extra `AND: [{ tenantId }]` constraint
 *   - creates/upserts have `tenantId` forced to the current tenant
 *   - the Tenant model itself is pinned to the current tenant and cannot be
 *     created or deleted
 *
 * Feature code must obtain this client via `getTenantDb()` in
 * `src/lib/tenant/current.ts` and must never import `unscopedDb` directly.
 *
 * Known limits (documented, tested, and acceptable for v1):
 *   - Nested writes (`{ items: { create: [...] } }`) are NOT rewritten. Every
 *     scoped model has a NOT NULL `tenantId`, so TypeScript and Postgres force
 *     the caller to supply it explicitly; the failure mode is a loud error,
 *     never a silent cross-tenant write.
 *   - `$queryRaw` / `$executeRaw` bypass extensions. Raw SQL must go through
 *     `unscopedDb` and include an explicit tenant filter; keep it rare.
 *   - Postgres Row Level Security is a v2 defence-in-depth option.
 */
import { unscopedDb } from "./prisma";
import { applyTenantScope, TenantScopeViolationError } from "./tenant-scope";

export { applyTenantScope, TENANT_SCOPED_MODELS, TenantScopeViolationError, UNSCOPED_MODELS } from "./tenant-scope";
export type { TenantScopedModel } from "./tenant-scope";

/**
 * Creates a client whose every query is confined to `tenantId`. Cheap to
 * construct (shares the underlying connection pool), so build one per request.
 */
export function createTenantDb(tenantId: string) {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new TenantScopeViolationError("createTenantDb requires a non-empty tenantId");
  }
  return unscopedDb.$extends({
    name: "tenantScope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const scoped = applyTenantScope(model, operation, args, tenantId);
          return query(scoped as unknown as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof createTenantDb>;
