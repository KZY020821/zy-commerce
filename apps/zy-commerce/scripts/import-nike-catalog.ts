/**
 * Imports Nike basketball products into a seed file the platform can load for
 * a demo tenant.
 *
 *   pnpm tsx scripts/import-nike-catalog.ts            # → prisma/seed-data/nike.json
 *
 * Source: the JSON that nike.com embeds in its own pages (`__NEXT_DATA__`) —
 * the category/search "product wall" for the listing, then each product's
 * detail page for specifications, sizes and images. No private API, no auth.
 *
 * Only factual catalogue data is taken (names, style codes, prices, colours,
 * sizes, materials, taxonomy, image URLs). Nike's narrative marketing copy is
 * never reproduced: descriptions are generated here from the extracted facts,
 * and images are referenced on Nike's own CDN rather than copied.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SeedCatalog, SeedProduct, SeedVariant } from "../prisma/seed-data/types";

const OUT = "prisma/seed-data/nike.json";
const CACHE_DIR = path.join("node_modules", ".cache", "zy-import", "nike");
const CONCURRENCY = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

// ---------------------------------------------------------------------------
// Nike page-data shapes (the subset we read)
// ---------------------------------------------------------------------------
interface WallProduct {
  productCode: string;
  productType: string;
  copy?: { title?: string; subTitle?: string };
  displayColors?: { colorDescription?: string; simpleColor?: { label?: string } };
  prices?: { currency?: string; currentPrice?: number; initialPrice?: number; discountPercentage?: number };
  colorwayImages?: { squarishURL?: string; portraitURL?: string };
  pdpUrl?: { url?: string; path?: string };
}

interface PdpSize {
  label?: string;
  localizedLabel?: string;
  status?: string;
}

interface PdpSelectedProduct {
  styleColor?: string;
  colorDescription?: string;
  productType?: string;
  genders?: string[];
  sportTags?: string[];
  brands?: string[];
  taxonomyLabels?: Record<string, string[]>;
  fitRecommendationMessage?: string;
  sizeChartUrl?: string;
  sizes?: PdpSize[];
  prices?: { currency?: string; currentPrice?: number; initialPrice?: number; discountPercentage?: number };
  productInfo?: {
    title?: string;
    subtitle?: string;
    fullTitle?: string;
    productDescription?: string;
    sizeFitSections?: string[];
    featuresAndBenefits?: { header?: string; body?: string[] }[];
    productDetails?: { header?: string; body?: string[] }[];
  };
  contentImages?: { properties?: { altText?: string; squarish?: { url?: string }; portrait?: { url?: string } } }[];
}

/** One listing page to pull from: either a category path or a search query. */
interface Source {
  label: string;
  url: string;
  /** Maximum products to keep from this source (after de-duplication). */
  limit: number;
}

const SOURCES: Source[] = [
  { label: "basketball shoes", url: "https://www.nike.com/w/basketball-shoes-3glsmzy7ok", limit: 34 },
  { label: "basketball (all)", url: "https://www.nike.com/w?q=basketball", limit: 22 },
  { label: "basketball jerseys", url: "https://www.nike.com/w?q=basketball+jersey", limit: 14 },
  { label: "basketball shorts", url: "https://www.nike.com/w?q=basketball+shorts", limit: 14 },
  { label: "basketball hoodies", url: "https://www.nike.com/w?q=basketball+hoodie", limit: 12 },
  { label: "basketball socks", url: "https://www.nike.com/w?q=basketball+socks", limit: 8 },
];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const CATEGORY_DEFS: { slug: string; name: string; description: string; match: (title: string, sub: string, type: string) => boolean }[] = [
  { slug: "basketball-shoes", name: "Basketball Shoes", description: "On-court basketball footwear for every position and playing style.", match: (t, s, type) => type === "FOOTWEAR" && /basketball|shoe/i.test(`${t} ${s}`) },
  { slug: "shoes", name: "Other Shoes", description: "Off-court and training footwear.", match: (_t, _s, type) => type === "FOOTWEAR" },
  { slug: "jerseys", name: "Jerseys", description: "NBA and team jerseys in Icon, Association and Statement editions.", match: (t, s) => /jersey/i.test(`${t} ${s}`) },
  { slug: "shorts", name: "Shorts", description: "Basketball shorts built for movement and breathability.", match: (t, s) => /short/i.test(`${t} ${s}`) },
  // Socks before the hoodie rule: "Cushioned Crew Socks" must not match "crew".
  { slug: "socks", name: "Socks", description: "Cushioned crew and quarter socks for the court.", match: (t, s) => /sock/i.test(`${t} ${s}`) },
  { slug: "hoodies-jackets", name: "Hoodies & Jackets", description: "Warm-ups, hoodies and jackets for on and off the court.", match: (t, s) => /hoodie|jacket|pullover|crew\s*neck|crewneck|sweatshirt|warm-?up/i.test(`${t} ${s}`) },
  { slug: "tops", name: "Tops", description: "Tees, tanks and shooting shirts.", match: (t, s, type) => type === "APPAREL" && /tee|t-shirt|top|tank|shirt|crew/i.test(`${t} ${s}`) },
  { slug: "basketballs", name: "Basketballs", description: "Indoor and outdoor basketballs.", match: (t, s) => /\bbasketball\b/i.test(`${t} ${s}`) && !/shoe|short|jersey|sock|hoodie|bag/i.test(`${t} ${s}`) },
  { slug: "accessories", name: "Accessories", description: "Bags, sleeves, headbands and other court gear.", match: () => true },
];

