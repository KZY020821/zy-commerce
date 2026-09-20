/**
 * How well this catalogue can be talked about.
 *
 * The assistant is only as good as the structured data behind it: a product
 * with no specifications can be found and priced, but not compared, and not
 * recommended for a reason. A shop owner cannot see that from the product
 * list, so it is measured and shown to them.
 */

export interface ProductForReview {
  name: string;
  specCount: number;
  hasDescription: boolean;
  hasImage: boolean;
}

export interface CatalogueReadiness {
  products: number;
  withSpecs: number;
  withDescription: number;
  withImage: number;
  /** Share of products the assistant can compare on detail, 0–100. */
  specCoverage: number;
  /** Products with the fewest specifications, worst first. */
  thinnest: { name: string; specCount: number }[];
}

const THINNEST = 5;

export function countSpecs(specs: unknown): number {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return 0;
  return Object.values(specs as Record<string, unknown>).filter((value) => value !== null && value !== undefined && String(value).trim() !== "").length;
}

export function assessCatalogue(products: ProductForReview[]): CatalogueReadiness {
  const withSpecs = products.filter((p) => p.specCount > 0).length;
  return {
    products: products.length,
    withSpecs,
    withDescription: products.filter((p) => p.hasDescription).length,
    withImage: products.filter((p) => p.hasImage).length,
    specCoverage: products.length === 0 ? 0 : Math.round((withSpecs / products.length) * 100),
    thinnest: [...products]
      .sort((a, b) => a.specCount - b.specCount || a.name.localeCompare(b.name))
      .slice(0, THINNEST)
      .map((p) => ({ name: p.name, specCount: p.specCount })),
  };
}
