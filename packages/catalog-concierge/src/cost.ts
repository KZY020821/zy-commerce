/**
 * What a conversation costs.
 *
 * Every reply carries its token usage, and until someone turns that into
 * money it answers nobody's question — not the shop owner deciding whether
 * this is worth paying for, and not whoever is pricing the widget.
 *
 * Rates are the host's to supply. They differ per provider, change without
 * notice, and baking today's numbers into a package would mean shipping a
 * wrong answer with confidence.
 */
import type { ConciergeReply } from "./types";

export interface TokenRates {
  /** Price per million input tokens, in whatever currency you are counting. */
  inputPerMillion: number;
  outputPerMillion: number;
  /**
   * Price per million input tokens that hit the provider's context cache.
   * Usually a fraction of the input rate; defaults to the input rate, which
   * over-states rather than flatters.
   */
  cachedInputPerMillion?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  total: number;
}

const PER_MILLION = 1_000_000;

/**
 * The cost of one turn, in the same currency as the rates.
 *
 * Cached input is billed at its own rate and is not billed twice: providers
 * report cached tokens as part of the input count, not in addition to it.
 */
export function estimateCost(usage: TokenUsage | undefined, rates: TokenRates): CostBreakdown {
  if (!usage) return { input: 0, output: 0, total: 0 };

  const cached = Math.min(Math.max(usage.cachedInputTokens, 0), Math.max(usage.inputTokens, 0));
  const fresh = Math.max(usage.inputTokens, 0) - cached;
  const cachedRate = rates.cachedInputPerMillion ?? rates.inputPerMillion;

  const input = (fresh * rates.inputPerMillion + cached * cachedRate) / PER_MILLION;
  const output = (Math.max(usage.outputTokens, 0) * rates.outputPerMillion) / PER_MILLION;
  return { input, output, total: input + output };
}

/** Adds up the turns of a conversation, or a day's worth of them. */
export function totalUsage(usages: Array<TokenUsage | undefined>): TokenUsage {
  return usages.reduce<TokenUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + (usage?.inputTokens ?? 0),
      outputTokens: total.outputTokens + (usage?.outputTokens ?? 0),
      cachedInputTokens: total.cachedInputTokens + (usage?.cachedInputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  );
}

/** The usage of a reply, or zeroes for one the guard answered for free. */
export function replyUsage(reply: Pick<ConciergeReply, "usage">): TokenUsage {
  return reply.usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
}
