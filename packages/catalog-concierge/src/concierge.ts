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
import { runAssistant, type MessagesClient } from "./assistant";
import { formatMoney, stockLabel } from "./format";
import { buildStoreVocabulary, classifyMessage, OFF_TOPIC_REPLY } from "./guard";
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
}

export class ConciergeNotConfiguredError extends Error {
  constructor() {
    super("No model credentials found. Set DEEPSEEK_API_KEY (or pass `model`).");
    this.name = "ConciergeNotConfiguredError";
  }
}

export async function askConcierge(options: ConciergeOptions, input: AskInput): Promise<ConciergeReply> {
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

  if (!options.disableTopicGuard) {
    const vocabulary = buildStoreVocabulary({
      storeName: options.store.storeName,
      profile,
      productNames: catalogue.map((p) => p.name),
      brands: catalogue.map((p) => p.brand ?? "").filter(Boolean),
    });
    const verdict = classifyMessage(input.message, vocabulary, { hasHistory: input.history.length > 0 });
    if (!verdict.onTopic) {
      return { answer: OFF_TOPIC_REPLY, suggestions: starters, products: [], origin: { kind: "blocked", reason: verdict.reason } };
    }
  }

  const reply = await runAssistant({
    client: resolved.client,
    model: resolved.modelId,
    store: { ...options.store, profile },
    tools: { adapter: options.adapter, catalogue, store: options.store },
    history: input.history,
    userMessage: input.message,
  });

  return {
    answer: reply.answer,
    suggestions: reply.suggestions.length > 0 ? reply.suggestions : starters,
    products: toCards(reply.productRefs, catalogue, options.store),
    origin: { kind: "model", toolCalls: reply.toolCalls.map((t) => t.name) },
    usage: reply.usage ? { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, cachedInputTokens: reply.usage.cacheReadInputTokens } : undefined,
  };
}

/** Resolves the refs the model quoted back into renderable cards, in its order. */
function toCards(refs: string[], catalogue: ConciergeCatalogue, store: StoreProfile): ProductCard[] {
  const byRef = new Map(catalogue.map((p) => [p.ref.toLowerCase(), p]));
  return refs
    .map((ref) => byRef.get(ref.toLowerCase()))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      ref: p.ref,
      name: p.name,
      url: p.url ?? null,
      imageUrl: p.imageUrl ?? null,
      price: p.price,
      priceFrom: Boolean(p.priceFrom),
      priceLabel: formatMoney(p.price, store.currency, store.locale),
      stockLabel: stockLabel(p),
    }));
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
