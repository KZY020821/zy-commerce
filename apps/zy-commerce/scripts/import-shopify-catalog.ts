/**
 * Imports a Shopify store's public catalogue into a seed file the platform can
 * load for a demo tenant. Default target: Selkirk Sport.
 *
 *   pnpm tsx scripts/import-shopify-catalog.ts                 # → prisma/seed-data/selkirk.json
 *   pnpm tsx scripts/import-shopify-catalog.ts --store www.selkirk.com --out prisma/seed-data/selkirk.json --currency MYR
 *   pnpm tsx scripts/import-shopify-catalog.ts --store www.mypickleball.my --name "MyPickleball" \
 *     --source-currency MYR --currency MYR --out /tmp/mypickleball.json --evaluate-out /tmp/mypickleball.evaluate.json
 *
 * Options: --store, --name, --out (default prisma/seed-data/<store>.json),
 * --evaluate-out (also write the `catalog-concierge evaluate` shape),
 * --source-currency (the store's, default USD), --currency (ours, default MYR),
 * --include-other (keep products no category matches, under "Other"),
 * --sku-prefix, --concurrency, --cache.
 *
 * Sources (all public, unauthenticated):
 *   - /products.json              names, vendors, types, tags, options, variants, prices, images
 *   - /products/{handle}          the "#tech-specs" block and "Label: value" lines → structured specs
 *
 * Only factual catalogue data is taken (names, options, prices, specifications,
 * image URLs). Marketing copy is never reproduced; descriptions are generated
 * from the extracted facts. Image URLs point at the store's CDN.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { htmlToLines, normalizeSpecs, parseLabelLines, parseTechSpecs } from "catalog-concierge";
import type { SeedCatalog, SeedProduct, SeedVariant } from "../prisma/seed-data/types";
import { ALL_CATEGORIES, parseImportArgs, resolveRate, toEvaluateCatalogue, toMinor, triageFeed, triageReport, type ImportOptions, type ShopifyProduct } from "./lib/shopify-catalog";

function options(): ImportOptions {
  try { return parseImportArgs(process.argv.slice(2)); }
  catch (e) { console.error((e as Error).message); process.exit(1); }
}
const { store: STORE, storeName: STORE_NAME, out: OUT, evaluateOut: EVALUATE_OUT, targetCurrency: TARGET_CURRENCY, sourceCurrency: SOURCE_CURRENCY, concurrency: CONCURRENCY, cacheDir: CACHE_DIR, skuPrefix: SKU_PREFIX, includeOther: INCLUDE_OTHER } = options();

const UA = "Mozilla/5.0 (compatible; ZYCommerceCatalogImport/1.0; +https://github.com/KZY020821/zy-commerce)";

const MARKETING_LABELS = /^(breathable comfort|unrestrictive movement|weather resistant|moisture-wicking technology|fast-drying technology|relaxed fit|acoustic sound-dampening design|custom material blend|injection-molded construction|community-friendly)$/i;

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").slice(0, 70).replace(/-$/, "");
}
function hashInt(s: string, mod: number): number {
  return parseInt(createHash("sha1").update(s).digest("hex").slice(0, 8), 16) % mod;
}
function stockFor(key: string, available: boolean): number {
  if (!available) return 0;
  const h = hashInt(key, 100);
  if (h < 10) return 1 + hashInt(key + "low", 5);
  return 6 + hashInt(key + "stock", 45);
}
function cleanName(title: string): string {
  return title.replace(/\s{2,}/g, " ").replace(/\s+-\s*$/, "").trim();
}
function imageUrl(src: string): string {
  // Shopify CDN accepts a width param for on-the-fly resizing.
  return src.includes("?") ? `${src}&width=1200` : `${src}?width=1200`;
}

function describe(p: ShopifyProduct, category: string, brand: string, specs: Record<string, string>, options: { name: string; values: string[] }[]): string {
  const parts: string[] = [ALL_CATEGORIES.find((c) => c.slug === category)!.blurb.replace("{brand}", brand)];
  const keySpecs = ["Skill Level", "Weight Range", "Weight", "Core Thickness", "Face", "Core", "Grip Circumference", "Paddle Length", "Paddle Width", "Volume", "Dimensions", "Material", "Approval"]
    .filter((k) => specs[k]).map((k) => `${k.toLowerCase()} ${specs[k]}`);
  if (keySpecs.length) parts.push(`Key specs: ${keySpecs.join(", ")}.`);
  const opts = options.filter((o) => o.name !== "Title" && o.values.length > 1).map((o) => `${o.name.toLowerCase()}s: ${o.values.slice(0, 8).join(", ")}${o.values.length > 8 ? "…" : ""}`);
  if (opts.length) parts.push(`Available ${opts.join("; ")}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}
async function fetchText(url: string, attempt = 1): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${res.status} ${url}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * attempt;
    await new Promise((r) => setTimeout(r, wait));
    return fetchText(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
/** Product pages are cached on disk so re-runs don't hammer the store. */
async function fetchPageCached(handle: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${handle}.html`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const html = await fetchText(`https://${STORE}/products/${handle}`);
  writeFileSync(file, html);
  return html;
}
async function fetchFeed(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; page <= 10; page++) {
    const j = await fetchJson<{ products: ShopifyProduct[] }>(`https://${STORE}/products.json?limit=250&page=${page}`);
    all.push(...j.products);
    if (j.products.length < 250) break;
  }
  return all;
}
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); await new Promise((r) => setTimeout(r, 400)); }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { rate, rateSource } = resolveRate(SOURCE_CURRENCY, TARGET_CURRENCY);

  console.log(`Fetching feed from ${STORE} …`);
  const feed = await fetchFeed();
  const triage = triageFeed(feed, INCLUDE_OTHER);
  const { kept } = triage;
  for (const line of triageReport(triage, feed.length, INCLUDE_OTHER)) console.log(line);

  console.log(`Fetching ${kept.length} product pages for specs (concurrency ${CONCURRENCY}) …`);
  let done = 0;
  const pages = await mapPool(kept, CONCURRENCY, async ({ p }) => {
    try { const html = await fetchPageCached(p.handle); done++; if (done % 25 === 0) console.log(`  ${done}/${kept.length}`); return html; }
    catch (e) { console.warn(`  ! ${p.handle}: ${(e as Error).message}`); return ""; }
  });

  const seenSlugs = new Set<string>();
  const seenSkus = new Set<string>();
  const products: SeedProduct[] = [];
  let withSpecs = 0;

  kept.forEach(({ p, category }, idx) => {
    const brand = p.vendor || STORE_NAME;
    const name = cleanName(p.title);
    let slug = slugify(name) || p.handle;
    while (seenSlugs.has(slug)) slug = `${slug}-${idx}`;
    seenSlugs.add(slug);

    const sections = parseTechSpecs(pages[idx] ?? "");
    const bodyLines = htmlToLines(p.body_html);
    const fallback = parseLabelLines(bodyLines, MARKETING_LABELS);
    const primary = sections[0]?.specs ?? {};
    const specs: Record<string, string> = normalizeSpecs({ ...fallback, ...primary });
    // Facts that live outside the spec block
    for (const o of p.options) if (o.name !== "Title" && o.values.length > 1) specs[`Available ${o.name}s`] = o.values.join(", ");
    if (sections.length > 1 && !Object.keys(specs).some((k) => /shape/i.test(k))) specs["Available Shapes"] = sections.map((s) => s.heading).filter(Boolean).join(", ");
    // Shopify's grams is shipping weight — only use it when nothing weight-related was published
    const weightG = p.variants.find((v) => v.grams > 0)?.grams;
    if (weightG && !Object.keys(specs).some((k) => /weight/i.test(k))) specs["Shipping Weight"] = `${(weightG / 28.3495).toFixed(1)} oz`;
    if (Object.keys(specs).length) withSpecs++;

    const sellable = p.variants.filter((v) => Number(v.price) > 0);
    const basePrice = toMinor(String(Math.min(...sellable.map((v) => Number(v.price)))), rate);
    const sku = `${SKU_PREFIX}-${String(idx + 1).padStart(3, "0")}`;
    const hasVariants = sellable.length > 1 || (sellable.length === 1 && sellable[0]!.title !== "Default Title");
    const optionNames = p.options.map((o) => o.name);

    const variants: SeedVariant[] | undefined = hasVariants
      ? sellable.map((v, i) => {
          const attributes: Record<string, string> = {};
          [v.option1, v.option2, v.option3].forEach((val, oi) => { if (val && optionNames[oi] && optionNames[oi] !== "Title") attributes[optionNames[oi]!] = val; });
          // Per-shape spec sections attach to the matching variant
          const shape = sections.find((s) => s.heading && Object.values(attributes).some((val) => val.toLowerCase().includes(s.heading!.toLowerCase())));
          if (shape) for (const [k, val] of Object.entries(normalizeSpecs(shape.specs))) attributes[k] ??= val;
          let vsku = (v.sku ?? "").trim() || `${sku}-${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ""}`;
          while (seenSkus.has(vsku)) vsku = `${vsku}-${i}`;
          seenSkus.add(vsku);
          const vPrice = toMinor(v.price, rate);
          return { sku: vsku, name: v.title, attributes, ...(vPrice !== basePrice ? { priceOverride: vPrice } : {}), stockQuantity: stockFor(vsku, v.available) };
        })
      : undefined;

    const images = p.images.length
      ? p.images.sort((a, b) => a.position - b.position).slice(0, 8).map((img, i) => ({ url: imageUrl(img.src), alt: i === 0 ? name : `${name} – view ${i + 1}` }))
      : [];

    products.push({
      sku, slug, name, brand, category,
      description: describe(p, category, brand, specs, p.options),
      price: basePrice, specs,
      stockQuantity: variants ? variants.reduce((s, v) => s + v.stockQuantity, 0) : stockFor(sku, sellable[0]!.available),
      lowStockThreshold: 5, images, ...(variants ? { variants } : {}),
      source: { url: `https://${STORE}/products/${p.handle}`, handle: p.handle, originalPrice: sellable[0]!.price, originalCurrency: SOURCE_CURRENCY, productType: p.product_type, tags: p.tags },
    });
  });

  const usedCategories = ALL_CATEGORIES.filter((c) => products.some((p) => p.category === c.slug));
  const out: SeedCatalog = {
    generatedAt: new Date().toISOString(),
    source: { store: STORE, storeName: STORE_NAME, feedUrl: `https://${STORE}/products.json`, currency: SOURCE_CURRENCY },
    pricing: { currency: TARGET_CURRENCY, rate, rateSource },
    categories: usedCategories.map((c, i) => ({ slug: c.slug, name: c.name, description: c.description, sortOrder: i })),
    products,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const variantCount = products.reduce((s, p) => s + (p.variants?.length ?? 0), 0);
  console.log(`\nWrote ${products.length} products (${withSpecs} with specs, ${variantCount} variants) in ${usedCategories.length} categories → ${OUT}`);
  for (const c of usedCategories) console.log(`  ${c.name}: ${products.filter((p) => p.category === c.slug).length}`);

  if (EVALUATE_OUT) {
    mkdirSync(path.dirname(EVALUATE_OUT), { recursive: true });
    writeFileSync(EVALUATE_OUT, JSON.stringify(toEvaluateCatalogue(out), null, 2) + "\n");
    console.log(`\nWrote the evaluate catalogue → ${EVALUATE_OUT}`);
    console.log(`  pnpm exec catalog-concierge evaluate ${EVALUATE_OUT} --store "${STORE_NAME}" --currency ${TARGET_CURRENCY} --dry   (after pnpm --filter catalog-concierge build)`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
