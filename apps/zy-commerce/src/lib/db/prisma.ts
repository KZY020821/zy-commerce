/**
 * The UNSCOPED Prisma client. It can see every tenant's rows.
 *
 * Only these places may import it directly:
 *   - src/lib/tenant/*         (resolving the current tenant)
 *   - src/lib/auth/*           (login, session verification)
 *   - super-admin code under   src/app/(root)/platform
 *   - webhooks that must look up the tenant from event metadata
 *   - prisma/seed.ts and tests
 *
 * Everything else must use the tenant-scoped client from
 * `src/lib/tenant/current.ts` → `getTenantDb()`.
 *
 * The client is created lazily on first use so that importing this module
 * (e.g. from a unit test or during `next build`) never requires a database URL.
 * The runtime uses the POOLED connection (see ./connection.ts).
 */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildPoolSettings, resolveRuntimeDatabaseUrl } from "./connection";

function createClient(): PrismaClient {
  const connectionString = resolveRuntimeDatabaseUrl();
  if (!connectionString) throw new Error("No database URL set (DATABASE_URL, POSTGRES_PRISMA_URL or POSTGRES_URL)");
  const settings = buildPoolSettings(connectionString);
  const adapter = new PrismaPg({ connectionString: settings.connectionString, ssl: settings.ssl, max: settings.max });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const g = globalThis as unknown as { __zyUnscopedDb?: PrismaClient };

function getClient(): PrismaClient {
  if (!g.__zyUnscopedDb) g.__zyUnscopedDb = createClient();
  return g.__zyUnscopedDb;
}

/** Lazy handle: behaves exactly like a PrismaClient, instantiated on first access. */
export const unscopedDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type UnscopedDb = PrismaClient;
