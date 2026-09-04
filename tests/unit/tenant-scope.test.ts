import { describe, expect, it } from "vitest";
import { applyTenantScope, TENANT_SCOPED_MODELS, TenantScopeViolationError } from "@/lib/db/tenant-scope";

const T = "tenant_A";
const OTHER = "tenant_B";
const SCOPE = { AND: [{ tenantId: T }] };

describe("applyTenantScope — scoped models", () => {
  it("adds an AND tenantId constraint to reads with no args", () => {
    expect(applyTenantScope("Product", "findMany", undefined, T)).toEqual({ where: SCOPE });
    expect(applyTenantScope("Product", "count", {}, T)).toEqual({ where: SCOPE });
  });

  it("keeps the caller's where intact and appends the constraint (a foreign tenantId can then match nothing)", () => {
    const out = applyTenantScope("Product", "findMany", { where: { active: true, tenantId: OTHER }, take: 5 }, T);
    expect(out).toEqual({ where: { active: true, tenantId: OTHER, AND: [{ tenantId: T }] }, take: 5 });
  });

  it("appends to an existing AND array and normalises an AND object", () => {
    expect(applyTenantScope("Product", "findMany", { where: { AND: [{ active: true }] } }, T).where).toEqual({ AND: [{ active: true }, { tenantId: T }] });
    expect(applyTenantScope("Product", "findMany", { where: { AND: { active: true } } }, T).where).toEqual({ AND: [{ active: true }, { tenantId: T }] });
  });

  it("leaves OR/NOT alone — the top-level AND still applies", () => {
    const out = applyTenantScope("Order", "findFirst", { where: { OR: [{ tenantId: OTHER }, { orderNumber: 1 }] } }, T);
    expect(out.where).toEqual({ OR: [{ tenantId: OTHER }, { orderNumber: 1 }], AND: [{ tenantId: T }] });
  });

  it("keeps top-level unique keys for unique lookups and single-row writes", () => {
    expect(applyTenantScope("Product", "findUnique", { where: { id: "p1" } }, T).where).toEqual({ id: "p1", ...SCOPE });
    expect(applyTenantScope("Product", "update", { where: { id: "p1" }, data: { name: "x" } }, T)).toEqual({ where: { id: "p1", ...SCOPE }, data: { name: "x" } });
    expect(applyTenantScope("Product", "delete", { where: { id: "p1" } }, T).where).toEqual({ id: "p1", ...SCOPE });
  });

  it.each(["updateMany", "updateManyAndReturn", "deleteMany", "aggregate", "groupBy", "findFirstOrThrow", "findUniqueOrThrow"])(
    "scopes %s",
    (op) => {
      expect(applyTenantScope("Customer", op, { where: { email: "a@b.c" } }, T).where).toEqual({ email: "a@b.c", ...SCOPE });
    },
  );

  it("forces tenantId on create, overriding a foreign one", () => {
    const out = applyTenantScope("Category", "create", { data: { name: "n", slug: "s", tenantId: OTHER } }, T);
    expect(out.data).toEqual({ name: "n", slug: "s", tenantId: T });
  });

  it("drops a relation-style tenant connect on create", () => {
    const out = applyTenantScope("Category", "create", { data: { name: "n", slug: "s", tenant: { connect: { id: OTHER } } } }, T);
    expect(out.data).toEqual({ name: "n", slug: "s", tenantId: T });
  });

  it("forces tenantId on every createMany row", () => {
    const out = applyTenantScope("Product", "createMany", { data: [{ sku: "a", tenantId: OTHER }, { sku: "b" }] }, T);
    expect(out.data).toEqual([
      { sku: "a", tenantId: T },
      { sku: "b", tenantId: T },
    ]);
  });

  it("handles createMany with a single object payload", () => {
    const out = applyTenantScope("Product", "createManyAndReturn", { data: { sku: "a" } }, T);
    expect(out.data).toEqual({ sku: "a", tenantId: T });
  });

  it("scopes upsert where and create, leaves update alone", () => {
    const out = applyTenantScope("Product", "upsert", { where: { id: "p1" }, create: { sku: "a", tenantId: OTHER }, update: { name: "z" } }, T);
    expect(out).toEqual({ where: { id: "p1", ...SCOPE }, create: { sku: "a", tenantId: T }, update: { name: "z" } });
  });

  it("does not mutate the caller's args", () => {
    const args = { where: { id: "p1", AND: [{ active: true }] }, data: { name: "x" } };
    const snapshot = structuredClone(args);
    applyTenantScope("Product", "update", args, T);
    expect(args).toEqual(snapshot);
  });

  it("covers every scoped model the same way", () => {
    for (const model of TENANT_SCOPED_MODELS) {
      expect(applyTenantScope(model, "findMany", undefined, T).where, model).toEqual(SCOPE);
      expect((applyTenantScope(model, "create", { data: {} }, T).data as { tenantId: string }).tenantId, model).toBe(T);
    }
  });
});

describe("applyTenantScope — Tenant model", () => {
  const PIN = { AND: [{ id: T }] };

  it("pins reads and updates to the current tenant id", () => {
    expect(applyTenantScope("Tenant", "findMany", undefined, T).where).toEqual(PIN);
    expect(applyTenantScope("Tenant", "findUnique", { where: { slug: "beta" } }, T).where).toEqual({ slug: "beta", ...PIN });
    expect(applyTenantScope("Tenant", "findFirst", { where: { id: OTHER } }, T).where).toEqual({ id: OTHER, ...PIN });
    expect(applyTenantScope("Tenant", "update", { where: { id: OTHER }, data: { name: "x" } }, T).where).toEqual({ id: OTHER, ...PIN });
  });

  it.each(["create", "createMany", "delete", "deleteMany", "updateMany", "upsert", "groupBy"])("refuses Tenant.%s", (op) => {
    expect(() => applyTenantScope("Tenant", op, {}, T)).toThrow(TenantScopeViolationError);
  });
});

describe("applyTenantScope — guards", () => {
  it("refuses an empty tenantId", () => {
    expect(() => applyTenantScope("Product", "findMany", {}, "")).toThrow(TenantScopeViolationError);
  });
  it("passes unknown (non-tenant) models through untouched", () => {
    expect(applyTenantScope("SomeFutureGlobalModel", "findMany", { where: { x: 1 } }, T)).toEqual({ where: { x: 1 } });
  });
});
