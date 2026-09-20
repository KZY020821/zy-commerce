/**
 * The one function a host calls.
 *
 * Give it a store profile and a catalogue adapter, and it will:
 *   1. read the catalogue and build a map of what varies between products
 *   2. decide, in code, whether the message is even about this store
 *      (off-topic messages never reach the model, so they cost nothing)
 *   3. run the model's tool loop against the catalogue
 *   4. hand back the answer, quick-reply chips and resolved product cards
 *
 * Everything above this line is host territory: authentication, tenancy,
 * rate limiting, logging. Everything below it is the assistant.
 */
import { drain, runAssistantEvents, type AssistantEvent, type AssistantReply, type MessagesClient } from "./assistant";
import { toProductCard } from "./format";
import { buildStoreVocabulary, classifyMessage, isQuestion, OFF_TOPIC_REPLY } from "./guard";
import { getModelClient } from "./model";
import { buildCatalogProfile } from "./profile";
import { buildStarterSuggestions } from "./starters";
import type { CatalogAdapter, ConciergeReply, ConversationTurn, ProductCard, StoreProfile } from "./types";

export interface ConciergeOptions {
  store: StoreProfile;
  adapter: CatalogAdapter;
  /**
   * Model client and id. Omit to resolve one from the environment
   * (DEEPSEEK_API_KEY, or any OpenAI-compatible endpoint via AI_BASE_URL).
   */
  model?: { client: MessagesClient; modelId: string };
  /**
   * Turn the off-topic guard off. Only sensible if the host has already
   * decided the message is in scope — otherwise unrelated questions cost money.
   */
  disableTopicGuard?: boolean;
}

export interface AskInput {
  message: string;
  /** The visible conversation so far, oldest first. */
  history: ConversationTurn[];
  /**
   * Reference of the product the customer is looking at as they type, if the
   * host knows it. It tells the assistant what "this one" means, and it is
   * ignored unless it matches a product in the catalogue — so a host can pass
   * whatever its page happens to say without trusting it.
   */
  viewing?: string;
}

/** Cards shown with one reply — the ceiling the `respond` tool puts on productRefs. */
const MAX_CARDS = 4;

export class ConciergeNotConfiguredError extends Error {
  constructor() {
    super("No model credentials found. Set DEEPSEEK_API_KEY (or pass `model`).");
    this.name = "ConciergeNotConfiguredError";
  }
}

/**
 * What the assistant is doing, reported while the customer waits.
 *
 * One event per tool call, in the order they happen: the host can say
 * "searching the catalogue" and then "comparing two paddles" instead of
 * showing three dots for eight seconds.
 */
export type ConciergeEvent = AssistantEvent;

/** The whole turn, with its progress. Ends by returning the finished reply. */
export async function* askConciergeStream(options: ConciergeOptions, input: AskInput): AsyncGenerator<ConciergeEvent, ConciergeReply> {
  const resolved = options.model ?? (() => {
    const m = getModelClient();
    return m ? { client: m.client as MessagesClient, modelId: m.model } : null;
  })();
  if (!resolved) throw new ConciergeNotConfiguredError();

  // One read of the catalogue serves the map, the guard and every search this
  // turn — so the assistant can never answer from data older than this message.
  const catalogue = await options.adapter.listCatalogue();
  const profile = buildCatalogProfile(catalogue);
  const starters = buildStarterSuggestions(profile.categories.map((c) => c.name));

  // Only a product this catalogue actually contains may become context — for
  // the guard as well as for the model.
  const viewing = input.viewing ? catalogue.find((p) => p.ref.toLowerCase() === input.viewing!.trim().toLowerCase()) : undefined;

  if (!options.disableTopicGuard) {
    const vocabulary = buildStoreVocabulary({
      storeName: options.store.storeName,
      profile,
      productNames: catalogue.map((p) => p.name),
      brands: catalogue.map((p) => p.brand ?? "").filter(Boolean),
    });
    // The assistant is built to ask one clarifying question at a time, so when
    // its last turn ended in a question the customer's short reply is the
    // answer to it — and that answer is often a word no catalogue contains.
    const lastAssistantTurn = [...input.history].reverse().find((t) => t.role === "assistant");
    const verdict = classifyMessage(input.message, vocabulary, {
      hasHistory: input.history.length > 0,
      awaitingAnswer: isQuestion(lastAssistantTurn?.content),
      // "Is this any good?" on a product page is about the product on screen.
      viewingProduct: Boolean(viewing),
      // A chip the assistant offered is never off-topic, whatever it says.
      offeredSuggestions: lastAssistantTurn?.suggestions,
    });
    if (!verdict.onTopic) {
      return { answer: OFF_TOPIC_REPLY, suggestions: starters, products: [], origin: { kind: "blocked", reason: verdict.reason } };
    }
  }

  const reply = yield* runAssistantEvents({
    client: resolved.client,
    model: resolved.modelId,
    store: { ...options.store, profile },
    tools: { adapter: options.adapter, catalogue, store: options.store },
    history: input.history,
    userMessage: input.message,
    viewing: viewing ? { ref: viewing.ref, name: viewing.name } : undefined,
  });

  // What the model listed, and — when it listed nothing usable — what it was
  // demonstrably talking about. Models routinely write "tap the card below"
  // and leave `productRefs` empty: sometimes right after opening the product,
  // sometimes naming one from earlier in the conversation without opening
  // anything. Both left the customer with no card to tap.
  const lookup = buildLookup(catalogue);
  const listed = toCards(reply.productRefs, lookup, options.store);
  const products = listed.length > 0 ? listed : toCards(recoverRefs(reply, catalogue), lookup, options.store);

  return {
    answer: reply.answer,
    suggestions: reply.suggestions.length > 0 ? reply.suggestions : starters,
    products,
    origin: { kind: "model", toolCalls: reply.toolCalls.map((t) => t.name) },
    usage: reply.usage ? { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, cachedInputTokens: reply.usage.cacheReadInputTokens } : undefined,
  };
}

