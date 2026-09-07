/**
 * The four things the assistant can do with a catalogue, plus the `respond`
 * call that ends its turn.
 *
 * These run against the in-memory snapshot returned by
 * `CatalogAdapter.listCatalogue()`, not a database. That keeps the host's
 * integration to two methods, means search sees exactly what the store map
 * saw, and makes every tool testable without any infrastructure.
 *
 * Tool schemas are OpenAI-compatible function definitions, which is what
 * DeepSeek, OpenAI, Groq, Together and most local runtimes all accept.
 */
import type OpenAI from "openai";
import { formatMoney, specsToRecord, stockLabel } from "./format";
import type { CatalogAdapter, CatalogueProduct, StoreProfile } from "./types";

/** What the tool executor needs: the store's snapshot and how to fetch detail. */
export interface ToolContext {
  adapter: CatalogAdapter;
  /** The snapshot already loaded for this message — never re-fetched per tool call. */
  catalogue: CatalogueProduct[];
  store: StoreProfile;
}

const MAX_RESULTS = 8;
const MAX_SPECS_IN_SUMMARY = 6;

export const assistantTools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "list_categories",
      description: "List the store's product categories with product counts. Use when you need to know what the store sells.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the store's catalogue. Matches product names, brands, descriptions and specification values. Filter by category, price range (in the store currency, major units) and stock. Returns up to 8 compact matches with price, stock and key specs. Call it more than once with different queries when the first search is too narrow.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text keywords, e.g. '16mm control paddle' or 'women shoe size 8'. Use an empty string to browse a category." },
          category: { type: ["string", "null"], description: "Category slug or name from list_categories, or null for all." },
          minPrice: { type: ["number", "null"], description: "Minimum price in major currency units, or null." },
          maxPrice: { type: ["number", "null"], description: "Maximum price in major currency units, or null." },
          inStockOnly: { type: "boolean", description: "Only return products that can be bought right now." },
        },
        required: ["query", "category", "minPrice", "maxPrice", "inStockOnly"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description: "Get full details for one product by its reference (SKU): description, every specification, and all variants with their prices and stock. Use before recommending or comparing so every claim is backed by data.",
      parameters: {
        type: "object",
        properties: { ref: { type: "string", description: "The product reference (SKU) exactly as returned by search_products." } },
        required: ["ref"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_products",
      description: "Side-by-side specifications for 2–4 products by reference (SKU). Use when the customer is choosing between options.",
      parameters: {
        type: "object",
        properties: { refs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } },
        required: ["refs"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "respond",
      description:
        "Deliver your reply to the customer. ALWAYS finish your turn by calling this tool exactly once. `answer` is the message shown to the customer (plain text, short paragraphs, may use simple bullet points). `suggestions` are 2–4 short things the customer might tap next — either answers to the question you just asked, or natural next steps. `productRefs` lists the references of products you mentioned so they can be shown as cards, most relevant first (empty if none).",
      parameters: {
        type: "object",
        properties: {
          answer: { type: "string" },
          suggestions: { type: "array", items: { type: "string" }, maxItems: 4 },
          productRefs: { type: "array", items: { type: "string" }, maxItems: 4 },
        },
        required: ["answer", "suggestions", "productRefs"],
        additionalProperties: false,
      },
    },
  },
];

export type AssistantToolName = "list_categories" | "search_products" | "get_product" | "compare_products" | "respond";

function tokenize(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length >= 2).slice(0, 8);
}

/** Matches a category by slug or display name, case-insensitively. */
function categoryMatches(product: CatalogueProduct, wanted: string): boolean {
  const c = product.category;
  if (!c) return false;
  const w = wanted.trim().toLowerCase();
  return c.slug.toLowerCase() === w || c.name.toLowerCase() === w;
}

export interface SearchFilters {
  query: string;
  category: string | null;
  /** Major currency units, as a customer would say them. */
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
}

/**
 * Filters then ranks the catalogue. Exported so hosts and tests can exercise
 * the exact ranking the model sees.
 *
 * Ranking favours a hit in the name over the brand or reference, then a
 * specification value, then the description — so "16mm" finds products whose
 * specs say 16mm even when the name never mentions it.
 */
