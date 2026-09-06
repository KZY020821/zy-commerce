/**
 * Model client for the product assistant.
 *
 * Provider resolution (first match wins):
 *   1. ANTHROPIC_API_KEY            → Anthropic API directly
 *   2. AI_GATEWAY_API_KEY           → Vercel AI Gateway (Anthropic Messages endpoint)
 *   3. VERCEL_OIDC_TOKEN            → Vercel AI Gateway with the deployment's OIDC token
 *                                     (present automatically on Vercel; locally via `vercel env pull`)
 *   none                            → assistant reports itself offline
 *
 * The gateway speaks the Anthropic Messages API, so the official SDK is used in
 * every case; only baseURL, key and the model id prefix differ.
 */
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5";
const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

export type AiProvider = "anthropic" | "vercel-gateway";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
}

export function resolveAiConfig(env: Record<string, string | undefined> = process.env): AiConfig | null {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  if (env.ANTHROPIC_API_KEY?.trim()) return { provider: "anthropic", model, apiKey: env.ANTHROPIC_API_KEY.trim() };
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim();
  if (gatewayKey) return { provider: "vercel-gateway", model: model.includes("/") ? model : `anthropic/${model}`, apiKey: gatewayKey, baseURL: GATEWAY_BASE_URL };
  return null;
}

export function isAssistantConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return resolveAiConfig(env) !== null;
}

let cached: { key: string; client: Anthropic } | null = null;

/** Returns a configured client and the model id to use with it, or null when no credentials exist. */
export function getAiClient(env: Record<string, string | undefined> = process.env): { client: Anthropic; model: string; provider: AiProvider } | null {
  const cfg = resolveAiConfig(env);
  if (!cfg) return null;
  const key = `${cfg.provider}:${cfg.baseURL ?? ""}:${cfg.apiKey.slice(0, 12)}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, maxRetries: 2, timeout: 60_000 }) };
  }
  return { client: cached.client, model: cfg.model, provider: cfg.provider };
}
