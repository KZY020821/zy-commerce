/**
 * Reusing a catalogue snapshot between messages.
 *
 * By default there is no cache: `listCatalogue()` runs for every message, so
 * the assistant can never answer from data older than the question — which is
 * the right trade for a few thousand products and the reason it is the
 * default.
 *
 * Past that it stops being free. A shop with 50,000 products pays for that
 * read on every turn, and the rows have almost certainly not changed between
 * one customer's messages. A host that knows this opts in, chooses how stale
 * it is willing to be, and can drop the snapshot the moment its catalogue
 * changes.
 */
import type { CatalogAdapter, CatalogueProduct } from "./types";

export interface CatalogueCacheOptions {
  /**
   * What the snapshot belongs to — one store, usually its id. Never share a
   * key between tenants: it is the only thing keeping their catalogues apart.
   */
  key: string;
  /** How stale an answer may be. Default one minute. */
  ttlMs?: number;
}

export const DEFAULT_CACHE_TTL_MS = 60_000;

/**
 * How many stores are kept at once. A cache is a convenience, not a store:
 * the oldest entry goes rather than letting this grow without a ceiling.
 */
const MAX_ENTRIES = 32;

interface Entry {
  catalogue: CatalogueProduct[];
  expires: number;
}

const snapshots = new Map<string, Entry>();

/** The catalogue for this turn, from the cache when the host asked for one. */
export async function loadCatalogue(adapter: CatalogAdapter, options?: CatalogueCacheOptions, now: number = Date.now()): Promise<CatalogueProduct[]> {
  if (!options?.key) return adapter.listCatalogue();

  const cached = snapshots.get(options.key);
  if (cached && cached.expires > now) {
    // Most recently used goes last, so eviction takes the coldest entry.
    snapshots.delete(options.key);
    snapshots.set(options.key, cached);
    return cached.catalogue;
  }

  const catalogue = await adapter.listCatalogue();
  snapshots.set(options.key, { catalogue, expires: now + (options.ttlMs ?? DEFAULT_CACHE_TTL_MS) });
  while (snapshots.size > MAX_ENTRIES) {
    const oldest = snapshots.keys().next();
    if (oldest.done) break;
    snapshots.delete(oldest.value);
  }
  return catalogue;
}

/**
 * Forgets a store's snapshot, or every store's.
 *
 * Call it when the catalogue changes — a product saved, an import finished —
 * and a long TTL becomes safe: the only way to be both cheap and current.
 */
export function invalidateCatalogue(key?: string): void {
  if (key === undefined) snapshots.clear();
  else snapshots.delete(key);
}

/** How many snapshots are held. For tests and for a host's own diagnostics. */
export function cachedCatalogues(): number {
  return snapshots.size;
}