/**
 * The same turn for a host that only wants the answer. It is the streaming
 * version drained to its end, so there is one implementation of the turn and
 * a host choosing progress reporting can never get different behaviour.
 */
export async function askConcierge(options: ConciergeOptions, input: AskInput): Promise<ConciergeReply> {
  return drain(askConciergeStream(options, input));
}

/** The last path segment of a product URL, e.g. "/products/atlas" -> "atlas". */
function slugOf(url: string | null | undefined): string | null {
  const parts = (url ?? "").split(/[/?#]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}

/**
 * Every spelling of a product the model might hand back.
 *
 * It quotes whatever is in front of it: the reference from a search result,
 * the slug out of the product URL, or the display name. All three are
 * unambiguous, so all three resolve — and they are added in that order, so one
 * product's name can never shadow another product's reference.
 */
function buildLookup(catalogue: ConciergeCatalogue): Map<string, ConciergeCatalogue[number]> {
  const lookup = new Map<string, ConciergeCatalogue[number]>();
  const add = (key: string | null | undefined, product: ConciergeCatalogue[number]) => {
    const k = key?.trim().toLowerCase();
    if (k && !lookup.has(k)) lookup.set(k, product);
  };
  for (const p of catalogue) add(p.ref, p);
  for (const p of catalogue) add(slugOf(p.url), p);
  for (const p of catalogue) add(p.name, p);
  return lookup;
}

/** Everything the model showed it meant, most certain first. Only read when its own list came up empty. */
function recoverRefs(reply: AssistantReply, catalogue: ConciergeCatalogue): string[] {
  return [...refsLookedUp(reply.toolCalls), ...refsQuoted(reply.answer, catalogue), ...refsNamed(reply.answer, catalogue)];
}

/** The products the model opened this turn, in the order it opened them. */
function refsLookedUp(toolCalls: { name: string; input: unknown }[]): string[] {
  const refs: string[] = [];
  for (const call of toolCalls) {
    const input = (call.input ?? {}) as { ref?: unknown; refs?: unknown };
    if (call.name === "get_product" && typeof input.ref === "string") refs.push(input.ref);
    if (call.name === "compare_products" && Array.isArray(input.refs)) {
      for (const ref of input.refs) if (typeof ref === "string") refs.push(ref);
    }
  }
  return refs;
}

/**
 * References and slugs quoted in the answer itself, in the order they appear.
 *
 * A reference always counts — quoting a SKU is deliberate. A slug counts only
 * when it is long enough not to be an ordinary word, so a product living at
 * /products/atlas does not turn every sentence about an atlas into a card.
 */
function refsQuoted(answer: string, catalogue: ConciergeCatalogue): string[] {
  const quotable = new Set<string>();
  for (const p of catalogue) {
    quotable.add(p.ref.toLowerCase());
    const slug = slugOf(p.url)?.toLowerCase();
    if (slug && slug.length >= MIN_NAME_MATCH) quotable.add(slug);
  }
  return answer
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => quotable.has(token));
}

/** Letters and digits only, so punctuation and spacing stop mattering. */
function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Shortest phrase allowed to identify a product, and the longest run of words tried. */
const MIN_NAME_MATCH = 8;
const MAX_NAME_WORDS = 6;

/**
 * Products the answer names in prose, for the turn where the model describes
 * something from earlier in the conversation, opens nothing and lists nothing.
 *
 * A phrase counts only when exactly one product's name contains it, so
 * "the SLK Atlas" — which fits both the Max and the XL — attaches no card,
 * while "the SLK Atlas Max" attaches one. The longest phrase at each position
 * wins, so a card is as specific as the sentence was.
 */
function refsNamed(answer: string, catalogue: ConciergeCatalogue): string[] {
  const names = catalogue.map((p) => ({ ref: p.ref, key: normalizeName(p.name) })).filter((n) => n.key.length >= MIN_NAME_MATCH);
  const words = answer.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const found: string[] = [];

  for (let start = 0; start < words.length; start++) {
    for (let size = Math.min(MAX_NAME_WORDS, words.length - start); size >= 2; size--) {
      const phrase = normalizeName(words.slice(start, start + size).join(""));
      if (phrase.length < MIN_NAME_MATCH) continue;
      const matches = names.filter((n) => n.key.includes(phrase));
      if (matches.length !== 1) continue;
      const ref = matches[0]!.ref;
      if (!found.includes(ref)) found.push(ref);
      break;
    }
  }
  return found;
}

/** Resolves the refs the model used into renderable cards, in its order. */
function toCards(refs: string[], lookup: Map<string, ConciergeCatalogue[number]>, store: StoreProfile): ProductCard[] {
  const cards: ProductCard[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const p = lookup.get(ref.trim().toLowerCase());
    if (!p || seen.has(p.ref)) continue;
    seen.add(p.ref);
    cards.push(toProductCard(p, store));
    if (cards.length === MAX_CARDS) break;
  }
  return cards;
}

type ConciergeCatalogue = Awaited<ReturnType<CatalogAdapter["listCatalogue"]>>;

/**
 * The opening chips for a store, for hosts that render a greeting before the
 * first message. Same helper the guard is tested against, so a chip is never
 * judged off-topic.
 */
export async function conciergeStarters(adapter: CatalogAdapter): Promise<string[]> {
  const profile = buildCatalogProfile(await adapter.listCatalogue());
  return buildStarterSuggestions(profile.categories.map((c) => c.name));
}