export function searchCatalogue(catalogue: CatalogueProduct[], filters: SearchFilters): CatalogueProduct[] {
  const minMinor = filters.minPrice === null ? null : Math.round(filters.minPrice * 100);
  const maxMinor = filters.maxPrice === null ? null : Math.round(filters.maxPrice * 100);
  const terms = tokenize(filters.query ?? "");

  const filtered = catalogue.filter((p) => {
    if (filters.category && !categoryMatches(p, filters.category)) return false;
    if (minMinor !== null && p.price < minMinor) return false;
    if (maxMinor !== null && p.price > maxMinor) return false;
    if (filters.inStockOnly && p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity <= 0) return false;
    return true;
  });

  if (terms.length === 0) return [...filtered].sort((a, b) => a.price - b.price);

  const scored = filtered.map((p) => {
    const name = p.name.toLowerCase();
    const brand = (p.brand ?? "").toLowerCase();
    const ref = p.ref.toLowerCase();
    const desc = (p.description ?? "").toLowerCase();
    const specText = Object.entries(specsToRecord(p.specs)).map(([k, v]) => `${k} ${v}`).join(" ").toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 5;
      if (brand.includes(t) || ref.includes(t)) score += 3;
      if (specText.includes(t)) score += 2;
      if (desc.includes(t)) score += 1;
    }
    return { p, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.p.price - b.p.price).map((s) => s.p);
}

/** Category counts derived from the snapshot — no extra adapter call needed. */
export function summariseCategories(catalogue: CatalogueProduct[]): { slug: string; name: string; products: number }[] {
  const byslug = new Map<string, { slug: string; name: string; products: number }>();
  for (const p of catalogue) {
    if (!p.category) continue;
    const row = byslug.get(p.category.slug) ?? { slug: p.category.slug, name: p.category.name, products: 0 };
    row.products++;
    byslug.set(p.category.slug, row);
  }
  return [...byslug.values()].sort((a, b) => b.products - a.products);
}

export async function runAssistantTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const money = (minor: number) => formatMoney(minor, ctx.store.currency, ctx.store.locale);
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const summarise = (p: CatalogueProduct) => ({
    ref: p.ref,
    name: p.name,
    brand: p.brand ?? null,
    category: p.category?.name ?? null,
    price: money(p.price),
    priceFrom: Boolean(p.priceFrom),
    stock: stockLabel(p),
    specs: Object.fromEntries(Object.entries(specsToRecord(p.specs)).slice(0, MAX_SPECS_IN_SUMMARY)),
  });

  switch (name) {
    case "list_categories":
      return JSON.stringify(summariseCategories(ctx.catalogue));

    case "search_products": {
      const matches = searchCatalogue(ctx.catalogue, {
        query: String(args.query ?? ""),
        category: typeof args.category === "string" && args.category ? args.category : null,
        minPrice: typeof args.minPrice === "number" ? args.minPrice : null,
        maxPrice: typeof args.maxPrice === "number" ? args.maxPrice : null,
        inStockOnly: Boolean(args.inStockOnly),
      });
      return JSON.stringify({ total: matches.length, showing: Math.min(matches.length, MAX_RESULTS), products: matches.slice(0, MAX_RESULTS).map(summarise) });
    }

    case "get_product": {
      const ref = String(args.ref ?? "").trim();
      const p = await ctx.adapter.getProduct(ref);
      if (!p) return JSON.stringify({ error: `No product matches "${ref}". Use search_products to find the right reference.` });
      return JSON.stringify({
        ...summarise(p),
        description: p.description ?? null,
        url: p.url ?? null,
        specs: specsToRecord(p.specs),
        stockQuantity: p.stockQuantity ?? null,
        variants: (p.variants ?? []).map((v) => ({
          ref: v.ref,
          name: v.name,
          attributes: specsToRecord(v.attributes),
          price: money(v.price),
          stock: stockLabel({ stockQuantity: v.stockQuantity, lowStockThreshold: p.lowStockThreshold }),
        })),
      });
    }

    case "compare_products": {
      const refs = Array.isArray(args.refs) ? (args.refs as unknown[]).map(String).slice(0, 4) : [];
      const found = (await Promise.all(refs.map((r) => ctx.adapter.getProduct(r)))).filter((p): p is NonNullable<typeof p> => Boolean(p));
      const allKeys = [...new Set(found.flatMap((p) => Object.keys(specsToRecord(p.specs))))];
      return JSON.stringify({
        products: found.map(summarise),
        specs: allKeys.map((k) => ({ key: k, values: Object.fromEntries(found.map((p) => [p.ref, specsToRecord(p.specs)[k] ?? "—"])) })),
        missing: refs.filter((r) => !found.some((p) => p.ref.toLowerCase() === r.toLowerCase())),
      });
    }

    case "respond":
      // Handled by the loop; never executed as a tool.
      return JSON.stringify({ ok: true });

    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}
