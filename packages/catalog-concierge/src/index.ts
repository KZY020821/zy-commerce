/**
 * Catalog Concierge — a product-aware chat assistant for any catalogue.
 *
 * Server-side entry point. The React widget lives at `catalog-concierge/react`
 * so a host that renders its own UI never pulls React into the bundle.
 */
export { askConcierge, conciergeStarters, ConciergeNotConfiguredError, type AskInput, type ConciergeOptions } from "./concierge";
export type {
  CatalogAdapter,
  CatalogueProduct,
  CatalogueProductDetail,
  CatalogueVariant,
  ConciergeReply,
  ConversationTurn,
  MinorUnits,
  ProductCard,
  ReplyOrigin,
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
export { buildSystemPrompt, runAssistant, trimHistory, MAX_HISTORY_CHARS, MAX_TOOL_ROUNDS, type AssistantReply, type AssistantStoreContext, type MessagesClient } from "./assistant";

// Model client resolution (any OpenAI-compatible endpoint).
export { getModelClient, isAssistantConfigured, resolveModelConfig, DEFAULT_MODEL, type ModelConfig } from "./model";

// Turning free text into structured specifications.
export { extractSpecs, type ExtractSpecsInput } from "./extract-specs";
export { htmlToLines, normalizeSpecKey, normalizeSpecs, parseLabelLines, parseTechSpecs, stripTags, type SpecSection } from "./spec-parse";

// Formatting helpers used by the assistant, shared so hosts render identically.
export { formatMoney, specsToRecord, stockLabel, stockStatus, STOCK_LABELS } from "./format";
