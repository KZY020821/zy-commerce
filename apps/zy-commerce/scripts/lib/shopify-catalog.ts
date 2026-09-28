/**
 * The pure parts of scripts/import-shopify-catalog.ts: arguments, currency
 * conversion, categorisation, the report of what was left out, and the
 * `catalog-concierge evaluate` shape. No network and no file system, so
 * tests/unit/shopify-import.test.ts covers them without touching a store.
 */
import path from "node:path";
import type { CatalogueProductDetail } from "catalog-concierge";
import type { SeedCatalog } from "../../prisma/seed-data/types";

// ---------------------------------------------------------------------------
// Shopify types (subset)
// ---------------------------------------------------------------------------
export interface ShopifyVariant { id: number; title: string; option1: string | null; option2: string | null; option3: string | null; sku: string | null; available: boolean; price: string; compare_at_price: string | null; grams: number; featured_image: { src: string } | null; position: number }
export interface ShopifyImage { id: number; position: number; src: string; width: number; height: number; variant_ids: number[] }
export interface ShopifyProduct { id: number; title: string; handle: string; body_html: string; vendor: string; product_type: string; tags: string[]; options: { name: string; values: string[] }[]; variants: ShopifyVariant[]; images: ShopifyImage[] }

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
export interface ImportOptions {
  store: string;
  storeName: string;
  out: string;
  /** Also write the catalogue in the shape `catalog-concierge evaluate` reads. */
  evaluateOut?: string;
  targetCurrency: string;
  sourceCurrency: string;
  concurrency: number;
  cacheDir: string;
  skuPrefix: string;
  /** Keep products no category recognises, under "Other", instead of dropping them. */
  includeOther: boolean;
}

const DEFAULT_STORE = "www.selkirk.com";
const VALUE_OPTIONS = ["store", "name", "out", "evaluate-out", "currency", "source-currency", "concurrency", "cache", "sku-prefix"];
const BOOLEAN_OPTIONS = ["include-other"];

/** "www.mypickleball.my" → "mypickleball". Names the default output file and SKU prefix. */
export function storeKey(store: string): string {
  const labels = store.toLowerCase().replace(/^https?:\/\//, "").split(/[/:]/)[0]!.replace(/^www\./, "").split(".").filter(Boolean);
  return (labels.length > 1 ? labels.slice(0, -1) : labels).join("-").replace(/[^a-z0-9-]/g, "") || "store";
}

export function parseImportArgs(argv: string[]): ImportOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const key = arg.replace(/^--/, "");
    if (!arg.startsWith("--") || ![...VALUE_OPTIONS, ...BOOLEAN_OPTIONS].includes(key)) {
      throw new Error(`Unknown argument ${arg}. Options: ${[...VALUE_OPTIONS, ...BOOLEAN_OPTIONS].map((o) => `--${o}`).join(", ")}`);
    }
    if (BOOLEAN_OPTIONS.includes(key)) { flags.add(key); continue; }
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    values.set(key, value);
  }

  // Accept a pasted URL as well as a bare domain.
  const store = (values.get("store") ?? DEFAULT_STORE).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const key = storeKey(store);
  const concurrency = Number(values.get("concurrency") ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`--concurrency must be a whole number of at least 1, not ${values.get("concurrency")}`);
  return {
    store,
    storeName: values.get("name") ?? (store === DEFAULT_STORE ? "Selkirk Sport" : store),
    // Derived from the store, so importing another shop can never overwrite selkirk.json.
    out: values.get("out") ?? `prisma/seed-data/${key}.json`,
    ...(values.has("evaluate-out") ? { evaluateOut: values.get("evaluate-out") } : {}),
    targetCurrency: (values.get("currency") ?? "MYR").toUpperCase(),
    sourceCurrency: (values.get("source-currency") ?? "USD").toUpperCase(),
    concurrency,
    cacheDir: values.get("cache") ?? path.join("node_modules", ".cache", "zy-import", store),
    // Selkirk keeps SLK so re-importing it reproduces the committed seed file.
    skuPrefix: (values.get("sku-prefix") ?? (store === DEFAULT_STORE ? "SLK" : key.replace(/[^a-z]/g, "").slice(0, 3) || "SKU")).toUpperCase(),
    includeOther: flags.has("include-other"),
  };
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------
/** Fixed conversion table (mid-market, 2026-09-06). Extend as needed. */
export const RATES: Record<string, number> = { "USD:MYR": 4.415, "USD:SGD": 1.29, "USD:EUR": 0.86, "USD:GBP": 0.74, "USD:AUD": 1.5 };
const RATES_DATE = "2026-09-06";