function categorize(title: string, subtitle: string, productType: string): string {
  for (const def of CATEGORY_DEFS) if (def.match(title, subtitle, productType)) return def.slug;
  return "accessories";
}

// ---------------------------------------------------------------------------
// Helpers
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
  if (h < 10) return 0; // ~10% sold out, so stock states are visible in the demo
  if (h < 24) return 1 + hashInt(`${key}low`, 5);
  return 6 + hashInt(`${key}stock`, 40);
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, attempt = 1): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, accept: "text/html,application/json" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return fetchText(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** Pages are cached on disk so re-runs don't hammer nike.com. */
async function fetchCached(url: string, key: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.html`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const html = await fetchText(url);
  writeFileSync(file, html);
  return html;
}

function nextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ on page");
  return JSON.parse(m[1]!);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
        await new Promise((r) => setTimeout(r, 350));
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Spec extraction
// ---------------------------------------------------------------------------
const SPEC_LINE = /^([A-Z][A-Za-z0-9 /()&'’.-]{1,30}):\s*(.{1,120})$/;

/**
 * Nike's "Product Details" bullets mix labelled facts ("Style: IH1117-300")
 * with bare material lines ("Foam midsole"). Labelled lines become their own
 * spec; bare lines are collected into a single "Materials & Build" spec.
 */
function specsFromDetails(bullets: string[]): { specs: Record<string, string>; build: string[] } {
  const specs: Record<string, string> = {};
  const build: string[] = [];
  for (const raw of bullets) {
    const line = stripHtml(raw);
    if (!line) continue;
    const m = line.match(SPEC_LINE);
    if (m) specs[m[1]!.trim()] = m[2]!.trim();
    else build.push(line);
  }
  return { specs, build };
}

/** Pulls named technologies out of Nike's benefit bullets (facts, not the prose). */
const TECH_PATTERNS = [
  /\b(Air Zoom(?: Strobel| Turbo)?)\b/gi, /\b(Zoom Air)\b/gi, /\b(Cushlon(?: \d+(?:\.\d+)?)?)\b/gi,
  /\b(React(?:X)? foam)\b/gi, /\b(ZoomX)\b/gi, /\b(Dri-FIT(?: ADV)?)\b/gi, /\b(Flyknit)\b/gi,
  /\b(Flywire)\b/gi, /\b(Air Max)\b/gi, /\b(TPU)\b/gi, /\b(Therma-FIT)\b/gi, /\b(Nike Air)\b/gi,
];

function technologiesFrom(text: string): string[] {
  const found = new Set<string>();
  for (const re of TECH_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const v = m[1]!.trim();
      found.add(v.charAt(0).toUpperCase() + v.slice(1));
    }
  }
  return [...found].slice(0, 6);
}

const CATEGORY_BLURB: Record<string, string> = {
  "basketball-shoes": "Nike basketball shoe.",
  shoes: "Nike shoe.",
  jerseys: "Nike basketball jersey.",
  shorts: "Nike basketball shorts.",
  "hoodies-jackets": "Nike basketball layer.",
  tops: "Nike basketball top.",
  basketballs: "Nike basketball.",
  socks: "Nike performance socks.",
  accessories: "Nike basketball accessory.",
};

function describe(category: string, specs: Record<string, string>, build: string[], tech: string[], sizes: string[]): string {
  const parts: string[] = [CATEGORY_BLURB[category] ?? "Nike product."];
  const keySpecs = ["Colour", "Sport", "Gender", "Product Type", "Fit"]
    .filter((k) => specs[k])
    .map((k) => `${k.toLowerCase()} ${specs[k]}`);
  if (keySpecs.length) parts.push(`Key specs: ${keySpecs.join(", ")}.`);
  if (build.length) parts.push(`Build: ${build.slice(0, 4).join(", ")}.`);
  if (tech.length) parts.push(`Nike technology: ${tech.join(", ")}.`);
  if (sizes.length) parts.push(`Available sizes: ${sizes.slice(0, 12).join(", ")}${sizes.length > 12 ? "…" : ""}.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // 1. Collect the listing across every source, de-duplicating by model.
  const picked: { wall: WallProduct; category: string }[] = [];
  const seenModel = new Set<string>();

  for (const source of SOURCES) {
    let html: string;
    try {
      html = await fetchCached(source.url, `wall-${slugify(source.label)}`);
    } catch (e) {
      console.warn(`  ! ${source.label}: ${(e as Error).message}`);
      continue;
    }
    const data = nextData(html) as { props?: { pageProps?: { initialState?: { Wall?: { productGroupings?: { products?: WallProduct[] }[] } } } } };
    const products = (data.props?.pageProps?.initialState?.Wall?.productGroupings ?? []).flatMap((g) => g.products ?? []);
    let kept = 0;
    for (const p of products) {
      if (kept >= source.limit) break;
      const title = p.copy?.title?.trim();
      const subtitle = p.copy?.subTitle?.trim() ?? "";
      const price = p.prices?.currentPrice;
      if (!title || !p.productCode || !p.pdpUrl?.url || !price || price <= 0) continue;
      // One entry per model — Nike lists each colourway separately.
      const modelKey = `${title} ${subtitle}`.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (seenModel.has(modelKey)) continue;
      seenModel.add(modelKey);
      picked.push({ wall: p, category: categorize(title, subtitle, p.productType) });
      kept++;
    }
    console.log(`✓ ${source.label}: ${products.length} listed, ${kept} kept`);
  }
  console.log(`\nFetching ${picked.length} product pages for specs (concurrency ${CONCURRENCY}) …`);

  // 2. Fetch each product page for specifications, sizes and images.
  let done = 0;
  const pages = await mapPool(picked, CONCURRENCY, async ({ wall }) => {
    try {
      const html = await fetchCached(wall.pdpUrl!.url!, `pdp-${wall.productCode}`);
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${picked.length}`);
      return html;
    } catch (e) {
      console.warn(`  ! ${wall.productCode}: ${(e as Error).message}`);
      return "";
    }
  });

  // 3. Build the seed products.
  const products: SeedProduct[] = [];
  const seenSlugs = new Set<string>();
  const seenSkus = new Set<string>();
  let withSpecs = 0;

  picked.forEach(({ wall, category }, idx) => {
    const html = pages[idx];
    let sp: PdpSelectedProduct = {};
    let colorways: { colorDescription?: string }[] = [];
    if (html) {
      try {
        const d = nextData(html) as { props?: { pageProps?: { selectedProduct?: PdpSelectedProduct; colorwayImages?: { colorDescription?: string }[] } } };
        sp = d.props?.pageProps?.selectedProduct ?? {};
        colorways = d.props?.pageProps?.colorwayImages ?? [];
      } catch {
        /* fall back to wall data only */
      }
    }

    const info = sp.productInfo ?? {};
    const title = info.fullTitle?.trim() || `${wall.copy?.title ?? ""} ${wall.copy?.subTitle ?? ""}`.trim();
    const styleColor = sp.styleColor || wall.productCode;

    // --- specs -------------------------------------------------------------
    const { specs, build } = specsFromDetails((info.productDetails ?? []).flatMap((d) => d.body ?? []));
    const colour = sp.colorDescription || wall.displayColors?.colorDescription;
    if (colour) specs["Colour"] = colour;
    specs["Style Code"] = styleColor;
    for (const [k, v] of Object.entries(sp.taxonomyLabels ?? {})) {
      if (Array.isArray(v) && v.length) specs[k === "Sports" ? "Sport" : k] = v.join(", ");
    }
    if (sp.genders?.length && !specs["Gender"]) specs["Gender"] = sp.genders.map((g) => g.charAt(0) + g.slice(1).toLowerCase()).join(", ");
    const fit = [...(info.sizeFitSections ?? []), sp.fitRecommendationMessage ?? ""].map(stripHtml).filter(Boolean);
    if (fit.length) specs["Fit"] = fit[0]!.slice(0, 120);
    if (build.length) specs["Materials & Build"] = build.slice(0, 4).join(", ");
    const tech = technologiesFrom([info.productDescription ?? "", ...(info.featuresAndBenefits ?? []).flatMap((f) => f.body ?? [])].join(" "));
    if (tech.length) specs["Nike Technology"] = tech.join(", ");
    const colourOptions = [...new Set(colorways.map((c) => c.colorDescription).filter((c): c is string => Boolean(c)))];
    if (colourOptions.length > 1) specs["Available Colours"] = colourOptions.slice(0, 8).join(", ");

    const sizeRows = (sp.sizes ?? []).filter((s) => s.label);
    const sizeLabels = sizeRows.map((s) => s.label!);
    if (sizeLabels.length) specs["Available Sizes"] = sizeLabels.join(", ");
    if (sp.sizeChartUrl) specs["Size Guide"] = sp.sizeChartUrl.replace(/^https?:\/\/[^/]+/, "nike.com");
    if (Object.keys(specs).length > 2) withSpecs++;

    // --- identity ----------------------------------------------------------
    let sku = styleColor;
    while (seenSkus.has(sku)) sku = `${styleColor}-${idx}`;
    seenSkus.add(sku);
    let slug = slugify(title) || slugify(sku);
    while (seenSlugs.has(slug)) slug = `${slug}-${slugify(styleColor)}`;
    seenSlugs.add(slug);

    // --- price (USD, minor units) -----------------------------------------
    const currentPrice = sp.prices?.currentPrice ?? wall.prices?.currentPrice ?? 0;
    const price = Math.round(currentPrice * 100);

    // --- variants: one per size -------------------------------------------
    const variants: SeedVariant[] | undefined = sizeRows.length
      ? sizeRows.map((s, i) => {
          const vsku = `${sku}-${s.label!.replace(/[^A-Za-z0-9.]/g, "")}`;
          return {
            sku: seenSkus.has(vsku) ? `${vsku}-${i}` : vsku,
            name: s.localizedLabel?.trim() || s.label!,
            attributes: { Size: s.label!, ...(s.localizedLabel && s.localizedLabel !== s.label ? { "Size (US)": s.localizedLabel } : {}) },
            stockQuantity: stockFor(vsku, (s.status ?? "ACTIVE") === "ACTIVE"),
          };
        })
      : undefined;
    for (const v of variants ?? []) seenSkus.add(v.sku);

    // --- images ------------------------------------------------------------
    const fromContent = (sp.contentImages ?? [])
      .map((c) => c.properties?.squarish?.url ?? c.properties?.portrait?.url)
      .filter((u): u is string => Boolean(u));
    const fallback = [wall.colorwayImages?.squarishURL, wall.colorwayImages?.portraitURL].filter((u): u is string => Boolean(u));
    const images = [...new Set([...fallback, ...fromContent])].slice(0, 6).map((url, i) => ({ url, alt: i === 0 ? title : `${title} – view ${i + 1}` }));

    products.push({
      sku,
      slug,
      name: title,
      brand: sp.brands?.[0] ?? "Nike",
      category,
      description: describe(category, specs, build, tech, sizeLabels),
      price,
      specs,
      stockQuantity: variants ? variants.reduce((n, v) => n + v.stockQuantity, 0) : stockFor(sku, true),
      lowStockThreshold: 5,
      images,
      ...(variants ? { variants } : {}),
      source: {
        url: wall.pdpUrl!.url!,
        handle: styleColor,
        originalPrice: String(currentPrice),
        originalCurrency: sp.prices?.currency ?? wall.prices?.currency ?? "USD",
        productType: wall.productType,
        tags: [...(sp.sportTags ?? []), ...(sp.genders ?? [])],
      },
    });
  });

  const usedCategories = CATEGORY_DEFS.filter((c) => products.some((p) => p.category === c.slug));
  const out: SeedCatalog = {
    generatedAt: new Date().toISOString(),
    source: { store: "www.nike.com", storeName: "Nike", feedUrl: "https://www.nike.com/w/basketball-shoes-3glsmzy7ok", currency: "USD" },
    pricing: { currency: "USD", rate: 1, rateSource: "nike.com US list prices (no conversion)" },
    categories: usedCategories.map((c, i) => ({ slug: c.slug, name: c.name, description: c.description, sortOrder: i })),
    products,
  };

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  const variantCount = products.reduce((n, p) => n + (p.variants?.length ?? 0), 0);
  console.log(`\nWrote ${products.length} products (${withSpecs} with specs, ${variantCount} variants) in ${usedCategories.length} categories → ${OUT}`);
  for (const c of usedCategories) console.log(`  ${c.name}: ${products.filter((p) => p.category === c.slug).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
