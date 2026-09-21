/**
 * Catalog Concierge — a product-aware chat assistant for any catalogue.
 *
 * Server-side entry point. The React widget lives at `catalog-concierge/react`
 * so a host that renders its own UI never pulls React into the bundle.
 */
export { askConcierge, askConciergeStream, conciergeStarters, ConciergeNotConfiguredError, type AskInput, type ConciergeEvent, type ConciergeOptions } from "./concierge";
export type {
  AssistantAnswer,
  AssistantStreamEvent,
  CatalogAdapter,
  CatalogueProduct,
  CatalogueProductDetail,
  CatalogueVariant,
  ConciergeReply,
  ConversationTurn,
  MinorUnits,
  ProductCard,
  ReplyOrigin,
  RestoredMessage,
  StockLabel,
  StockStatus,
  StoreProfile,
} from "./types";

// The store map: what a catalogue contains and which attributes distinguish
// products inside each category.
export { buildCatalogProfile, renderCatalogProfile, type CatalogProfile, type CategoryProfile, type SpecFacet } from "./profile";

// The zero-token off-topic guard.
export { buildStoreVocabulary, classifyMessage, isQuestion, OFF_TOPIC_REPLY, tokenize, type ClassifyOptions, type TopicVerdict, type VocabularySource } from "./guard";

// Quick-reply chips.
export { buildStarterSuggestions } from "./starters";

// Search and ranking, exported so hosts can reuse the exact behaviour the model sees.
export { assistantTools, runAssistantTool, searchCatalogue, summariseCategories, type SearchFilters, type ToolContext } from "./tools";

// The raw tool loop, for hosts that want to drive it themselves.
export { buildSystemPrompt, drain, runAssistant, runAssistantEvents, trimHistory, MAX_HISTORY_CHARS, MAX_POLICY_CHARS, MAX_TOOL_ROUNDS, type AssistantEvent, type AssistantReply, type AssistantStoreContext, type MessagesClient, type ViewingContext } from "./assistant";

// Model client resolution (any OpenAI-compatible endpoint).
export { getModelClient, isAssistantConfigured, resolveModelConfig, DEFAULT_MODEL, type ModelConfig } from "./model";

// Turning free text into structured specifications.
export { extractSpecs, type ExtractSpecsInput } from "./extract-specs";
export { htmlToLines, normalizeSpecKey, normalizeSpecs, parseLabelLines, parseTechSpecs, stripTags, type SpecSection } from "./spec-parse";

// Reusing a catalogue snapshot between messages, for catalogues big enough
// that reading them per message hurts.
export { cachedCatalogues, invalidateCatalogue, loadCatalogue, DEFAULT_CACHE_TTL_MS, type CatalogueCacheOptions } from "./catalogue-cache";

// Running the assistant against a catalogue and reporting what happened.
export { arrayAdapter, evaluateCatalogue, type Evaluation, type EvaluationOptions, type QuestionResult } from "./evaluate";

// How much the assistant has to work with: specification coverage and the
// products it will have least to say about.
export { assessCatalogue, countSpecs, type CatalogueReadiness } from "./readiness";

// What a turn cost, once a host supplies its provider's rates.
export { estimateCost, replyUsage, totalUsage, type CostBreakdown, type TokenRates, type TokenUsage } from "./cost";

// Talking to a host's own streaming endpoint (newline-delimited JSON).
export { askEndpoint, askEndpointStream, parseStreamLine, readAssistantStream } from "./transport";

// Formatting helpers used by the assistant, shared so hosts render identically.
export { formatMoney, specsToRecord, stockLabel, stockStatus, toProductCard, STOCK_LABELS } from "./format";
