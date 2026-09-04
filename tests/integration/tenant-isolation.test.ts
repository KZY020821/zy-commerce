/**
 * Spec §4 / §10 — the non-optional tenant-isolation proof.
 *
 * Two tenants (alpha, beta) each get one row in every tenant-scoped table.
 * A client scoped to alpha must never observe, modify or delete beta's rows
 * through any Prisma operation, and must never be able to write a row that
 * belongs to beta.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantDb, TENANT_SCOPED_MODELS, TenantScopeViolationError, type TenantDb } from "@/lib/db/tenant-client";
import { createTenantFixture, delegateName, resetDatabase, type TenantFixture } from "./helpers";

type AnyDelegate = {
  findMany: (args?: unknown) => Promise<Array<{ id: string; tenantId: string | null }>>;
  count: (args?: unknown) => Promise<number>;
};

let A: TenantFixture;
let B: TenantFixture;
let dbA: TenantDb;
let dbB: TenantDb;

beforeAll(async () => {
  await resetDatabase();
  A = await createTenantFixture("alpha", "Alpha");
  B = await createTenantFixture("beta", "Beta");
  dbA = createTenantDb(A.tenant.id);
  dbB = createTenantDb(B.tenant.id);
});

afterAll(async () => {
  await unscopedDb.$disconnect();
});

describe("sanity", () => {
  it("the unscoped client sees both tenants (so the tests below are meaningful)", async () => {
    expect(await unscopedDb.product.count()).toBe(2);
    expect(await unscopedDb.order.count()).toBe(2);
    expect(await unscopedDb.tenant.count()).toBe(2);
  });
});

describe("reads never cross tenants", () => {
  it.each(TENANT_SCOPED_MODELS)("%s.findMany / count return only tenant A rows", async (model) => {
    const delegate = (dbA as unknown as Record<string, AnyDelegate>)[delegateName(model)]!;
    const rows = await delegate.findMany();
    expect(rows.length, `${model} should have fixture rows`).toBeGreaterThan(0);
    for (const row of rows) expect(row.tenantId, `${model} ${row.id}`).toBe(A.tenant.id);
    expect(await delegate.count()).toBe(rows.length);
    expect(await delegate.count()).toBeLessThan(await (unscopedDb as unknown as Record<string, AnyDelegate>)[delegateName(model)]!.count());
  });

  it("findUnique by another tenant's id returns null", async () => {
    expect(await dbA.product.findUnique({ where: { id: B.product.id } })).toBeNull();
    expect(await dbA.order.findUnique({ where: { id: B.order.id } })).toBeNull();
    expect(await dbA.customer.findUnique({ where: { id: B.customer.id } })).toBeNull();
    expect(await dbA.user.findUnique({ where: { id: B.adminUser.id } })).toBeNull();
  });

  it("findUniqueOrThrow / findFirstOrThrow reject for another tenant's row", async () => {
    await expect(dbA.product.findUniqueOrThrow({ where: { id: B.product.id } })).rejects.toMatchObject({ code: "P2025" });
    await expect(dbA.order.findFirstOrThrow({ where: { id: B.order.id } })).rejects.toMatchObject({ code: "P2025" });
  });

  it("unique lookups by natural keys stay scoped (sku, slug, sessionToken, paymentIntent)", async () => {
    expect(await dbA.product.findUnique({ where: { tenantId_sku: { tenantId: B.tenant.id, sku: B.product.sku } } })).toBeNull();
    expect(await dbA.cart.findUnique({ where: { sessionToken: B.cart.sessionToken! } })).toBeNull();
    expect(await dbA.payment.findUnique({ where: { stripePaymentIntentId: B.payment.stripePaymentIntentId! } })).toBeNull();
    expect(await dbA.cart.findUnique({ where: { sessionToken: A.cart.sessionToken! } })).not.toBeNull();
  });

  it("admin list views with search/filter only see their tenant", async () => {
    const search = await dbA.product.findMany({ where: { name: { contains: "Widget", mode: "insensitive" } } });
    expect(search.map((p) => p.id)).toEqual([A.product.id]);

    const byStatus = await dbA.order.findMany({ where: { status: "PAID" }, orderBy: { createdAt: "desc" } });
    expect(byStatus.map((o) => o.id)).toEqual([A.order.id]);

    const byCategory = await dbA.product.findMany({ where: { category: { slug: "widgets" } } });
    expect(byCategory.map((p) => p.id)).toEqual([A.product.id]);
  });

  it("guest order lookup by orderNumber + email is scoped (both tenants have order #1)", async () => {
    const found = await dbA.order.findFirst({ where: { orderNumber: 1, customerEmail: B.customer.email } });
    expect(found).toBeNull();
    const own = await dbA.order.findFirst({ where: { orderNumber: 1, customerEmail: A.customer.email } });
    expect(own?.id).toBe(A.order.id);
  });

  it("an explicit foreign tenantId filter matches nothing", async () => {
    expect(await dbA.product.findMany({ where: { tenantId: B.tenant.id } })).toEqual([]);
    expect(await dbA.product.count({ where: { tenantId: B.tenant.id } })).toBe(0);
  });

  it("OR / NOT / relation filters cannot escape the tenant", async () => {
    expect(await dbA.product.findMany({ where: { OR: [{ tenantId: B.tenant.id }, { id: B.product.id }] } })).toEqual([]);
    expect(await dbA.product.findMany({ where: { NOT: { tenantId: A.tenant.id } } })).toEqual([]);
    expect(await dbA.product.findMany({ where: { tenant: { slug: "beta" } } })).toEqual([]);
  });

  it("includes only traverse into the same tenant", async () => {
    const orders = await dbA.order.findMany({ include: { items: true, customer: true, statusEvents: true, payments: true, shippingAddress: true } });
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o.customer.tenantId).toBe(A.tenant.id);
    for (const i of o.items) expect(i.tenantId).toBe(A.tenant.id);
    for (const e of o.statusEvents) expect(e.tenantId).toBe(A.tenant.id);
    for (const p of o.payments) expect(p.tenantId).toBe(A.tenant.id);
    expect(o.shippingAddress?.tenantId).toBe(A.tenant.id);
  });

  it("aggregate and groupBy are scoped", async () => {
    const agg = await dbA.order.aggregate({ _sum: { total: true }, _count: true });
    expect(agg._sum.total).toBe(A.order.total);
    expect(agg._count).toBe(1);

    const grouped = await dbA.order.groupBy({ by: ["status"], _count: { _all: true } });
    expect(grouped).toEqual([{ status: "PAID", _count: { _all: 1 } }]);
  });

  it("super admins (tenantId NULL) are invisible to a tenant client", async () => {
    await unscopedDb.user.create({ data: { tenantId: null, email: "owner@platform.test", passwordHash: "x", role: "SUPER_ADMIN" } });
    const users = await dbA.user.findMany();
    expect(users.every((u) => u.tenantId === A.tenant.id)).toBe(true);
    expect(await dbA.user.findFirst({ where: { role: "SUPER_ADMIN" } })).toBeNull();
  });

  it("interactive transactions inherit the scope", async () => {
    const [products, orders] = await dbA.$transaction(async (tx) => [await tx.product.findMany(), await tx.order.findMany()]);
    expect(products.map((p) => p.id)).toEqual([A.product.id]);
    expect(orders.map((o) => o.id)).toEqual([A.order.id]);
  });
});

describe("writes never cross tenants", () => {
  it("update by another tenant's id fails and leaves the row untouched", async () => {
    await expect(dbA.product.update({ where: { id: B.product.id }, data: { name: "HACKED" } })).rejects.toMatchObject({ code: "P2025" });
    const fresh = await unscopedDb.product.findUniqueOrThrow({ where: { id: B.product.id } });
    expect(fresh.name).toBe(B.product.name);
  });

  it("delete by another tenant's id fails and the row survives", async () => {
    await expect(dbA.orderStatusEvent.delete({ where: { id: B.statusEvent.id } })).rejects.toMatchObject({ code: "P2025" });
    expect(await unscopedDb.orderStatusEvent.findUnique({ where: { id: B.statusEvent.id } })).not.toBeNull();
  });

  it("updateMany / deleteMany with no filter only touch the caller's tenant", async () => {
    const updated = await dbA.product.updateMany({ data: { lowStockThreshold: 99 } });
    expect(updated.count).toBe(1);
    expect((await unscopedDb.product.findUniqueOrThrow({ where: { id: B.product.id } })).lowStockThreshold).toBe(5);

    const extra = await unscopedDb.productImage.create({ data: { tenantId: A.tenant.id, productId: A.product.id, url: "https://img.test/extra.png" } });
    const deleted = await dbA.productImage.deleteMany({ where: { id: { in: [extra.id, B.image.id] } } });
    expect(deleted.count).toBe(1);
    expect(await unscopedDb.productImage.findUnique({ where: { id: B.image.id } })).not.toBeNull();
  });

  it("create forces tenantId even when the caller supplies another tenant", async () => {
    const cat = await dbA.category.create({ data: { tenantId: B.tenant.id, name: "Sneaky", slug: "sneaky" } });
    expect(cat.tenantId).toBe(A.tenant.id);

    const cat2 = await dbA.category.create({ data: { tenant: { connect: { id: B.tenant.id } }, name: "Sneaky 2", slug: "sneaky-2" } });
    expect(cat2.tenantId).toBe(A.tenant.id);
  });

  it("createMany forces tenantId on every row", async () => {
    await dbA.category.createMany({
      data: [
        { tenantId: B.tenant.id, name: "Bulk 1", slug: "bulk-1" },
        { tenantId: B.tenant.id, name: "Bulk 2", slug: "bulk-2" },
      ],
    });
    const bulk = await unscopedDb.category.findMany({ where: { slug: { startsWith: "bulk-" } } });
    expect(bulk).toHaveLength(2);
    expect(bulk.every((c) => c.tenantId === A.tenant.id)).toBe(true);
  });

  it("upsert creates under the caller's tenant and cannot update another tenant's row", async () => {
    const created = await dbA.category.upsert({
      where: { id: B.category.id },
      create: { tenantId: B.tenant.id, name: "Upserted", slug: "upserted" },
      update: { name: "HACKED" },
    });
    expect(created.tenantId).toBe(A.tenant.id);
    expect(created.name).toBe("Upserted");
    expect((await unscopedDb.category.findUniqueOrThrow({ where: { id: B.category.id } })).name).toBe("Widgets");
  });

  it("tenant B still has exactly its original rows after all of A's writes", async () => {
    for (const model of TENANT_SCOPED_MODELS) {
      const delegate = (dbB as unknown as Record<string, AnyDelegate>)[delegateName(model)]!;
      const rows = await delegate.findMany();
      expect(rows.every((r) => r.tenantId === B.tenant.id), model).toBe(true);
    }
    expect(await dbB.category.count()).toBe(1);
    expect(await dbB.product.findMany()).toHaveLength(1);
  });
});

describe("Tenant model through a scoped client", () => {
  it("only ever returns the current tenant", async () => {
    const all = await dbA.tenant.findMany();
    expect(all.map((t) => t.id)).toEqual([A.tenant.id]);
    expect(await dbA.tenant.findUnique({ where: { slug: "beta" } })).toBeNull();
    expect(await dbA.tenant.findFirst({ where: { id: B.tenant.id } })).toBeNull();
    expect(await dbA.tenant.count()).toBe(1);
  });

  it("can update its own settings but not another tenant's", async () => {
    const updated = await dbA.tenant.update({ where: { id: A.tenant.id }, data: { name: "Alpha Renamed" } });
    expect(updated.name).toBe("Alpha Renamed");
    await expect(dbA.tenant.update({ where: { id: B.tenant.id }, data: { name: "HACKED" } })).rejects.toMatchObject({ code: "P2025" });
    expect((await unscopedDb.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } })).name).toBe("Beta");
  });

  it("refuses to create or delete tenants", async () => {
    await expect(dbA.tenant.create({ data: { slug: "gamma", name: "Gamma" } })).rejects.toBeInstanceOf(TenantScopeViolationError);
    await expect(dbA.tenant.delete({ where: { id: A.tenant.id } })).rejects.toBeInstanceOf(TenantScopeViolationError);
    await expect(dbA.tenant.deleteMany()).rejects.toBeInstanceOf(TenantScopeViolationError);
    expect(await unscopedDb.tenant.count()).toBe(2);
  });
});

describe("constructor guards", () => {
  it("refuses an empty tenant id", () => {
    expect(() => createTenantDb("")).toThrow(TenantScopeViolationError);
  });
});
