/**
 * Tools the assistant can call, in OpenAI-compatible function-calling shape
 * (DeepSeek's `tools` parameter matches this exactly — see
 * https://api-docs.deepseek.com/guides/tool_calls). Every query goes through
 * the tenant-scoped client, so the model can only ever see the current
 * store's products. Results are compact JSON strings sized for the model,
 * not full rows.
 */
import type OpenAI from "openai";
import type { TenantDb } from "@/lib/db/tenant-client";
import { formatMoney } from "@/lib/money";
import { STOCK_LABELS, stockStatus } from "@/lib/catalog/stock";

export interface ToolContext {
  db: TenantDb;
  currency: string;
  locale: string;
}

const MAX_RESULTS = 8;

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
        "Search the store's catalogue. Matches product names, brands, descriptions and specification values. Filter by category slug, price range (in the store currency, major units) and stock. Returns up to 8 compact matches with price, stock and key specs. Call it more than once with different queries when the first search is too narrow.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text keywords, e.g. '16mm control paddle' or 'women shoe size 8'. Use an empty string to browse a category." },
          category: { type: ["string", "null"], description: "Category slug from list_categories, or null for all." },
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
      description: "Get full details for one product by SKU or slug: description, every specification, all variants with their attributes, prices and stock. Use before recommending or comparing so every claim is backed by data.",
      parameters: {
        type: "object",
        properties: { skuOrSlug: { type: "string" } },
        required: ["skuOrSlug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_products",
      description: "Side-by-side specifications for 2–4 products (by SKU or slug). Use when the customer is choosing between options.",
      parameters: {
        type: "object",
        properties: { skusOrSlugs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } },
        required: ["skusOrSlugs"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "respond",
      description:
        "Deliver your reply to the customer. ALWAYS finish your turn by calling this tool exactly once. `answer` is the message shown to the customer (plain text, short paragraphs, may use simple bullet points). `suggestions` are 2–4 short things the customer might tap next — either answers to the question you just asked, or natural next steps. `productSkus` lists the SKUs of products you mentioned so they can be shown as cards, most relevant first (empty if none).",
      parameters: {
        type: "object",
        properties: {
          answer: { type: "string" },
          suggestions: { type: "array", items: { type: "string" }, maxItems: 4 },
          productSkus: { type: "array", items: { type: "string" }, maxItems: 4 },
        },
        required: ["answer", "suggestions", "productSkus"],
        additionalProperties: false,
      },
    },
  },
];

export type AssistantToolName = "list_categories" | "search_products" | "get_product" | "compare_products" | "respond";

type Specs = Record<string, unknown> | null;

function specsToRecord(specs: Specs): Record<string, string> {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return {};
  return Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, String(v)]));
}

function tokenize(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length >= 2).slice(0, 8);
}

