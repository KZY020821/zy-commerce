/**
 * Which store a request is for, derived from the Host header and nothing the
 * client can set directly, plus the refusal to hand out a database client for
 * a suspended store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/db/prisma", () => ({ unscopedDb: { tenant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/db/tenant-client", () => ({ createTenantDb: vi.fn((tenantId: string) => ({ scopedTo: tenantId })) }));

import { headers } from "next/headers";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantDb } from "@/lib/db/tenant-client";
import { getCurrentTenant, getCurrentTenantSlug, getTenantDb, requireCurrentTenant, TenantSuspendedError } from "@/lib/tenant/current";

const findTenant = vi.mocked(unscopedDb.tenant.findUnique);
const requestFor = (init: Record<string, string>) => vi.mocked(headers).mockResolvedValue(new Headers(init) as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost:3000");
  vi.stubEnv("TENANT_HOST_ALIASES", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getCurrentTenantSlug", () => {
  it("reads the store from the host, preferring the forwarded host", async () => {
    requestFor({ host: "acme.localhost:3000" });
    expect(await getCurrentTenantSlug()).toBe("acme");
    requestFor({ host: "localhost:3000", "x-forwarded-host": "beta.localhost:3000" });
    expect(await getCurrentTenantSlug()).toBe("beta");
  });

  it("is null on the platform root, and ignores a tenant header the client made up", async () => {
    requestFor({ host: "localhost:3000", "x-tenant-slug": "acme" });
    expect(await getCurrentTenantSlug()).toBeNull();
  });
});

describe("getCurrentTenant and requireCurrentTenant", () => {
  it("does not query the database on the platform root", async () => {
    requestFor({ host: "localhost:3000" });
    expect(await getCurrentTenant()).toBeNull();
    expect(findTenant).not.toHaveBeenCalled();
  });

  it("looks the store up by its slug", async () => {
    requestFor({ host: "acme.localhost:3000" });
    findTenant.mockResolvedValue({ id: "t-acme", slug: "acme", status: "ACTIVE" } as never);
    expect(await getCurrentTenant()).toMatchObject({ id: "t-acme" });
    expect(findTenant).toHaveBeenCalledWith({ where: { slug: "acme" } });
  });

  it("answers 404 for a store that does not exist", async () => {
    requestFor({ host: "ghost.localhost:3000" });
    findTenant.mockResolvedValue(null);
    await expect(requireCurrentTenant()).rejects.toThrow("NOT_FOUND");
  });
});

describe("getTenantDb", () => {
  it("hands out a client scoped to the active store", async () => {
    requestFor({ host: "acme.localhost:3000" });
    findTenant.mockResolvedValue({ id: "t-acme", slug: "acme", status: "ACTIVE" } as never);
    expect(await getTenantDb()).toEqual({ scopedTo: "t-acme" });
    expect(createTenantDb).toHaveBeenCalledWith("t-acme");
  });

  it("refuses a suspended store", async () => {
    requestFor({ host: "acme.localhost:3000" });
    findTenant.mockResolvedValue({ id: "t-acme", slug: "acme", status: "SUSPENDED" } as never);
    await expect(getTenantDb()).rejects.toBeInstanceOf(TenantSuspendedError);
    await expect(getTenantDb()).rejects.toThrow('Tenant "acme" is suspended');
    expect(createTenantDb).not.toHaveBeenCalled();
  });
});
