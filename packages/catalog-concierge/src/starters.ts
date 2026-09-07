/**
 * The quick-reply chips shown when a conversation opens, and again whenever a
 * message is turned away as off-topic ("try with the sample questions below").
 *
 * Shared so the storefront layout and the Server Action always offer the same
 * set — a customer who taps one must never be told it is off-topic.
 */
export function buildStarterSuggestions(categoryNames: string[]): string[] {
  const categories = categoryNames.filter(Boolean).slice(0, 2);
  return ["Help me choose", ...categories.map((c) => `Show me ${c.toLowerCase()}`), "What's on sale or in stock?"].slice(0, 4);
}