export async function runAssistantTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const money = (minor: number) => formatMoney(minor, ctx.currency, ctx.locale);
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  switch (name) {
    case "list_categories": {
      const cats = await ctx.db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: { where: { active: true } } } } } });
      return JSON.stringify(cats.map((c) => ({ slug: c.slug, name: c.name, description: c.description, products: c._count.products })));
    }

    case "search_products": {
      const query = String(args.query ?? "");
      const category = typeof args.category === "string" && args.category ? args.category : null;
      const minPrice = typeof args.minPrice === "number" ? Math.round(args.minPrice * 100) : null;
      const maxPrice = typeof args.maxPrice === "number" ? Math.round(args.maxPrice * 100) : null;
      const inStockOnly = Boolean(args.inStockOnly);
      const terms = tokenize(query);

      // Structured filters run in SQL; keyword matching runs in memory so spec
      // values (JSON) count too. Catalogues here are hundreds to a few thousand
      // rows, so scanning the candidate set is cheap and stays tenant-scoped.
      const rows = await ctx.db.product.findMany({
        where: {
          active: true,
          // Accept the slug in any case, and also the category's display name — a
          // model without deep reasoning will sometimes pass "Paddles" (the name
          // shown in the catalogue overview) instead of "paddles" (the slug).
          ...(category ? { category: { OR: [{ slug: { equals: category, mode: "insensitive" } }, { name: { equals: category, mode: "insensitive" } }] } } : {}),
          ...(minPrice !== null || maxPrice !== null ? { price: { ...(minPrice !== null ? { gte: minPrice } : {}), ...(maxPrice !== null ? { lte: maxPrice } : {}) } } : {}),
          ...(inStockOnly ? { stockQuantity: { gt: 0 } } : {}),
        },
        include: { category: { select: { name: true, slug: true } } },
        take: 2000,
      });

      // Rank: term hits in name > brand/sku > specs > description; then price asc.
      const scored = rows.map((p) => {
        const specText = Object.entries(specsToRecord(p.specs as Specs)).map(([k, v]) => `${k} ${v}`).join(" ").toLowerCase();
        const name = p.name.toLowerCase(), brand = (p.brand ?? "").toLowerCase(), desc = (p.description ?? "").toLowerCase(), sku = p.sku.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (name.includes(t)) score += 5;
          if (brand.includes(t) || sku.includes(t)) score += 3;
          if (specText.includes(t)) score += 2;
          if (desc.includes(t)) score += 1;
        }
        return { p, score };
      });
      const filtered = terms.length ? scored.filter((s) => s.score > 0) : scored;
      filtered.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
      const top = filtered.slice(0, MAX_RESULTS).map(({ p }) => {
        const specs = specsToRecord(p.specs as Specs);
        const keySpecs = Object.fromEntries(Object.entries(specs).slice(0, 6));
        return {
          sku: p.sku, slug: p.slug, name: p.name, brand: p.brand, category: p.category?.name ?? null,
          price: money(p.price), priceFrom: p.hasVariants, stock: STOCK_LABELS[stockStatus(p.stockQuantity, p.lowStockThreshold)],
          specs: keySpecs,
        };
      });
      return JSON.stringify({ total: filtered.length, showing: top.length, products: top });
    }

    case "get_product": {
      const key = String(args.skuOrSlug ?? "").trim();
      const p = await ctx.db.product.findFirst({
        where: { active: true, OR: [{ sku: { equals: key, mode: "insensitive" } }, { slug: key.toLowerCase() }] },
        include: { category: { select: { name: true, slug: true } }, images: { orderBy: { sortOrder: "asc" }, take: 1 }, variants: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
      });
      if (!p) return JSON.stringify({ error: `No product matches "${key}". Use search_products to find the right SKU.` });
      return JSON.stringify({
        sku: p.sku, slug: p.slug, name: p.name, brand: p.brand, category: p.category?.name ?? null,
        price: money(p.price), priceFrom: p.hasVariants, description: p.description,
        stock: STOCK_LABELS[stockStatus(p.stockQuantity, p.lowStockThreshold)], stockQuantity: p.stockQuantity,
        specs: specsToRecord(p.specs as Specs),
        variants: p.variants.map((v) => ({ sku: v.sku, name: v.name, attributes: specsToRecord(v.attributes as Specs), price: money(v.priceOverride ?? p.price), stock: STOCK_LABELS[stockStatus(v.stockQuantity, p.lowStockThreshold)] })),
      });
    }

    case "compare_products": {
      const keys = Array.isArray(args.skusOrSlugs) ? (args.skusOrSlugs as unknown[]).map(String).slice(0, 4) : [];
      const rows = await ctx.db.product.findMany({
        where: { active: true, OR: keys.flatMap((k) => [{ sku: { equals: k, mode: "insensitive" as const } }, { slug: k.toLowerCase() }]) },
        include: { category: { select: { name: true } } },
      });
      const allKeys = [...new Set(rows.flatMap((p) => Object.keys(specsToRecord(p.specs as Specs))))];
      return JSON.stringify({
        products: rows.map((p) => ({ sku: p.sku, name: p.name, brand: p.brand, category: p.category?.name ?? null, price: money(p.price), stock: STOCK_LABELS[stockStatus(p.stockQuantity, p.lowStockThreshold)] })),
        specs: allKeys.map((k) => ({ key: k, values: Object.fromEntries(rows.map((p) => [p.sku, specsToRecord(p.specs as Specs)[k] ?? "—"])) })),
        missing: keys.filter((k) => !rows.some((p) => p.sku.toLowerCase() === k.toLowerCase() || p.slug === k.toLowerCase())),
      });
    }

    case "respond":
      // Handled by the loop; never executed as a tool.
      return JSON.stringify({ ok: true });

    default:
      return JSON.stringify({ error: `Unknown tool ${name}` });
  }
}
