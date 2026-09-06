/**
 * Pure tenant-scoping rules — no Prisma client, no I/O — so they can be unit
 * tested exhaustively. `tenant-client.ts` wires these into a Prisma extension.
 *
 * Semantics: the scope is always ADDED as an extra `AND` constraint. It never
 * rewrites what the caller asked for, so a query that names another tenant
 * simply matches nothing (or fails with "record not found"), instead of being
 * silently redirected to the caller's own rows.
 */
import type { Prisma } from "@/generated/prisma/client";

/**
 * Every model that carries a `tenantId` column. `tests/unit/schema-invariants.test.ts`
 * parses schema.prisma and fails if this list and the schema ever disagree.
 */
export const TENANT_SCOPED_MODELS = [
  "User",
  "Customer",
  "Address",
  "Category",
  "Product",
  "ProductImage",
  "ProductVariant",
  "Cart",
  "CartItem",
  "Order",
  "OrderItem",
  "OrderStatusEvent",
  "Payment",
  "ChatConversation",
] as const satisfies readonly Prisma.ModelName[];

/** Models deliberately without a tenantId column. */
export const UNSCOPED_MODELS = ["Tenant"] as const satisfies readonly Prisma.ModelName[];

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number];

const SCOPED = new Set<string>(TENANT_SCOPED_MODELS);

export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeViolationError";
  }
}

/** Operations whose `where` must be constrained. */
const WHERE_OPS: ReadonlySet<string> = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

/** Operations whose `data` must have tenantId forced. */
const CREATE_OPS: ReadonlySet<string> = new Set(["create", "createMany", "createManyAndReturn"]);

/** Operations permitted on the Tenant model through a scoped client. */
const TENANT_MODEL_ALLOWED: ReadonlySet<string> = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "update",
]);

export type AnyArgs = Record<string, unknown>;

function asObject(v: unknown): AnyArgs {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as AnyArgs) : {};
}

function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Appends `constraint` to the where's AND list. Top-level unique keys are kept
 * in place so findUnique/update/delete still satisfy Prisma's unique-input rule.
 */
function andWhere(where: unknown, constraint: AnyArgs): AnyArgs {
  const base = asObject(where);
  return { ...base, AND: [...toArray(base.AND), constraint] };
}

/**
 * Forces tenantId on a create payload. A relation-style `tenant: { connect }`
 * is dropped so Prisma doesn't reject "both tenant and tenantId".
 */
function scopeData(data: unknown, tenantId: string): AnyArgs {
  const { tenant: _dropped, ...rest } = asObject(data);
  void _dropped;
  return { ...rest, tenantId };
}

/** Rewrites Prisma call arguments so the operation is confined to `tenantId`. */
export function applyTenantScope(model: string, operation: string, args: unknown, tenantId: string): AnyArgs {
  if (!tenantId) throw new TenantScopeViolationError("tenantId is required");
  const a: AnyArgs = { ...asObject(args) };

  if (model === "Tenant") {
    if (!TENANT_MODEL_ALLOWED.has(operation)) {
      throw new TenantScopeViolationError(`Tenant.${operation} is not allowed through a tenant-scoped client`);
    }
    a.where = andWhere(a.where, { id: tenantId });
    return a;
  }

  if (!SCOPED.has(model)) return a; // future non-tenant models pass through untouched

  if (WHERE_OPS.has(operation)) a.where = andWhere(a.where, { tenantId });

  if (CREATE_OPS.has(operation)) {
    const d = a.data;
    a.data = Array.isArray(d) ? d.map((row) => scopeData(row, tenantId)) : scopeData(d, tenantId);
  }

  if (operation === "upsert") a.create = scopeData(a.create, tenantId);

  return a;
}
