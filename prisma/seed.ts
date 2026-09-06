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
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { UserRole } from "../src/generated/prisma/enums";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/auth/password";
import { buildPoolSettings, resolveDirectDatabaseUrl } from "../src/lib/db/connection";
import { isValidTenantSlug, platformOrigin, tenantOrigin } from "../src/lib/tenant/resolve";
import catalogJson from "./seed-data/selkirk.json" with { type: "json" };
import type { SeedCatalog } from "./seed-data/types";

const catalog = catalogJson as SeedCatalog;

const connectionString = resolveDirectDatabaseUrl();
if (!connectionString) throw new Error("No database URL set (DIRECT_URL, POSTGRES_URL_NON_POOLING or DATABASE_URL)");
const pool = buildPoolSettings(connectionString);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: pool.connectionString, ssl: pool.ssl, max: 8 }) });

/** On Vercel / production we never invent passwords: they'd only live in build logs. */
const isHosted = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";


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

  const storeName = readEnv("SEED_DEMO_STORE_NAME", "Selkirk Demo");
  const brandColor = readEnv("SEED_DEMO_BRAND_COLOR", "#111111");
  const assistantName = readEnv("SEED_DEMO_ASSISTANT_NAME", "Selkirk Fit Assistant");
  const assistantGreeting = readEnv(
    "SEED_DEMO_ASSISTANT_GREETING",
    "Hi! I know every product in this store. Tell me how you play or what you're after and I'll help you find the right fit.",
  );
  const tenant = await db.tenant.upsert({
    where: { slug },
    // Name, branding and assistant settings follow the seed until the Phase 5 settings UI exists.
    update: { name: storeName, primaryColor: brandColor, assistantName, assistantGreeting },
    create: {
      slug,
      name: storeName,
      status: "ACTIVE",
      primaryColor: brandColor,
      assistantName,
      assistantGreeting,
      contactEmail: "hello@demo.example.com",
      currency: readEnv("SEED_DEMO_CURRENCY", "USD").toUpperCase(),
      country: readEnv("SEED_DEMO_COUNTRY", "US").toUpperCase(),
      locale: readEnv("SEED_DEMO_LOCALE", "en-US"),
      shippingFlatRate: 500,
      taxRateBps: 0,
    },
  });
  console.log(`✓ Tenant "${tenant.name}" ready at ${tenantOrigin(tenant.slug)}`);

  if (readEnv("SEED_DEMO_CATALOG", "true") === "true") await seedDemoCatalog(tenant.id, tenant.catalogFingerprint);

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

/**
 * Loads the imported catalogue (prisma/seed-data/selkirk.json, built by
 * scripts/import-shopify-catalog.ts) into the demo tenant.
 *
 * Idempotent and fast enough for a Vercel build: the file's SHA-1 is stored on
 * the tenant and an unchanged catalogue is skipped entirely; otherwise
 * products are processed 8 at a time with bulk inserts for images/variants.
 */
async function seedDemoCatalog(tenantId: string, previousFingerprint: string | null) {
  const fingerprint = createHash("sha1").update(JSON.stringify(catalog)).digest("hex");
  if (previousFingerprint === fingerprint) {
    console.log(`✓ Catalogue unchanged (${catalog.products.length} products) — skipped`);
    return;
  }
  const currency = catalog.pricing.currency;
  await db.tenant.update({ where: { id: tenantId }, data: { currency } });

  const categoryIds = new Map<string, string>();
  for (const c of catalog.categories) {
    const row = await db.category.upsert({
      where: { tenantId_slug: { tenantId, slug: c.slug } },
      update: { name: c.name, description: c.description, sortOrder: c.sortOrder },
      create: { tenantId, slug: c.slug, name: c.name, description: c.description, sortOrder: c.sortOrder },
    });
    categoryIds.set(c.slug, row.id);
  }

  let created = 0;
  const queue = [...catalog.products];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const categoryId = categoryIds.get(p.category);
      if (!categoryId) throw new Error(`Unknown category ${p.category} for ${p.sku}`);
      const hasVariants = Boolean(p.variants && p.variants.length > 0);
      const data = {
        name: p.name, slug: p.slug, description: p.description, brand: p.brand, specs: p.specs,
        price: p.price, currency, categoryId, active: true, hasVariants,
        stockQuantity: p.stockQuantity, lowStockThreshold: p.lowStockThreshold,
      };
      const existing = await db.product.findUnique({ where: { tenantId_sku: { tenantId, sku: p.sku } }, select: { id: true } });
      const product = existing
        ? await db.product.update({ where: { id: existing.id }, data })
        : await db.product.create({ data: { tenantId, sku: p.sku, ...data } });
      if (!existing) created++;

      await db.productImage.deleteMany({ where: { productId: product.id } });
      if (p.images.length) {
        await db.productImage.createMany({ data: p.images.map((img, i) => ({ tenantId, productId: product.id, url: img.url, alt: img.alt, sortOrder: i })) });
      }

      const wanted = p.variants ?? [];
      const existingVariants = await db.productVariant.findMany({ where: { productId: product.id }, select: { id: true, sku: true } });
      const bySku = new Map(existingVariants.map((v) => [v.sku, v.id]));
      const stale = existingVariants.filter((v) => !wanted.some((w) => w.sku === v.sku)).map((v) => v.id);
      if (stale.length) await db.productVariant.deleteMany({ where: { id: { in: stale } } });
      const toCreate = wanted.filter((v) => !bySku.has(v.sku));
      if (toCreate.length) {
        await db.productVariant.createMany({
          data: toCreate.map((v) => ({ tenantId, productId: product.id, sku: v.sku, name: v.name, attributes: v.attributes, priceOverride: v.priceOverride ?? null, stockQuantity: v.stockQuantity, active: true, sortOrder: wanted.indexOf(v) })),
        });
      }
      for (const v of wanted) {
        const id = bySku.get(v.sku);
        if (!id) continue;
        await db.productVariant.update({ where: { id }, data: { name: v.name, attributes: v.attributes, priceOverride: v.priceOverride ?? null, stockQuantity: v.stockQuantity, active: true, sortOrder: wanted.indexOf(v) } });
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  await db.tenant.update({ where: { id: tenantId }, data: { catalogFingerprint: fingerprint } });
  const variants = catalog.products.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
  console.log(`✓ Catalogue: ${catalog.products.length} products, ${variants} variants in ${catalog.categories.length} categories (${created} new) — priced in ${currency}`);
}

async function main() {
  await seedSuperAdmin();
  await seedDemoTenant();

  console.log("\nURLs");
  console.log(`  Platform admin : ${platformOrigin()}/platform/login`);
  console.log(`  Demo storefront: ${tenantOrigin("demo")}/`);
  console.log(`  Demo admin     : ${tenantOrigin("demo")}/admin/login`);

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