/** The rate from the store's currency to ours, and where it came from. A store already in our currency needs none. */
export function resolveRate(source: string, target: string, rates: Record<string, number> = RATES): { rate: number; rateSource: string } {
  if (source === target) return { rate: 1, rateSource: `none: the store already prices in ${target}` };
  const rateKey = `${source}:${target}`;
  const rate = rates[rateKey];
  if (!rate) throw new Error(`No conversion rate for ${rateKey}; add it to RATES`);
  return { rate, rateSource: `https://wise.com/gb/currency-converter/${source.toLowerCase()}-to-${target.toLowerCase()}-rate (${RATES_DATE})` };
}

/** A Shopify price string in minor units. Converted prices are rounded to a whole unit ending .90; unconverted ones are kept exactly. */
export function toMinor(price: string, rate: number): number {
  const n = Number(price);
  if (!Number.isFinite(n)) return 0;
  if (rate === 1) return Math.round(n * 100);
  const major = Math.round(n * rate);
  return Math.max(100, major * 100 - 10); // e.g. $199.99 → RM 882.90
}

// ---------------------------------------------------------------------------
// Categorisation
// ---------------------------------------------------------------------------
export interface CategoryDef { slug: string; name: string; description: string; blurb: string; match: (p: ShopifyProduct) => boolean }

/** Shaped around Selkirk's `product_type` values and tags; another store's feed may match few of them. */
export const CATEGORY_DEFS: CategoryDef[] = [
  { slug: "paddles", name: "Paddles", description: "Carbon, fiberglass and hybrid pickleball paddles for every level of play.", blurb: "Pickleball paddle from {brand}.", match: (p) => /^paddle$/i.test(p.product_type) || (p.tags.includes("paddles") && !/bundle|cover|case|grip|weight|eraser|tape/i.test(p.title)) },
  { slug: "bundles", name: "Bundles", description: "Paddle sets and bundles that get you court-ready in one go.", blurb: "A ready-to-play set from {brand}.", match: (p) => /bundle/i.test(p.product_type) || p.tags.includes("bundle") },
  { slug: "balls", name: "Balls", description: "Indoor, outdoor and quiet pickleballs.", blurb: "Pickleballs from {brand}.", match: (p) => /^balls?$/i.test(p.product_type) },
  { slug: "nets", name: "Nets", description: "Portable and semi-permanent nets, posts and court setups.", blurb: "Court net system from {brand}.", match: (p) => /^net$/i.test(p.product_type) || p.tags.includes("net") },
  { slug: "bags", name: "Bags", description: "Backpacks, duffles and slings that carry paddles, balls and a change of kit.", blurb: "Gear bag from {brand}.", match: (p) => /^bags?$/i.test(p.product_type) || p.tags.includes("bags") },
  { slug: "footwear", name: "Footwear", description: "Court shoes built for lateral movement and long tournament days.", blurb: "Court shoe from {brand}.", match: (p) => /footwear/i.test(p.product_type) || p.tags.includes("shoe") },
  { slug: "hats", name: "Hats", description: "Caps, visors and beanies for on and off the court.", blurb: "Headwear from {brand}.", match: (p) => /^hats?$/i.test(p.product_type) || p.tags.includes("hat") },
  { slug: "apparel", name: "Apparel", description: "Performance and lifestyle apparel for men and women.", blurb: "Court apparel from {brand}.", match: (p) => /apparel/i.test(p.product_type) || p.tags.includes("clothing") },
  { slug: "accessories", name: "Accessories", description: "Grips, edge tape, paddle care, eyewear, towels and more.", blurb: "Accessory from {brand}.", match: (p) => /accessor/i.test(p.product_type) || p.tags.includes("accessories") || p.tags.includes("care") },
];

/** Where unrecognised products go with --include-other. Always listed last. */
export const OTHER_CATEGORY: CategoryDef = { slug: "other", name: "Other", description: "Everything else the store sells.", blurb: "A product from {brand}.", match: () => true };

export const ALL_CATEGORIES: CategoryDef[] = [...CATEGORY_DEFS, OTHER_CATEGORY];

const EXCLUDE_TITLE = /free gift|free bag tag|subscription test|send as a gift|paddle customization|vip membership|loop exchange|demos?\b|2nd\b|gift card|warranty|insurance|donation|raffle|ticket|registration|membership|test product/i;
const EXCLUDE_TYPE = /offsite|gift card/i;

/** Why a product is left out: not merchandise, nothing to sell it for, or no category for it. */
export type DropReason = "excluded" | "unpriced" | "unrecognised";
export type Triage = { category: string } | { dropped: DropReason };

