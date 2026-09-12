import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolveDirectDatabaseUrl } from "./src/lib/db/connection";

/**
 * The Prisma CLI (migrate, db seed, studio) must use a DIRECT / session-mode
 * connection, never the transaction pooler. `resolveDirectDatabaseUrl` picks
 * DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL.
 *
 * With no URL at all the datasource is left out rather than filled from
 * `env("DATABASE_URL")`: in Prisma 7 that helper throws as soon as the config
 * loads, which broke `prisma generate` — and so `pnpm install`, whose
 * postinstall runs it — on any machine or CI job without a database. Generating
 * the client needs no connection; `migrate` without one still stops with
 * Prisma's own message that a datasource URL is required.
 */
const url = resolveDirectDatabaseUrl();
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(url ? { datasource: { url } } : {}),
});
