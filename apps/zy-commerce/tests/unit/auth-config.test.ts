/**
 * Credentials sign-in, run through the real `authorize` with the database and
 * password check replaced. Every rule here is a way someone could otherwise
 * sign in to the wrong place: the wrong store, the wrong kind of account, or
 * by guessing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return {
    default: vi.fn(() => ({ handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })),
    AuthError,
    CredentialsSignin,
  };
});
vi.mock("next-auth/providers/credentials", () => ({ default: (options: Record<string, unknown>) => ({ id: "credentials", type: "credentials", ...options }) }));
vi.mock("@/lib/db/prisma", () => ({
  unscopedDb: { user: { findFirst: vi.fn(), findUnique: vi.fn() }, tenant: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: vi.fn() }));

import { CredentialsSignin } from "next-auth";
import { authConfig, InvalidCredentialsError, RateLimitedError } from "@/lib/auth/index";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimitStore } from "@/lib/auth/rate-limit";
import { unscopedDb } from "@/lib/db/prisma";

type Authorize = (raw: unknown, request: Request) => Promise<unknown>;
const authorize = (authConfig.providers[0] as unknown as { authorize: Authorize }).authorize;

const db = vi.mocked(unscopedDb, { deep: true });
const verify = vi.mocked(verifyPassword);

function loginRequest(host: string, ip = "203.0.113.7") {
  return new Request(`http://${host}/api/auth/callback/credentials`, { method: "POST", headers: { host, "x-forwarded-for": ip } });
}

const storeAdmin = { id: "u1", email: "admin@acme.test", name: "Acme Admin", role: "STORE_ADMIN", tenantId: "t-acme", passwordHash: "hash" };
const superAdmin = { id: "u0", email: "owner@example.com", name: "Owner", role: "SUPER_ADMIN", tenantId: null, passwordHash: "hash" };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost:3000");
  vi.stubEnv("TENANT_HOST_ALIASES", "");
  rateLimitStore.reset();
  vi.clearAllMocks();
  db.tenant.findUnique.mockResolvedValue({ id: "t-acme", status: "ACTIVE" } as never);
  db.user.findUnique.mockResolvedValue(storeAdmin as never);
  db.user.findFirst.mockResolvedValue(superAdmin as never);
  verify.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authorize — where you may sign in", () => {
  it("signs a store admin in on their own store, looking them up only within it", async () => {
    const user = await authorize({ email: "Admin@Acme.test", password: "correct horse", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"));
    expect(user).toEqual({ id: "u1", email: "admin@acme.test", name: "Acme Admin", role: "STORE_ADMIN", tenantId: "t-acme" });
    expect(db.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "acme" } }));
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_email: { tenantId: "t-acme", email: "admin@acme.test" } } }));
  });

  it("signs a super admin in only on the platform root", async () => {
    const user = await authorize({ email: "owner@example.com", password: "correct horse", role: "SUPER_ADMIN" }, loginRequest("localhost:3000"));
    expect(user).toMatchObject({ id: "u0", role: "SUPER_ADMIN", tenantId: null });
    expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: null, email: "owner@example.com", role: "SUPER_ADMIN" } }));

    await expect(authorize({ email: "owner@example.com", password: "correct horse", role: "SUPER_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("refuses a store login on the platform root", async () => {
    await expect(authorize({ email: "admin@acme.test", password: "correct horse", role: "STORE_ADMIN" }, loginRequest("localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses every login on an unknown or suspended store", async () => {
    db.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(authorize({ email: "admin@acme.test", password: "correct horse", role: "STORE_ADMIN" }, loginRequest("ghost.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);

    db.tenant.findUnique.mockResolvedValueOnce({ id: "t-acme", status: "SUSPENDED" } as never);
    await expect(authorize({ email: "admin@acme.test", password: "correct horse", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("authorize — what counts as the right account", () => {
  it("rejects malformed input before touching the database", async () => {
    for (const raw of [{ email: "not-an-email", password: "x", role: "STORE_ADMIN" }, { email: "a@b.test", password: "", role: "STORE_ADMIN" }, { email: "a@b.test", password: "x", role: "OWNER" }, null]) {
      await expect(authorize(raw, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("always runs the password check, even when the account does not exist", async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    verify.mockResolvedValueOnce(false);
    await expect(authorize({ email: "nobody@acme.test", password: "guess", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(verify).toHaveBeenCalledWith("guess", undefined);
  });

  it("rejects a wrong password", async () => {
    verify.mockResolvedValueOnce(false);
    await expect(authorize({ email: "admin@acme.test", password: "wrong", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects the right password for the wrong kind of account", async () => {
    db.user.findUnique.mockResolvedValueOnce({ ...storeAdmin, role: "CUSTOMER" } as never);
    await expect(authorize({ email: "admin@acme.test", password: "correct horse", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("authorize — guessing is rate-limited", () => {
  it("locks one account out after 5 attempts from the same address", async () => {
    verify.mockResolvedValue(false);
    const attempt = () => authorize({ email: "admin@acme.test", password: "guess", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"));
    for (let i = 0; i < 5; i++) await expect(attempt()).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(attempt()).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("locks an address out after 30 attempts across accounts", async () => {
    verify.mockResolvedValue(false);
    for (let i = 0; i < 30; i++) {
      await expect(authorize({ email: `user${i}@acme.test`, password: "guess", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(authorize({ email: "fresh@acme.test", password: "guess", role: "STORE_ADMIN" }, loginRequest("acme.localhost:3000"))).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("reports rate limiting with its own code, which the login form turns into a message", () => {
    expect(new RateLimitedError().code).toBe("rate_limited");
    expect(new InvalidCredentialsError().code).toBe("invalid_credentials");
  });
});

describe("session callbacks", () => {
  const callbacks = authConfig.callbacks as unknown as {
    jwt: (args: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Record<string, unknown>;
    session: (args: { session: { user: Record<string, unknown> }; token: Record<string, unknown> }) => { user: Record<string, unknown> };
  };

  it("copies the user's id, role and store into the token at sign-in, and leaves it alone after", () => {
    const token = callbacks.jwt({ token: {}, user: { id: "u1", role: "STORE_ADMIN", tenantId: "t-acme" } });
    expect(token).toEqual({ uid: "u1", role: "STORE_ADMIN", tenantId: "t-acme" });
    expect(callbacks.jwt({ token: { uid: "u1", role: "STORE_ADMIN", tenantId: "t-acme" } })).toEqual({ uid: "u1", role: "STORE_ADMIN", tenantId: "t-acme" });
    expect(callbacks.jwt({ token: {}, user: { id: "u0", role: "SUPER_ADMIN" } }).tenantId).toBeNull();
  });

  it("exposes those claims on the session", () => {
    const session = callbacks.session({ session: { user: { email: "admin@acme.test" } }, token: { uid: "u1", role: "STORE_ADMIN", tenantId: "t-acme" } });
    expect(session.user).toEqual({ email: "admin@acme.test", id: "u1", role: "STORE_ADMIN", tenantId: "t-acme" });
    expect(callbacks.session({ session: { user: {} }, token: {} }).user).toEqual({ tenantId: null });
  });
});

describe("auth logger", () => {
  it("keeps failed logins out of the error log but still reports real errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = authConfig.logger as { error: (error: Error) => void };
    logger.error(new CredentialsSignin());
    expect(spy).not.toHaveBeenCalled();
    logger.error(new Error("database unreachable"));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
