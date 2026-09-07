import "server-only";

/**
 * ZY Commerce's implementation of the Catalog Concierge adapter.
 *
 * This is the entire integration surface: two methods that translate this
 * app's Prisma rows into the package's product shape. The assistant knows
 * nothing about Prisma, tenants or this schema — swap this file and the same
 * widget serves a completely different business.
 *
 * Tenant safety: the client passed in is already scoped to one tenant by the
 * Prisma extension, so every query here is confined to that store by
 * construction rather than by remembering to filter.
 */
import type { CatalogAdapter, CatalogueProduct, CatalogueProductDetail } from "catalog-concierge";
import type { TenantDb } from "@/lib/db/tenant-client";

type Specs = Record<string, unknown> | null;

function toSpecs(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
}

export function createPrismaCatalogAdapter(db: TenantDb): CatalogAdapter {
  return {
    async listCatalogue(): Promise<CatalogueProduct[]> {
      const rows = await db.product.findMany({
        where: { active: true },
        include: { category: { select: { slug: true, name: true } }, images: { orderBy: { sortOrder: "asc" }, take: 1 } },
        orderBy: { name: "asc" },
      });
      return rows.map((p) => ({
        ref: p.sku,
        name: p.name,
        url: `/products/${p.slug}`,
        brand: p.brand,
        category: p.category ? { slug: p.category.slug, name: p.category.name } : null,
        description: p.description,
        price: p.price,
        priceFrom: p.hasVariants,
        stockQuantity: p.stockQuantity,
        lowStockThreshold: p.lowStockThreshold,
        specs: toSpecs(p.specs as Specs),
        imageUrl: p.images[0]?.url ?? null,
      }));
    },

    async getProduct(ref: string): Promise<CatalogueProductDetail | null> {
      const p = await db.product.findFirst({
        where: { active: true, OR: [{ sku: { equals: ref, mode: "insensitive" } }, { slug: ref.toLowerCase() }] },
        include: {
          category: { select: { slug: true, name: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          variants: { where: { active: true }, orderBy: { sortOrder: "asc" } },
        },
      });
      if (!p) return null;
      return {
        ref: p.sku,
        name: p.name,
        url: `/products/${p.slug}`,
        brand: p.brand,
        category: p.category ? { slug: p.category.slug, name: p.category.name } : null,
        description: p.description,
        price: p.price,
        priceFrom: p.hasVariants,
        stockQuantity: p.stockQuantity,
        lowStockThreshold: p.lowStockThreshold,
        specs: toSpecs(p.specs as Specs),
        imageUrl: p.images[0]?.url ?? null,
        variants: p.variants.map((v) => ({
          ref: v.sku,
          name: v.name,
          attributes: toSpecs(v.attributes as Specs),
          price: v.priceOverride ?? p.price,
          stockQuantity: v.stockQuantity,
        })),
      };
    },
  };
}
