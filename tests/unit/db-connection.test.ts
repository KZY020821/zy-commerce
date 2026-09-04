import { describe, expect, it } from "vitest";
import { buildPoolSettings, resolveDirectDatabaseUrl, resolveRuntimeDatabaseUrl } from "@/lib/db/connection";

describe("database URL resolution", () => {
  it("uses DATABASE_URL for both roles locally", () => {
    const env = { DATABASE_URL: "postgresql://zy:zy@localhost:5432/zy_commerce" };
    expect(resolveRuntimeDatabaseUrl(env)).toBe(env.DATABASE_URL);
    expect(resolveDirectDatabaseUrl(env)).toBe(env.DATABASE_URL);
  });

  it("prefers the pooled URL at runtime and the direct URL for the CLI", () => {
    const env = { DATABASE_URL: "postgresql://pooled:6543/db?pgbouncer=true", DIRECT_URL: "postgresql://direct:5432/db" };
    expect(resolveRuntimeDatabaseUrl(env)).toBe(env.DATABASE_URL);
    expect(resolveDirectDatabaseUrl(env)).toBe(env.DIRECT_URL);
  });

  it("understands the Vercel ↔ Supabase integration variable names", () => {
    const env = {
      POSTGRES_URL: "postgresql://pooled:6543/db?sslmode=require",
      POSTGRES_PRISMA_URL: "postgresql://pooled:6543/db?sslmode=require&pgbouncer=true",
      POSTGRES_URL_NON_POOLING: "postgresql://direct:5432/db?sslmode=require",
    };
    expect(resolveRuntimeDatabaseUrl(env)).toBe(env.POSTGRES_PRISMA_URL);
    expect(resolveDirectDatabaseUrl(env)).toBe(env.POSTGRES_URL_NON_POOLING);
  });

  it("treats blank values as unset and returns undefined when nothing is configured", () => {
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: "  ", POSTGRES_URL: "postgresql://x" })).toBe("postgresql://x");
    expect(resolveRuntimeDatabaseUrl({})).toBeUndefined();
    expect(resolveDirectDatabaseUrl({})).toBeUndefined();
  });
});

describe("buildPoolSettings", () => {
  const base = { VERCEL: undefined, DATABASE_POOL_MAX: undefined };

  it("disables TLS for local hosts without sslmode", () => {
    expect(buildPoolSettings("postgresql://zy:zy@localhost:5432/zy", base).ssl).toBe(false);
    expect(buildPoolSettings("postgresql://zy:zy@127.0.0.1:5432/zy", base).ssl).toBe(false);
  });

  it("encrypts without verification for remote hosts without sslmode", () => {
    expect(buildPoolSettings("postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres", base).ssl).toEqual({ rejectUnauthorized: false });
  });

  it("maps sslmode like libpq", () => {
    const at = (mode: string) => buildPoolSettings(`postgresql://u:p@db.example.com:5432/postgres?sslmode=${mode}`, base).ssl;
    expect(at("disable")).toBe(false);
    expect(at("require")).toEqual({ rejectUnauthorized: false });
    expect(at("prefer")).toEqual({ rejectUnauthorized: false });
    expect(at("no-verify")).toEqual({ rejectUnauthorized: false });
    expect(at("verify-full")).toEqual({ rejectUnauthorized: true });
  });

  it("sizes the pool for serverless unless overridden", () => {
    expect(buildPoolSettings("postgresql://u:p@localhost/db", base).max).toBe(10);
    expect(buildPoolSettings("postgresql://u:p@localhost/db", { VERCEL: "1" }).max).toBe(5);
    expect(buildPoolSettings("postgresql://u:p@localhost/db", { DATABASE_POOL_MAX: "3" }).max).toBe(3);
    expect(buildPoolSettings("postgresql://u:p@localhost/db", { DATABASE_POOL_MAX: "nope" }).max).toBe(10);
  });

  it("passes the connection string through unchanged", () => {
    const url = "postgresql://u:p@host/db?pgbouncer=true&sslmode=require";
    expect(buildPoolSettings(url, base).connectionString).toBe(url);
  });
});
