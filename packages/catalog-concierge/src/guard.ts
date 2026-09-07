/**
 * Off-topic guard for the storefront assistant.
 *
 * Runs BEFORE any model call, in plain code, so a question that has nothing to
 * do with the store costs zero tokens. It is deliberately store-agnostic: the
 * vocabulary is derived from whatever that tenant actually sells (category
 * names, brands, product names, specification keys and values), so the same
 * logic works for pickleball paddles, basketball shoes or anything else.
 *
 * Bias: let borderline questions through. A false block is visible and
 * annoying to a customer; a false pass costs a fraction of a cent and the
 * system prompt still keeps the model on the catalogue.
 */
import type { CatalogProfile } from "./profile";

/** The exact reply shown when a message is judged off-topic. */
export const OFF_TOPIC_REPLY =
  "It seems like the question is not related to the purpose of this chat, try with the sample questions below";

/**
 * Clear non-commerce intents. These win over every allow rule below, so
 * "write me a poem about shoes" is still blocked even though it says "shoes".
 */
const OFF_TOPIC_PATTERNS: RegExp[] = [
  // Content generation / assistant-as-chatbot
  /\b(write|compose|draft|generate|create)\s+(me\s+)?(a|an|some)?\s*(poem|song|lyric|essay|story|joke|article|blog|code|script|program|email|letter|resume|cv|caption)\b/,
  /\btell me a (joke|story)\b/,
  /\b(translate|translation)\b/,
  /\bsummar(ise|ize) (this|the following)\b/,
  // General knowledge / trivia
  /\b(weather|forecast|raining|temperature outside)\b/,
  /\b(president|prime minister|election|politics|government)\b/,
  /\b(capital of|population of|who invented|who discovered|when was .{2,30} born|how tall is)\b/,
  /\b(recipe|how to cook|how to bake)\b/,
  /\b(movie|film|song|album|netflix|spotify) recommendation/,
  // Homework / maths
  /\b(homework|assignment|exam answer|solve for x)\b/,
  /\bwhat(?:'s| is)\s*\d+\s*[+\-*/x]\s*\d+/,
  /^\s*[\d\s+\-*/().]+\s*=?\s*$/,
  // Finance / crypto (note: "stock market" must not catch "in stock")
  /\b(stock market|share price|crypto|bitcoin|forex|invest in)\b/,
  // Medical / legal advice
  /\b(diagnose|symptom|prescription|legal advice|sue)\b/,
  // Prompt injection / role reassignment
  /\bignore (all |any |the )?(previous|prior|above)\b/,
  /\b(system prompt|your instructions|you are now|act as|pretend to be|jailbreak|developer mode)\b/,
];

/**
 * Commerce intent that stands on its own: if a message contains one of these,
 * it is a shopping question even when it names no product ("what's cheapest?",
 * "do you ship?", "help me choose").
 */
const STRONG_INTENT = new Set([
  // price
  "price", "prices", "pricing", "cost", "costs", "cheap", "cheaper", "cheapest", "expensive", "budget",
  "afford", "affordable", "discount", "sale", "deal", "deals", "offer", "under", "below", "rm", "usd", "myr", "dollar", "ringgit",
  // buying / logistics
  "buy", "purchase", "order", "checkout", "cart", "ship", "shipping", "shipped", "deliver", "delivery",
  "stock", "instock", "available", "availability", "soldout", "warranty", "return", "returns", "refund", "exchange",
  // product selection
  "size", "sizes", "sizing", "fit", "fits", "colour", "colours", "color", "colors",
  "compare", "comparison", "difference", "differences", "versus", "vs",
  "recommend", "recommendation", "recommendations", "suggest", "choose", "choosing", "pick",
  "spec", "specs", "specification", "specifications", "feature", "features", "material", "materials",
  "product", "products", "item", "items", "model", "models", "brand", "brands", "catalogue", "catalog", "range", "collection",
  "beginner", "intermediate", "advanced", "professional",
  "lightweight", "durable", "weight", "heavy", "light",
  // common non-English shopping terms (this platform targets MY/SG)
  "harga", "berapa", "murah", "mahal", "saiz", "beli", "ada", "stok", "warna", "cadangkan",
  "价格", "多少钱", "尺寸", "便宜", "推荐", "有货",
]);

/** Words too generic to imply shopping on their own, kept out of the vocabulary. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had", "can", "could",
  "will", "would", "should", "shall", "may", "might", "must", "this", "that", "these", "those", "it", "its",
  "i", "you", "he", "she", "we", "they", "me", "my", "your", "his", "her", "our", "their", "what", "which",
  "who", "whom", "when", "where", "why", "how", "all", "any", "some", "no", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "now", "then", "there", "here", "up", "out", "about", "into", "over",
  "new", "get", "got", "want", "need", "like", "good", "best", "show", "tell", "give", "find", "looking", "help",
  "edition", "unisex", "mens", "womens", "kids", "big", "little",
]);

/**
 * Openers and acknowledgements. Matched on the leading token of a very short
 * message, so "hey there" and "good morning" count without letting a long
 * sentence in just because it starts politely.
 */
const GREETING_WORDS = new Set([
  "hi", "hello", "hey", "yo", "hai", "halo", "hola", "greetings", "good", "morning", "afternoon", "evening",
  "thanks", "thank", "ty", "ok", "okay", "sure", "cool", "nice", "great",
]);
const MAX_GREETING_TOKENS = 3;

/** Lowercase word tokens, keeping alphanumerics like "kd19" and "16mm". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length >= 2);
}

/** Crude singular form so "paddles" matches a "paddle" vocabulary entry. */
function singular(token: string): string {
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export interface VocabularySource {
  storeName: string;
  profile: CatalogProfile;
  /** Product names — the richest signal for "is this about something we sell?". */
  productNames: string[];
  /** Brand names not already visible in the profile's per-category brand lists. */
  brands?: string[];
}

/**
 * Builds the set of words that mean "this message is about our catalogue".
 * Pure numbers and stopwords are excluded so they can't make everything pass.
 */
export function buildStoreVocabulary(src: VocabularySource): Set<string> {
  const vocab = new Set<string>();
  const add = (text: string | null | undefined) => {
    if (!text) return;
    for (const token of tokenize(text)) {
      if (STOPWORDS.has(token)) continue;
      if (!/\p{L}/u.test(token)) continue; // skip pure numbers
      vocab.add(token);
      vocab.add(singular(token));
    }
  };

  add(src.storeName);
  for (const c of src.profile.categories) {
    add(c.name);
    add(c.slug.replace(/-/g, " "));
    for (const b of c.brands) add(b);
    for (const f of c.facets) {
      add(f.key);
      for (const v of f.values ?? []) add(v);
    }
  }
  for (const name of src.productNames) add(name);
  for (const brand of src.brands ?? []) add(brand);
  return vocab;
}

export type TopicVerdict =
  | { onTopic: true; reason: "catalogue-term" | "shopping-intent" | "greeting" | "follow-up" }
  | { onTopic: false; reason: "blocked-pattern" | "no-signal" };

export interface ClassifyOptions {
  /** True once the customer has exchanged at least one turn with the assistant. */
  hasHistory: boolean;
}

/**
 * Decides whether a message is worth sending to the model. No network, no
 * tokens — this is the whole point of the guard.
 */
export function classifyMessage(message: string, vocab: Set<string>, opts: ClassifyOptions): TopicVerdict {
  const text = message.toLowerCase().trim();

  // 1. Explicit off-topic intents win outright, even if a product word appears.
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(text)) return { onTopic: false, reason: "blocked-pattern" };
  }

  const tokens = tokenize(message);

  // 2. Anything naming something we sell.
  for (const token of tokens) {
    if (vocab.has(token) || vocab.has(singular(token))) return { onTopic: true, reason: "catalogue-term" };
  }

  // 3. Shopping questions that name no product ("what's the cheapest?").
  for (const token of tokens) {
    if (STRONG_INTENT.has(token) || STRONG_INTENT.has(singular(token))) return { onTopic: true, reason: "shopping-intent" };
  }

  // 4. Plain greetings — blocking "hi" would just look broken. The deny list
  //    above has already caught things like "good ... weather?".
  if (tokens.length > 0 && tokens.length <= MAX_GREETING_TOKENS && GREETING_WORDS.has(tokens[0]!)) {
    return { onTopic: true, reason: "greeting" };
  }

  // 5. Short replies mid-conversation ("the first one", "yes, in blue") refer
  //    back to what the assistant just said, so they carry no keywords.
  if (opts.hasHistory && tokens.length > 0 && tokens.length <= 6) return { onTopic: true, reason: "follow-up" };

  return { onTopic: false, reason: "no-signal" };
}
