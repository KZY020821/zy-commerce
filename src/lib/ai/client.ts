/**
 * Model client for the product assistant — DeepSeek, via its OpenAI-compatible
 * API (https://api.deepseek.com/quick_start/first_api_call). Uses the official
 * `openai` SDK: DeepSeek's endpoint speaks the same wire format, so only
 * baseURL / apiKey / model id differ from talking to OpenAI itself.
 *
 * Chosen deliberately over a hosted-Anthropic route: this runs on the store
 * owner's own DeepSeek key, so nothing here touches Vercel AI Gateway or
 * Anthropic billing. The only cost is whatever DeepSeek charges that key's
 * owner directly, at DeepSeek's per-token rates (see docs/DECISIONS.md).
 */
import OpenAI from "openai";

/** Cheapest current DeepSeek model that still supports tool calling and JSON mode. */
export const DEFAULT_MODEL = "deepseek-v4-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface AiConfig {
  model: string;
  apiKey: string;
  baseURL: string;
}

/** Resolves credentials from the environment. Requires DEEPSEEK_API_KEY. */
export function resolveAiConfig(env: Record<string, string | undefined> = process.env): AiConfig | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const baseURL = env.AI_BASE_URL?.trim() || DEEPSEEK_BASE_URL;
  return { model, apiKey, baseURL };
}

export function isAssistantConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return resolveAiConfig(env) !== null;
}

let cached: { key: string; client: OpenAI } | null = null;

/** Returns a configured client and the model id to use with it, or null when DEEPSEEK_API_KEY is unset. */
export function getAiClient(env: Record<string, string | undefined> = process.env): { client: OpenAI; model: string } | null {
  const cfg = resolveAiConfig(env);
  if (!cfg) return null;
  const key = `${cfg.baseURL}:${cfg.apiKey}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 2, timeout: 60_000 }) };
  }
  return { client: cached.client, model: cfg.model };
}
