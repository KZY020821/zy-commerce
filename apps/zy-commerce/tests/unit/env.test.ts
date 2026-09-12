/**
 * Environment validation fails fast and names the variable, so a deployment
 * missing a secret breaks at the first request with a readable message rather
 * than somewhere deep inside a query.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "AUTH_SECRET", "NEXT_PUBLIC_ROOT_DOMAIN"] as const;

/** Fresh module each time: env() caches its first successful read. */
async function loadEnv() {
  vi.resetModules();
  return import("@/lib/env");
}

beforeEach(() => {
  for (const key of KEYS) vi.stubEnv(key, "");
  vi.stubEnv("AUTH_SECRET", "a-perfectly-long-test-secret");
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost:3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env()", () => {
  it("returns the parsed configuration when everything required is present", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://zy:zy@localhost:5432/zy");
    const { env } = await loadEnv();
    expect(env()).toMatchObject({ DATABASE_URL: "postgresql://zy:zy@localhost:5432/zy", NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" });
  });

  it("accepts the variable names the Vercel ↔ Supabase integration injects", async () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", "postgresql://u:p@db.example:6543/postgres");
    const { env } = await loadEnv();
    expect(env().POSTGRES_PRISMA_URL).toBe("postgresql://u:p@db.example:6543/postgres");
  });

  it("names a missing database URL, treating blank values as missing", async () => {
    const { env } = await loadEnv();
    expect(() => env()).toThrow(/set DATABASE_URL \(or POSTGRES_PRISMA_URL \/ POSTGRES_URL\)/);
  });

  it("rejects an AUTH_SECRET too short to be safe", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://zy:zy@localhost:5432/zy");
    vi.stubEnv("AUTH_SECRET", "short");
    const { env } = await loadEnv();
    expect(() => env()).toThrow(/AUTH_SECRET: AUTH_SECRET must be at least 16 characters/);
  });

  it("reads the environment once and serves the cached result after", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://zy:zy@localhost:5432/first");
    const { env } = await loadEnv();
    const first = env();
    vi.stubEnv("DATABASE_URL", "postgresql://zy:zy@localhost:5432/second");
    expect(env()).toBe(first);
  });

  it("reports production only when NODE_ENV says so", async () => {
    const { isProduction } = await loadEnv();
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(isProduction()).toBe(false);
  });
});
