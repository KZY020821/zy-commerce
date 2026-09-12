/**
 * A throwaway store for the end-to-end suite.
 *
 *   tsx tests/e2e/fixture-store.ts create    → prints the new store as JSON
 *   tsx tests/e2e/fixture-store.ts destroy   → removes every e2e store and its files
 *
 * Run through tsx by global-setup.ts and global-teardown.ts — the same loader
 * prisma/seed.ts uses — so the generated Prisma client loads exactly as it does
 * in the scripts that run in production builds.
 *
 * Two rules keep it safe:
 *   - the slug prefix "e2e-" is reserved for this, and `create` first deletes
 *     anything left under it by an earlier run that crashed;
 *   - it refuses to touch any database that is not on this machine, so it can
 *     never write test data into the live database.
 */
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { del, list } from "@vercel/blob";
import { PrismaClient } from "../../src/generated/prisma/client";
import { hashPassword } from "../../src/lib/auth/password";
import { buildPoolSettings, resolveRuntimeDatabaseUrl } from "../../src/lib/db/connection";

const PREFIX = "e2e-";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function connect(): PrismaClient {
  const url = resolveRuntimeDatabaseUrl();
  if (!url) throw new Error("The end-to-end suite needs DATABASE_URL: the database the app server under test uses.");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to create or delete test stores in a database that is not local (${host}).`);
  const pool = buildPoolSettings(url);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: pool.connectionString, ssl: pool.ssl, max: 2 }) });
}

const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim() || (process.env.VERCEL_OIDC_TOKEN?.trim() && process.env.BLOB_STORE_ID?.trim()));

/** Deletes every file a store uploaded. Returns how many were removed. */
async function removeStoreFiles(tenantId: string): Promise<number> {
  if (!blobConfigured()) return 0;
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `tenants/${tenantId}/`, cursor });
    if (page.blobs.length) {
      await del(page.blobs.map((blob) => blob.url));
      removed += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

async function destroyAll(db: PrismaClient): Promise<{ stores: number; files: number }> {
  const stores = await db.tenant.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  let files = 0;
  for (const store of stores) files += await removeStoreFiles(store.id);
  const ids = stores.map((s) => s.id);
  await db.chatConversation.deleteMany({ where: { tenantId: { in: ids } } });
  await db.user.deleteMany({ where: { tenantId: { in: ids } } });
  await db.tenant.deleteMany({ where: { id: { in: ids } } });
  return { stores: stores.length, files };
}

async function create(db: PrismaClient) {
  const leftovers = await destroyAll(db);
  const slug = `${PREFIX}${randomBytes(4).toString("hex")}`;
  const email = `admin@${slug}.test`;
  const password = randomBytes(18).toString("base64url");
  const tenant = await db.tenant.create({
    data: { slug, name: "E2E Store", status: "ACTIVE", primaryColor: "#111111", currency: "USD", country: "US", locale: "en-US" },
  });
  await db.user.create({ data: { tenantId: tenant.id, email, name: "E2E Admin", role: "STORE_ADMIN", passwordHash: await hashPassword(password) } });
  return { tenantId: tenant.id, slug, email, password, leftovers };
}

async function main() {
  const command = process.argv[2];
  if (command !== "create" && command !== "destroy") throw new Error("usage: fixture-store.ts create|destroy");
  const db = connect();
  try {
    const result = command === "create" ? await create(db) : await destroyAll(db);
    process.stdout.write(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
