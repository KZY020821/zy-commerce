/**
 * The authorisation guards every admin page and Server Action calls. The
 * session token is only a hint: each guard re-reads the user, so a revoked
 * role or a moved account stops working immediately.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/index", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ unscopedDb: { user: { findUnique: vi.fn() } } }));
vi.mock("@/lib/tenant/current", () => ({ getCurrentTenant: vi.fn(), requireCurrentTenant: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

import { auth } from "@/lib/auth/index";
import {
  assertStoreAdmin,
  assertSuperAdmin,
  ForbiddenError,
  getCustomerUser,
  getStoreAdmin,
  getSuperAdmin,
  getVerifiedUser,
  requireStoreAdmin,
  requireSuperAdmin,
  UnauthorizedError,
} from "@/lib/auth/guards";
import { unscopedDb } from "@/lib/db/prisma";
import { getCurrentTenant, requireCurrentTenant } from "@/lib/tenant/current";

const session = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const findUser = vi.mocked(unscopedDb.user.findUnique);
const currentTenant = vi.mocked(getCurrentTenant);

const acme = { id: "t-acme", slug: "acme", status: "ACTIVE" };
const adminRow = { id: "u1", email: "admin@acme.test", name: "Admin", role: "STORE_ADMIN", tenantId: "t-acme" };

function signedInAs(row: typeof adminRow | Record<string, unknown>, claims?: { role?: string; tenantId?: string | null }) {
  const r = row as { id: string; role: string; tenantId: string | null };
  session.mockResolvedValue({ user: { id: r.id, role: claims?.role ?? r.role, tenantId: claims && "tenantId" in claims ? claims.tenantId : r.tenantId } });
  findUser.mockResolvedValue(row as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue(null);
  findUser.mockResolvedValue(null);
  currentTenant.mockResolvedValue(acme as never);
  vi.mocked(requireCurrentTenant).mockResolvedValue(acme as never);
});

describe("getVerifiedUser", () => {
  it("is null when signed out, or when the session names no user", async () => {
    expect(await getVerifiedUser()).toBeNull();
    session.mockResolvedValue({ user: {} });
    expect(await getVerifiedUser()).toBeNull();
    expect(findUser).not.toHaveBeenCalled();
  });

  it("is null when the account no longer exists", async () => {
    session.mockResolvedValue({ user: { id: "u1", role: "STORE_ADMIN", tenantId: "t-acme" } });
    expect(await getVerifiedUser()).toBeNull();
  });

  it("is null when the database disagrees with the token about role or store", async () => {
    signedInAs(adminRow, { role: "SUPER_ADMIN" });
    expect(await getVerifiedUser()).toBeNull();
    signedInAs(adminRow, { tenantId: "t-other" });
    expect(await getVerifiedUser()).toBeNull();
  });

  it("returns the database's view of the user when it matches", async () => {
    signedInAs(adminRow);
    expect(await getVerifiedUser()).toEqual(adminRow);
  });
});

describe("super admin guards", () => {
  const owner = { id: "u0", email: "owner@example.com", name: "Owner", role: "SUPER_ADMIN", tenantId: null };

  it("recognise only a super admin who belongs to no store", async () => {
    signedInAs(owner);
    expect(await getSuperAdmin()).toEqual(owner);
    signedInAs({ ...owner, tenantId: "t-acme" });
    expect(await getSuperAdmin()).toBeNull();
    signedInAs(adminRow);
    expect(await getSuperAdmin()).toBeNull();
  });

  it("send a page to the platform login, and make an action throw 403", async () => {
    await expect(requireSuperAdmin()).rejects.toThrow("REDIRECT /platform/login");
    await expect(assertSuperAdmin()).rejects.toBeInstanceOf(ForbiddenError);
    signedInAs(owner);
    await expect(requireSuperAdmin()).resolves.toEqual(owner);
    await expect(assertSuperAdmin()).resolves.toEqual(owner);
  });
});

describe("store admin guards", () => {
  it("accept only an admin of the store the request is for", async () => {
    signedInAs(adminRow);
    expect(await getStoreAdmin()).toEqual({ user: adminRow, tenant: acme });

    signedInAs({ ...adminRow, tenantId: "t-other" });
    expect(await getStoreAdmin()).toBeNull();

    signedInAs({ ...adminRow, role: "CUSTOMER" });
    expect(await getStoreAdmin()).toBeNull();
  });

  it("refuse everyone on the platform root and on a suspended store", async () => {
    signedInAs(adminRow);
    currentTenant.mockResolvedValue(null);
    expect(await getStoreAdmin()).toBeNull();
    currentTenant.mockResolvedValue({ ...acme, status: "SUSPENDED" } as never);
    expect(await getStoreAdmin()).toBeNull();
  });

  it("check the store exists before anything else, then send a page to the admin login", async () => {
    await expect(requireStoreAdmin()).rejects.toThrow("REDIRECT /admin/login");
    expect(requireCurrentTenant).toHaveBeenCalled();
    signedInAs(adminRow);
    await expect(requireStoreAdmin()).resolves.toEqual({ user: adminRow, tenant: acme });
  });

  it("make a Server Action throw 403 instead of redirecting", async () => {
    await expect(assertStoreAdmin()).rejects.toBeInstanceOf(ForbiddenError);
    signedInAs(adminRow);
    await expect(assertStoreAdmin()).resolves.toEqual({ user: adminRow, tenant: acme });
  });
});

describe("customer guard", () => {
  it("accepts only a customer of this store", async () => {
    const customer = { ...adminRow, id: "c1", role: "CUSTOMER" };
    signedInAs(customer);
    expect(await getCustomerUser()).toEqual({ user: customer, tenant: acme });
    signedInAs(adminRow);
    expect(await getCustomerUser()).toBeNull();
    signedInAs(customer);
    currentTenant.mockResolvedValue({ ...acme, status: "SUSPENDED" } as never);
    expect(await getCustomerUser()).toBeNull();
  });
});

describe("error types", () => {
  it("carry the HTTP status a route handler should answer with", () => {
    expect(new UnauthorizedError()).toMatchObject({ status: 401, message: "Authentication required", name: "UnauthorizedError" });
    expect(new ForbiddenError("Nope")).toMatchObject({ status: 403, message: "Nope", name: "ForbiddenError" });
  });
});