export function triageProduct(p: ShopifyProduct, includeOther = false): Triage {
  if (EXCLUDE_TITLE.test(p.title) || EXCLUDE_TYPE.test(p.product_type) || p.tags.includes("hide")) return { dropped: "excluded" };
  if (!p.variants.some((v) => Number(v.price) > 0)) return { dropped: "unpriced" };
  for (const def of CATEGORY_DEFS) if (def.match(p)) return { category: def.slug };
  return includeOther ? { category: OTHER_CATEGORY.slug } : { dropped: "unrecognised" };
}

export interface FeedTriage {
  kept: { p: ShopifyProduct; category: string }[];
  excluded: number;
  unpriced: number;
  /** Products no category matched (dropped, or filed under Other), by `product_type`, most first. */
  unrecognised: { productType: string; count: number; examples: string[] }[];
}

export function triageFeed(feed: ShopifyProduct[], includeOther = false): FeedTriage {
  const result: FeedTriage = { kept: [], excluded: 0, unpriced: 0, unrecognised: [] };
  const byType = new Map<string, { productType: string; count: number; examples: string[] }>();
  for (const p of feed) {
    const triage = triageProduct(p, includeOther);
    const unrecognised = "dropped" in triage ? triage.dropped === "unrecognised" : triage.category === OTHER_CATEGORY.slug;
    if (unrecognised) {
      const productType = p.product_type.trim();
      const row = byType.get(productType) ?? { productType, count: 0, examples: [] };
      row.count++;
      if (row.examples.length < 3) row.examples.push(p.title.trim());
      byType.set(productType, row);
    }
    if ("category" in triage) result.kept.push({ p, category: triage.category });
    else if (triage.dropped === "excluded") result.excluded++;
    else if (triage.dropped === "unpriced") result.unpriced++;
  }
  result.unrecognised = [...byType.values()].sort((a, b) => b.count - a.count || a.productType.localeCompare(b.productType));
  return result;
}

/** What the import left out and why, so a store whose feed does not fit the categories cannot lose products silently. */
export function triageReport(triage: FeedTriage, feedSize: number, includeOther: boolean): string[] {
  const unrecognised = triage.unrecognised.reduce((sum, row) => sum + row.count, 0);
  const dropped = feedSize - triage.kept.length;
  const lines = [`  ${feedSize} products in feed, ${triage.kept.length} importable${dropped ? `, ${dropped} dropped` : ""}`];
  if (triage.excluded) lines.push(`    ${triage.excluded} excluded as not merchandise (gift cards, memberships, demos, hidden)`);
  if (triage.unpriced) lines.push(`    ${triage.unpriced} with no price above zero`);
  if (unrecognised) {
    lines.push(includeOther
      ? `    ${unrecognised} matched no category and were filed under "Other", by product_type:`
      : `    ${unrecognised} matched no category and were dropped, by product_type:`);
    for (const row of triage.unrecognised) lines.push(`      ${String(row.count).padStart(4)}  ${row.productType ? `"${row.productType}"` : "(no product_type)"}  e.g. ${row.examples.join("; ")}`);
    if (!includeOther) lines.push(`    Re-run with --include-other to keep them under an "Other" category, or add a matcher to CATEGORY_DEFS.`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// catalog-concierge evaluate
// ---------------------------------------------------------------------------
/**
 * The seed catalogue in the shape `catalog-concierge evaluate` reads.
 *
 * Stock is reduced to what the store actually published. Shopify's public
 * feed only says whether a variant is available; the seed invents counts so
 * the demo has low-stock states, and an evaluation shown to the shop's owner
 * must not have the assistant quote those. Sold out stays 0, anything else is
 * untracked (null), which the assistant describes as in stock.
 */
export function toEvaluateCatalogue(seed: SeedCatalog): CatalogueProductDetail[] {
  const names = new Map(seed.categories.map((c) => [c.slug, c.name]));
  const published = (quantity: number) => (quantity > 0 ? null : 0);
  return seed.products.map((p) => {
    const name = names.get(p.category);
    if (!name) throw new Error(`Unknown category ${p.category} for ${p.sku}`);
    return {
      ref: p.sku,
      name: p.name,
      url: p.source.url,
      brand: p.brand,
      category: { slug: p.category, name },
      description: p.description,
      price: p.price,
      priceFrom: (p.variants ?? []).some((v) => v.priceOverride !== undefined && v.priceOverride !== p.price),
      stockQuantity: published(p.stockQuantity),
      specs: p.specs,
      imageUrl: p.images[0]?.url ?? null,
      ...(p.variants ? { variants: p.variants.map((v) => ({ ref: v.sku, name: v.name, attributes: v.attributes, price: v.priceOverride ?? p.price, stockQuantity: published(v.stockQuantity) })) } : {}),
    };
  });
}
