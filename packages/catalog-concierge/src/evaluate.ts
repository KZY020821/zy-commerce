/**
 * Running the assistant against a catalogue and reporting what happened.
 *
 * This is what a prospective client should do before paying for anything:
 * point it at their own products, ask the questions their customers ask, and
 * read what comes back — which questions were answered, which were refused,
 * which products it put forward, what it cost, how long it took.
 *
 * It is deliberately blunt about the two failure modes that matter. A refused
 * question usually means the guard found nothing of the store in it, and an
 * answer with no products usually means the catalogue has nothing to say.
 */
import { askConcierge, type ConciergeOptions } from "./concierge";
import { conciergeStarters } from "./concierge";
import { estimateCost, totalUsage, type TokenRates, type TokenUsage } from "./cost";
import { assessCatalogue, type CatalogueReadiness } from "./readiness";
import type { CatalogAdapter, CatalogueProduct, StoreProfile } from "./types";

export interface EvaluationOptions {
  catalogue: CatalogueProduct[];
  store: StoreProfile;
  /** Questions to ask. Defaults to the store's own opening chips. */
  questions?: string[];
  /** Model client and id, as `askConcierge` takes them. */
  model?: ConciergeOptions["model"];
  /** Rates for the cost column, if you want one. */
  rates?: TokenRates;
}

export interface QuestionResult {
  question: string;
  /** True when the guard answered without a model call. */
  refused: boolean;
  answer: string;
  /** Products it put on screen, by reference. */
  products: string[];
  /** Tools it used, in order. */
  tools: string[];
  usage: TokenUsage;
  /** Cost of this question, when rates were given. */
  cost?: number;
  ms: number;
}

export interface Evaluation {
  readiness: CatalogueReadiness;
  results: QuestionResult[];
  summary: {
    asked: number;
    answered: number;
    refused: number;
    /** Answers that named no product at all. */
    withoutProducts: number;
    usage: TokenUsage;
    cost?: number;
    medianMs: number;
  };
}

/** An adapter over a plain array, which is all an evaluation needs. */
export function arrayAdapter(catalogue: CatalogueProduct[]): CatalogAdapter {
  return {
    listCatalogue: async () => catalogue,
    getProduct: async (ref) => catalogue.find((p) => p.ref.toLowerCase() === ref.trim().toLowerCase()) ?? null,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle]!;
}

export async function evaluateCatalogue(options: EvaluationOptions, now: () => number = Date.now): Promise<Evaluation> {
  const adapter = arrayAdapter(options.catalogue);
  const questions = options.questions?.length ? options.questions : await conciergeStarters(adapter);
  const results: QuestionResult[] = [];

  for (const question of questions) {
    const startedAt = now();
    const reply = await askConcierge({ store: options.store, adapter, ...(options.model ? { model: options.model } : {}) }, { message: question, history: [] });
    const usage = reply.usage ? { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens, cachedInputTokens: reply.usage.cachedInputTokens } : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

    results.push({
      question,
      refused: reply.origin.kind === "blocked",
      answer: reply.answer,
      products: reply.products.map((p) => p.ref),
      tools: reply.origin.kind === "model" ? reply.origin.toolCalls : [],
      usage,
      ...(options.rates ? { cost: estimateCost(usage, options.rates).total } : {}),
      ms: now() - startedAt,
    });
  }

  const usage = totalUsage(results.map((r) => r.usage));
  const answered = results.filter((r) => !r.refused);

  return {
    readiness: assessCatalogue(options.catalogue),
    results,
    summary: {
      asked: results.length,
      answered: answered.length,
      refused: results.length - answered.length,
      withoutProducts: answered.filter((r) => r.products.length === 0).length,
      usage,
      ...(options.rates ? { cost: estimateCost(usage, options.rates).total } : {}),
      medianMs: median(results.map((r) => r.ms)),
    },
  };
}
