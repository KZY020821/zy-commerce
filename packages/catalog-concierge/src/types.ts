/**
 * The contract between Catalog Concierge and a business's own product data.
 *
 * Everything the assistant knows about a store arrives through these shapes.
 * There is no database driver, ORM or e-commerce platform behind them on
 * purpose: a host implements two methods against whatever it already has
 * (SQL, a CMS, a Shopify API, a JSON file) and the assistant works.
 */

/** Money is always an integer in the currency's minor unit (cents, sen). */
export type MinorUnits = number;

/** A product as the assistant sees it when browsing or searching. */
export interface CatalogueProduct {
  /** Stable identifier the model quotes back, typically a SKU. Must be unique. */
  ref: string;
  name: string;
  /** Where a customer can view it. Used for the product cards in the reply. */
  url?: string | null;
  brand?: string | null;
  category?: { slug: string; name: string } | null;
  description?: string | null;
  price: MinorUnits;
  /** True when variants differ in price, so the UI shows "from £x". */
  priceFrom?: boolean;
  stockQuantity?: number | null;
  /** At or below this, the product is described as low stock. Defaults to 5. */
  lowStockThreshold?: number | null;
  /**
   * Structured, machine-readable attributes: {"Core Thickness": "16mm"}.
   * This is what makes the assistant precise. Without it the product is still
   * searchable by name, just not comparable on detail.
   */
  specs?: Record<string, string | number | null> | null;
  imageUrl?: string | null;
}

/** One buyable option of a product: a size, a colour, a length. */
export interface CatalogueVariant {
  ref: string;
  name: string;
  attributes?: Record<string, string | number | null> | null;
  price: MinorUnits;
  stockQuantity?: number | null;
}

/** The full record, fetched only when the assistant needs detail. */
export interface CatalogueProductDetail extends CatalogueProduct {
  variants?: CatalogueVariant[];
}

/**
 * What a host must implement. Two methods.
 *
 * `listCatalogue` is called once per customer message and drives the store
 * map, the off-topic guard's vocabulary, search and the product cards, so it
 * should return everything currently purchasable. Suited to catalogues up to
 * a few thousand products; past that, cache it and refresh on change.
 */
export interface CatalogAdapter {
  listCatalogue(): Promise<CatalogueProduct[]>;
  getProduct(ref: string): Promise<CatalogueProductDetail | null>;
}

/** Per-store settings. One shop, one config. */
export interface StoreProfile {
  /** Shown to the customer and used to keep the model on-brand. */
  storeName: string;
  /** The assistant's display name, e.g. "Nike Game Fit". */
  assistantName: string;
  /** ISO 4217, e.g. "USD". Prices are formatted with this. */
  currency: string;
  /** BCP 47, e.g. "en-US". Controls number and currency formatting. */
  locale: string;
  /** ISO 3166-1 alpha-2. Helps the model with regional phrasing. */
  country?: string;
}

/** One exchange in the visible conversation. */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** A product the assistant referred to, ready to render as a card. */
export interface ProductCard {
  ref: string;
  name: string;
  url?: string | null;
  imageUrl?: string | null;
  price: MinorUnits;
  priceFrom: boolean;
  /** Pre-formatted for display, e.g. "RM 352.90". */
  priceLabel: string;
  stockLabel: StockLabel;
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type StockLabel = "In stock" | "Low stock" | "Sold out";

/** Why the assistant answered the way it did. Useful for logging and analytics. */
export type ReplyOrigin =
  | { kind: "model"; toolCalls: string[] }
  | { kind: "blocked"; reason: string };

export interface ConciergeReply {
  answer: string;
  /** Two to four short quick-reply chips to show under the answer. */
  suggestions: string[];
  products: ProductCard[];
  origin: ReplyOrigin;
  /** Absent when the message was blocked before reaching the model. */
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}
