/**
 * Builds a compact, product-type-agnostic summary of a tenant's catalogue:
 * which categories exist, their price ranges, and which structured spec keys
 * differentiate products inside each category (with sample values or numeric
 * ranges). The assistant uses it to decide what clarifying question to ask
 * next, whatever the store sells — paddles today, coffee machines tomorrow.
 *
 * Pure function over plain rows so it can be unit-tested without a database.
 */

export interface ProfileProductRow {
  categorySlug: string | null;
  categoryName: string | null;
  price: number;
  brand: string | null;
  specs: Record<string, unknown> | null;
  active: boolean;
}

export interface SpecFacet {
  key: string;
  /** How many products in the category carry this key. */
  coverage: number;
  /** Distinct values (max 8) when values are categorical. */
  values?: string[];
  /** Min/max when values parse as numbers (unit kept from the first value). */
  range?: { min: number; max: number; unit: string };
}

export interface CategoryProfile {
  slug: string;
  name: string;
  productCount: number;
  priceMin: number;
  priceMax: number;
  brands: string[];
  facets: SpecFacet[];
}

export interface CatalogProfile {
  productCount: number;
  categories: CategoryProfile[];
}

const MAX_FACETS = 10;
const MAX_VALUES = 8;
const NUMERIC = /^\s*(-?\d+(?:\.\d+)?)\s*(?:-\s*(-?\d+(?:\.\d+)?))?\s*([a-zA-Z"”'’%]*)/;

function parseNumeric(v: string): { lo: number; hi: number; unit: string } | null {
  const m = v.match(NUMERIC);
  if (!m) return null;
  const rest = v.slice(m[0].length).trim();
  if (rest.length > 12) return null; // long tail means it's a sentence, not a measurement
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return { lo, hi, unit: m[3] ?? "" };
}

interface KeyStat {
  count: number;
  values: Map<string, number>;
  numeric: { lo: number; hi: number; unit: string }[];
}

export function buildCatalogProfile(rows: ProfileProductRow[]): CatalogProfile {
  const active = rows.filter((r) => r.active);
  const byCategory = new Map<string, ProfileProductRow[]>();
  for (const r of active) {
    const key = r.categorySlug ?? "uncategorised";
    byCategory.set(key, [...(byCategory.get(key) ?? []), r]);
  }

  const categories: CategoryProfile[] = [];
  for (const [slug, items] of byCategory) {
    const prices = items.map((i) => i.price);
    const keyStats = new Map<string, KeyStat>();
    for (const item of items) {
      const specs = item.specs && typeof item.specs === "object" ? item.specs : {};
      for (const [k, raw] of Object.entries(specs)) {
        if (raw === null || raw === undefined) continue;
        const v = String(raw).trim();
        if (!v) continue;
        const s: KeyStat = keyStats.get(k) ?? { count: 0, values: new Map<string, number>(), numeric: [] };
        s.count++;
        s.values.set(v, (s.values.get(v) ?? 0) + 1);
        const n = parseNumeric(v);
        if (n) s.numeric.push(n);
        keyStats.set(k, s);
      }
    }
    const facets: SpecFacet[] = [...keyStats.entries()]
      .filter(([, s]) => s.count >= 2 && s.values.size >= 2) // only keys that vary — those drive follow-up questions
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, MAX_FACETS)
      .map(([key, s]) => {
        const facet: SpecFacet = { key, coverage: s.count };
        if (s.numeric.length === s.count && s.values.size > 3) {
          facet.range = { min: Math.min(...s.numeric.map((n) => n.lo)), max: Math.max(...s.numeric.map((n) => n.hi)), unit: s.numeric[0]!.unit };
        } else {
          facet.values = [...s.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VALUES).map(([v]) => v.length > 40 ? `${v.slice(0, 37)}…` : v);
        }
        return facet;
      });
    categories.push({
      slug,
      name: items[0]?.categoryName ?? slug,
      productCount: items.length,
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      brands: [...new Set(items.map((i) => i.brand).filter((b): b is string => Boolean(b)))].slice(0, 6),
      facets,
    });
  }
  categories.sort((a, b) => b.productCount - a.productCount);
  return { productCount: active.length, categories };
}

/** Renders the profile as compact text for the system prompt. */
export function renderCatalogProfile(profile: CatalogProfile, currency: string, format: (minor: number) => string): string {
  const lines: string[] = [`Catalogue: ${profile.productCount} active products in ${profile.categories.length} categories (prices in ${currency}).`];
  for (const c of profile.categories) {
    lines.push(`- ${c.name} (${c.productCount} products, ${format(c.priceMin)}–${format(c.priceMax)}${c.brands.length ? `, brands: ${c.brands.join(", ")}` : ""})`);
    for (const f of c.facets) {
      const desc = f.range ? `${f.range.min}–${f.range.max}${f.range.unit ? " " + f.range.unit : ""}` : (f.values ?? []).join(" | ");
      lines.push(`    • ${f.key}: ${desc}`);
    }
  }
  return lines.join("\n");
}
