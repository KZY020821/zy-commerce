/**
 * Development seed. Idempotent — safe to re-run.
 *
 *   pnpm db:seed
 *
 * Creates:
 *   - one platform Super Admin (SEED_SUPER_ADMIN_EMAIL)
 *   - the demo tenants listed in DEMO_STORES below, each with a Store Admin
 *     and its imported catalogue (skip them all with SEED_DEMO_TENANT=false)
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
import selkirkJson from "./seed-data/selkirk.json" with { type: "json" };
import nikeJson from "./seed-data/nike.json" with { type: "json" };
import type { SeedCatalog } from "./seed-data/types";

/**
 * Demo tenants. Each is a fully independent store: its own catalogue,
 * currency, branding and assistant — which is also what proves the
 * multi-tenancy story to a prospective client.
 */
interface DemoStore {
  slug: string;
  envPrefix: string;
  name: string;
  brandColor: string;
  assistantName: string;
  assistantGreeting: string;
  contactEmail: string;
  adminEmail: string;
  currency: string;
  country: string;
  locale: string;
  shippingFlatRate: number;
  catalog: SeedCatalog;
}

const DEMO_STORES: DemoStore[] = [
  {
    slug: "demo",
    envPrefix: "SEED_DEMO",
    name: "Selkirk Demo",
    brandColor: "#111111",
    assistantName: "Selkirk Fit Assistant",
    assistantGreeting: "Hi! I know every product in this store. Tell me how you play or what you're after and I'll help you find the right fit.",
    contactEmail: "hello@demo.example.com",
    adminEmail: "admin@demo.example.com",
    currency: "MYR",
    country: "MY",
    locale: "ms-MY",
    shippingFlatRate: 500,
    catalog: selkirkJson as unknown as SeedCatalog,
  },
  {
    slug: "nike",
    envPrefix: "SEED_NIKE",
    name: "Nike Demo",
    brandColor: "#111111",
    assistantName: "Nike Game Fit",
    assistantGreeting: "Hey! Tell me how you play or what you need on court, and I'll find the right gear from this store.",
    contactEmail: "hello@nike.example.com",
    adminEmail: "admin@nike.example.com",
    currency: "USD",
    country: "US",
    locale: "en-US",
    shippingFlatRate: 700,
    catalog: nikeJson as unknown as SeedCatalog,
  },
];

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

async function seedDemoStore(store: DemoStore) {
  if (readEnv("SEED_DEMO_TENANT", "true") !== "true") return;
  if (!isValidTenantSlug(store.slug)) throw new Error(`Invalid demo slug: ${store.slug}`);

  const p = store.envPrefix;
  const storeName = readEnv(`${p}_STORE_NAME`, store.name);
  const brandColor = readEnv(`${p}_BRAND_COLOR`, store.brandColor);
  const assistantName = readEnv(`${p}_ASSISTANT_NAME`, store.assistantName);
  const assistantGreeting = readEnv(`${p}_ASSISTANT_GREETING`, store.assistantGreeting);

  const tenant = await db.tenant.upsert({
    where: { slug: store.slug },
    // Name, branding and assistant settings follow the seed until the Phase 5 settings UI exists.
    update: { name: storeName, primaryColor: brandColor, assistantName, assistantGreeting },
    create: {
      slug: store.slug,
      name: storeName,
      status: "ACTIVE",
      primaryColor: brandColor,
      assistantName,
      assistantGreeting,
      contactEmail: store.contactEmail,
      currency: readEnv(`${p}_CURRENCY`, store.currency).toUpperCase(),
      country: readEnv(`${p}_COUNTRY`, store.country).toUpperCase(),
      locale: readEnv(`${p}_LOCALE`, store.locale),
      shippingFlatRate: store.shippingFlatRate,
      taxRateBps: 0,
    },
  });
  console.log(`✓ Tenant "${tenant.name}" ready at ${tenantOrigin(tenant.slug)}`);

  if (readEnv(`${p}_CATALOG`, "true") === "true") await seedDemoCatalog(tenant.id, tenant.catalogFingerprint, store.catalog);

  const email = readEnv(`${p}_ADMIN_EMAIL`, store.adminEmail).toLowerCase();
  const existing = await db.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
  if (existing) {
    console.log(`✓ Store admin already exists: ${email}`);
    return;
  }
  const cred = passwordFromEnv(`${p}_ADMIN_PASSWORD`);
  if (!cred) return;
  const { password, generated } = cred;
  await db.user.create({
    data: { tenantId: tenant.id, email, name: `${storeName} Admin`, role: UserRole.STORE_ADMIN, passwordHash: await hashPassword(password) },
  });
  console.log(`+ Created store admin: ${email}`);
  if (generated) notes.push(`${storeName} admin password (${email}): ${password}`);
}

/**
 * Loads one imported catalogue (prisma/seed-data/*.json, built by the import
 * scripts) into a tenant.
 *
 * Idempotent and fast enough for a Vercel build: the file's SHA-1 is stored on
 * the tenant and an unchanged catalogue is skipped entirely; otherwise
 * products are processed 8 at a time with bulk inserts for images/variants.
 */
async function seedDemoCatalog(tenantId: string, previousFingerprint: string | null, catalog: SeedCatalog) {
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
  for (const store of DEMO_STORES) await seedDemoStore(store);

  console.log("\nURLs");
  console.log(`  Platform admin : ${platformOrigin()}/platform/login`);
  for (const store of DEMO_STORES) {
    console.log(`  ${store.name.padEnd(14)}: ${tenantOrigin(store.slug)}/  (admin: ${tenantOrigin(store.slug)}/admin/login)`);
  }

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
