/**
 * The quick-reply chips shown when a conversation opens, and again whenever a
 * message is turned away as off-topic ("try with the sample questions below").
 *
 * Shared so the storefront layout and the Server Action always offer the same
 * set — a customer who taps one must never be told it is off-topic.
 *
 * Every chip also has to be answerable from the catalogue contract alone.
 * Stock is part of it (`stockQuantity`, and `search_products` filters on it);
 * a sale price is not, so a chip offering one would open the conversation with
 * a question the assistant can only decline.
 */
export function buildStarterSuggestions(categoryNames: string[]): string[] {
  const categories = categoryNames.filter(Boolean).slice(0, 2);
  return ["Help me choose", ...categories.map((c) => `Show me ${c.toLowerCase()}`), "What's in stock?"].slice(0, 4);
}
