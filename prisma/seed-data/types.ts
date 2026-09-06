/** Shape of the catalogue files produced by scripts/import-shopify-catalog.ts and loaded by prisma/seed.ts. */
export interface SeedVariant {
  sku: string;
  name: string;
  attributes: Record<string, string>;
  priceOverride?: number;
  stockQuantity: number;
}

export interface SeedProduct {
  sku: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  price: number;
  specs: Record<string, string>;
  stockQuantity: number;
  lowStockThreshold: number;
  images: { url: string; alt: string }[];
  variants?: SeedVariant[];
  source: { url: string; handle: string; originalPrice: string; originalCurrency: string; productType: string; tags: string[] };
}

export interface SeedCatalog {
  generatedAt: string;
  source: { store: string; storeName: string; feedUrl: string; currency: string };
  pricing: { currency: string; rate: number; rateSource: string };
  categories: { slug: string; name: string; description: string; sortOrder: number }[];
  products: SeedProduct[];
}
