import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { resolveDirectDatabaseUrl } from "./src/lib/db/connection";

/**
 * The Prisma CLI (migrate, db seed, studio) must use a DIRECT / session-mode
 * connection, never the transaction pooler. `resolveDirectDatabaseUrl` picks
 * DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL. The lazy `env()`
 * fallback keeps `prisma generate` working when no database is configured
 * (e.g. during `pnpm install`), while still failing clearly on migrate.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: resolveDirectDatabaseUrl() ?? env("DATABASE_URL"),
  },
});
