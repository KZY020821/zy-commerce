/**
 * Typed, validated server environment. Import only from server code.
 * Optional groups (Stripe, email, blob) are validated lazily by the feature
 * that needs them so Phase 0 runs with just the core variables.
 */
import "server-only";
import { z } from "zod";

/** Treats "" as unset so `.env.example` placeholders don't trip validation. */
const optionalString = () => z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const coreSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Any one of these may carry the runtime (pooled) connection; see src/lib/db/connection.ts.
  DATABASE_URL: optionalString(),
  POSTGRES_PRISMA_URL: optionalString(),
  POSTGRES_URL: optionalString(),
  DIRECT_URL: optionalString(),
  POSTGRES_URL_NON_POOLING: optionalString(),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters (openssl rand -base64 32)"),
  NEXT_PUBLIC_ROOT_DOMAIN: z.string().min(1),

  STRIPE_SECRET_KEY: optionalString(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString(),
  STRIPE_WEBHOOK_SECRET: optionalString(),
  RESEND_API_KEY: optionalString(),
  EMAIL_FROM: optionalString(),
  BLOB_READ_WRITE_TOKEN: optionalString(),
  DEEPSEEK_API_KEY: optionalString(),
  AI_MODEL: optionalString(),
  AI_BASE_URL: optionalString(),
});

export type Env = z.infer<typeof coreSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = coreSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  if (!parsed.data.DATABASE_URL && !parsed.data.POSTGRES_PRISMA_URL && !parsed.data.POSTGRES_URL) {
    throw new Error("Invalid environment configuration:\n  - set DATABASE_URL (or POSTGRES_PRISMA_URL / POSTGRES_URL)\nSee .env.example.");
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";
