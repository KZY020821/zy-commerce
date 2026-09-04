/**
 * Database connection resolution — pure, no Prisma import, so both the Prisma
 * CLI (prisma.config.ts) and the runtime client can share it.
 *
 * Two URLs (Prisma's recommended Supabase setup):
 *   runtime  → pooled connection (Supabase transaction pooler, port 6543)
 *   CLI      → direct / session connection (port 5432) for migrations & seed
 *
 * Accepted variable names, first match wins:
 *   runtime: DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL
 *   direct : DIRECT_URL, POSTGRES_URL_NON_POOLING, DATABASE_URL
 * The POSTGRES_* names are what the Vercel ↔ Supabase integration injects, so
 * a project wired through the Vercel Marketplace needs no manual mapping.
 * Locally (docker-compose) only DATABASE_URL is set and serves both roles.
 */

type EnvLike = Record<string, string | undefined>;

const RUNTIME_KEYS = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"] as const;
const DIRECT_KEYS = ["DIRECT_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL"] as const;

function firstDefined(env: EnvLike, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function resolveRuntimeDatabaseUrl(env: EnvLike = process.env): string | undefined {
  return firstDefined(env, RUNTIME_KEYS);
}

export function resolveDirectDatabaseUrl(env: EnvLike = process.env): string | undefined {
  return firstDefined(env, DIRECT_KEYS);
}

export interface SslSetting {
  rejectUnauthorized: boolean;
}

export interface PoolSettings {
  connectionString: string;
  ssl: SslSetting | false;
  max: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);

/**
 * Derives node-postgres pool settings from a connection URL.
 *
 * SSL policy (libpq-compatible, explicit about the trade-off):
 *   sslmode=disable               → no TLS
 *   sslmode=verify-full           → TLS with full certificate verification
 *   sslmode=require|prefer|verify-ca|no-verify → TLS, certificate not verified
 *   no sslmode, local host        → no TLS
 *   no sslmode, remote host       → TLS, certificate not verified
 *
 * Hosted Postgres (Supabase, Neon) hands out URLs with `sslmode=require` and
 * expects the libpq meaning (encrypt, don't verify). Use `sslmode=verify-full`
 * when the server presents a publicly trusted certificate chain.
 */
export function buildPoolSettings(connectionString: string, env: EnvLike = process.env): PoolSettings {
  let host = "";
  let sslmode: string | null = null;
  try {
    const u = new URL(connectionString);
    host = u.hostname.toLowerCase();
    sslmode = u.searchParams.get("sslmode")?.toLowerCase() ?? null;
  } catch {
    // Non-URL strings are handed to pg untouched; it will surface the error.
  }

  let ssl: SslSetting | false;
  switch (sslmode) {
    case "disable":
      ssl = false;
      break;
    case "verify-full":
      ssl = { rejectUnauthorized: true };
      break;
    case "require":
    case "prefer":
    case "verify-ca":
    case "no-verify":
      ssl = { rejectUnauthorized: false };
      break;
    default:
      ssl = host && !LOCAL_HOSTS.has(host) ? { rejectUnauthorized: false } : false;
  }

  const fromEnv = Number(env.DATABASE_POOL_MAX);
  const max = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : env.VERCEL ? 5 : 10;

  return { connectionString, ssl, max };
}
