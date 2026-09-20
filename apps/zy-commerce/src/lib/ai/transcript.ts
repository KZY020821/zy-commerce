import "server-only";

/**
 * Turning this store's record of a conversation back into what the customer
 * saw.
 *
 * The assistant's memory lives on the server (see `chat-history.ts`), so after
 * a reload it still knows what was said while the screen shows nothing — and
 * it will happily answer "the first one" against an empty chat. These helpers
 * rebuild the visible side of that conversation, product cards included, from
 * the same row the model reads.
 */
import { toProductCard, type ProductCard, type RestoredMessage } from "catalog-concierge";
import type { TenantDb } from "@/lib/db/tenant-client";
import type { StoredTurn } from "./chat-history";

/** Exchanges put back on screen: six on each side, the same window the model gets. */
export const RESTORED_TURNS = 12;

/** Every product reference the restored turns mention, in first-seen order. */
export function referencedSkus(turns: StoredTurn[]): string[] {
  const skus: string[] = [];
  for (const turn of turns) {
    for (const sku of turn.productSkus ?? []) {
      if (sku && !skus.includes(sku)) skus.push(sku);
    }
  }
  return skus;
}

/**
 * The cards for those references, built by the package's own helper so a
 * restored card is identical to the one the reply drew.
 *
 * A product that has since been removed or deactivated simply has no card:
 * the sentence that named it stays, and nothing links to a dead page.
 */
export async function productCardsBySku(db: TenantDb, store: { currency: string; locale: string }, skus: string[]): Promise<Map<string, ProductCard>> {
  const cards = new Map<string, ProductCard>();
  if (skus.length === 0) return cards;

  const rows = await db.product.findMany({
    where: { active: true, sku: { in: skus } },
    include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  for (const p of rows) {
    cards.set(
      p.sku,
      toProductCard(
        {
          ref: p.sku,
          name: p.name,
          url: `/products/${p.slug}`,
          price: p.price,
          priceFrom: p.hasVariants,
          stockQuantity: p.stockQuantity,
          lowStockThreshold: p.lowStockThreshold,
          imageUrl: p.images[0]?.url ?? null,
        },
        store,
      ),
    );
  }
  return cards;
}

/** The stored turns as the widget renders them, oldest first. */
export function toRestoredMessages(turns: StoredTurn[], cards: Map<string, ProductCard>): RestoredMessage[] {
  return turns.map((turn) => {
    const products = (turn.productSkus ?? []).map((sku) => cards.get(sku)).filter((card): card is ProductCard => Boolean(card));
    return {
      role: turn.role,
      content: turn.content,
      ...(turn.suggestions?.length ? { suggestions: turn.suggestions } : {}),
      ...(products.length > 0 ? { products } : {}),
      ...(turn.rating ? { rating: turn.rating } : {}),
    };
  });
}

/**
 * The product slug of a storefront page, or null anywhere else.
 *
 * The browser tells us which page it is on, so nothing here is trusted: the
 * slug is only ever used to look a product up in this tenant's own catalogue,
 * and anything that is not a plain product path is ignored.
 */
const PRODUCT_PATH = /^\/products\/([a-z0-9][a-z0-9-]{0,120})$/;

export function productSlugFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const withoutQuery = path.trim().toLowerCase().split(/[?#]/)[0] ?? "";
  const match = PRODUCT_PATH.exec(withoutQuery.replace(/\/+$/, "") || "/");
  return match ? match[1]! : null;
}
