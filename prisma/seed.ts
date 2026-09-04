/**
 * Development seed. Idempotent — safe to re-run.
 *
 *   pnpm db:seed
 *
 * Creates:
 *   - one platform Super Admin (SEED_SUPER_ADMIN_EMAIL)
 *   - optionally a "demo" tenant with a Store Admin (SEED_DEMO_TENANT=true)
 *
 * Passwords come from SEED_*_PASSWORD; when blank a random one is generated
 * and printed ONCE. Existing accounts are never overwritten.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { UserRole } from "../src/generated/prisma/enums";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/auth/password";
import { buildPoolSettings, resolveDirectDatabaseUrl } from "../src/lib/db/connection";
import { isValidTenantSlug } from "../src/lib/tenant/resolve";

const connectionString = resolveDirectDatabaseUrl();
if (!connectionString) throw new Error("No database URL set (DIRECT_URL, POSTGRES_URL_NON_POOLING or DATABASE_URL)");
const pool = buildPoolSettings(connectionString);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: pool.connectionString, ssl: pool.ssl, max: 2 }) });

/** On Vercel / production we never invent passwords: they'd only live in build logs. */
const isHosted = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";

const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
const protocol = rootDomain.startsWith("localhost") ? "http" : "https";

function readEnv(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required seed variable ${name}`);
}

function passwordFromEnv(name: string): { password: string; generated: boolean } | null {
  const v = process.env[name]?.trim();
  if (v) {
    if (v.length < PASSWORD_MIN_LENGTH) throw new Error(`${name} must be at least ${PASSWORD_MIN_LENGTH} characters`);
    return { password: v, generated: false };
  }
  if (isHosted) {
    console.log(`! ${name} is not set — skipping this account. Add it to the environment and redeploy (or run the seed locally against the live database).`);
    return null;
  }
  return { password: randomBytes(12).toString("base64url"), generated: true };
}

const notes: string[] = [];

async function seedSuperAdmin() {
  const email = readEnv("SEED_SUPER_ADMIN_EMAIL").toLowerCase();
  const existing = await db.user.findFirst({ where: { tenantId: null, email, role: UserRole.SUPER_ADMIN } });
  if (existing) {
    console.log(`✓ Super admin already exists: ${email}`);
    return;
  }
  const cred = passwordFromEnv("SEED_SUPER_ADMIN_PASSWORD");
  if (!cred) return;
  const { password, generated } = cred;
  await db.user.create({
    data: { tenantId: null, email, name: "Platform Owner", role: UserRole.SUPER_ADMIN, passwordHash: await hashPassword(password) },
  });
  console.log(`+ Created super admin: ${email}`);
  if (generated) notes.push(`Super admin password (${email}): ${password}`);
}

async function seedDemoTenant() {
  if (readEnv("SEED_DEMO_TENANT", "true") !== "true") return;

  const slug = "demo";
  if (!isValidTenantSlug(slug)) throw new Error(`Invalid demo slug: ${slug}`);

  const tenant = await db.tenant.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: "Demo Store",
      status: "ACTIVE",
      primaryColor: "#2563eb",
      contactEmail: "hello@demo.example.com",
      currency: readEnv("SEED_DEMO_CURRENCY", "USD").toUpperCase(),
      country: readEnv("SEED_DEMO_COUNTRY", "US").toUpperCase(),
      locale: readEnv("SEED_DEMO_LOCALE", "en-US"),
      shippingFlatRate: 500,
      taxRateBps: 0,
    },
  });
  console.log(`✓ Tenant "${tenant.name}" ready at ${protocol}://${tenant.slug}.${rootDomain}`);

  const email = readEnv("SEED_DEMO_ADMIN_EMAIL", "admin@demo.example.com").toLowerCase();
  const existing = await db.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
  if (existing) {
    console.log(`✓ Store admin already exists: ${email}`);
    return;
  }
  const cred = passwordFromEnv("SEED_DEMO_ADMIN_PASSWORD");
  if (!cred) return;
  const { password, generated } = cred;
  await db.user.create({
    data: { tenantId: tenant.id, email, name: "Demo Admin", role: UserRole.STORE_ADMIN, passwordHash: await hashPassword(password) },
  });
  console.log(`+ Created store admin: ${email}`);
  if (generated) notes.push(`Demo store admin password (${email}): ${password}`);
}

async function main() {
  await seedSuperAdmin();
  await seedDemoTenant();

  console.log("\nURLs");
  console.log(`  Platform admin : ${protocol}://${rootDomain}/platform/login`);
  console.log(`  Demo storefront: ${protocol}://demo.${rootDomain}/`);
  console.log(`  Demo admin     : ${protocol}://demo.${rootDomain}/admin/login`);

  if (notes.length) {
    console.log("\nGenerated credentials (shown once — store them now):");
    for (const n of notes) console.log(`  ${n}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
