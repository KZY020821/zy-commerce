/**
 * The product assistant: a tool-using DeepSeek loop over the tenant's
 * catalogue, via the OpenAI-compatible chat completions API
 * (https://api-docs.deepseek.com/guides/tool_calls).
 *
 * Behaviour (system prompt):
 *   - only talks about this store's products, and only from tool results
 *   - when the customer's need is under-specified, asks ONE targeted follow-up
 *     question chosen from the spec facets that actually differentiate the
 *     relevant category (works for any product type)
 *   - every reply carries 2–4 quick-reply suggestions ("auto follow-up")
 *   - finishes by calling the `respond` tool, which gives a structured reply
 *
 * The loop is provider-agnostic: pass any object with `chat.completions.create`.
 */
import type OpenAI from "openai";
import { formatMoney } from "./format";
import { renderCatalogProfile, type CatalogProfile } from "./profile";
import type { StoreProfile } from "./types";
import { assistantTools, runAssistantTool, type ToolContext } from "./tools";

/** Everything the system prompt needs: who the store is, plus its map. */
export interface AssistantStoreContext extends StoreProfile {
  profile: CatalogProfile;
}

export type { ConversationTurn as AssistantTurn } from "./types";

export interface AssistantReply {
  answer: string;
  suggestions: string[];
  productRefs: string[];
  /** Tool calls made this turn (for logging / admin analytics). */
  toolCalls: { name: string; input: unknown }[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };
}

/**
 * DeepSeek adds an optional `thinking` toggle beyond the OpenAI-compatible
 * surface (https://api-docs.deepseek.com/guides/reasoning_model). Measured
 * against the real API: leaving it on roughly doubled both token usage and
 * latency for this assistant's short, tool-grounded turns without improving
 * tool-call correctness, so it is switched off below by default.
 */
export type DeepSeekChatCompletionCreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
  thinking?: { type: "enabled" | "disabled" };
};

/** Minimal surface of the SDK client the loop needs — lets tests pass a fake. */
export type MessagesClient = {
  chat: { completions: { create: (params: DeepSeekChatCompletionCreateParams) => Promise<OpenAI.Chat.Completions.ChatCompletion> } };
};

export const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_TURNS = 12;
/**
 * Ceiling on the characters of prior conversation replayed to the model.
 *
 * The host owns history and is expected to supply a trustworthy transcript
 * (see the README), but history is the one input that scales with what a
 * customer typed, and it is resent on every tool round. Capping it here bounds
 * the cost of a single turn no matter what a host passes in. Oldest turns are
 * dropped first, so the most recent context always survives.
 */
export const MAX_HISTORY_CHARS = 12_000;

/** Most recent turns that fit inside both the turn and character budgets. */
export function trimHistory(history: { role: "user" | "assistant"; content: string }[]): { role: "user" | "assistant"; content: string }[] {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const kept: typeof recent = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]!;
    chars += turn.content.length;
    if (chars > MAX_HISTORY_CHARS) break;
    kept.unshift(turn);
  }
  return kept;
}

export function buildSystemPrompt(ctx: AssistantStoreContext): string {
  const money = (minor: number) => formatMoney(minor, ctx.currency, ctx.locale);
  return [
    `You are ${ctx.assistantName}, the product assistant for the online store "${ctx.storeName}". You help customers understand and choose between the store's products.`,
    "",
    "Ground rules:",
    "- Everything you say about a product must come from the tools (search_products, get_product, compare_products). Never invent specifications, prices or availability. If the data doesn't answer a question, say so plainly.",
    "- Only discuss this store's catalogue. For unrelated topics, steer back politely.",
    `- Prices are already formatted in ${ctx.currency}; quote them as given. Mention stock status when it matters (sold out, low stock).`,
    "- Be concise: normally under 120 words. Use short paragraphs or up to 4 bullet points. No headings, no markdown tables, no emojis.",
    "",
    "How to help (a fit-assistant flow that works for any product type):",
    "1. If the customer's need is clear enough to act on, look products up and answer or recommend directly.",
    "2. If it is under-specified (e.g. \"which paddle should I get?\", \"I need shoes\"), ask ONE focused clarifying question at a time. Choose it from the attributes that actually differentiate that category below (skill level, size, thickness, weight, use case, budget…). Offer the plausible answers as the `suggestions` so the customer can tap instead of type. Ask at most 3 clarifying questions in a row before recommending.",
    "3. When recommending, propose 2–3 products maximum, each with a one-line reason tied to a concrete spec or fit, and list their SKUs in `productRefs`.",
    "4. When comparing, use compare_products and highlight the 2–4 specs that differ most.",
    "5. Always end your turn by calling `respond` exactly once. `suggestions` must be 2–4 short options (≤ 6 words each): answers to your question, or natural next steps such as \"Compare the top two\" or \"Show something cheaper\".",
    "",
    "Store catalogue overview (use category slugs with search_products):",
    renderCatalogProfile(ctx.profile, ctx.currency, money),
    "",
    `Store region: ${ctx.country ?? "unspecified"}. Answer in the customer's language.`,
  ].join("\n");
}

interface RunOptions {
  client: MessagesClient;
  model: string;
  store: AssistantStoreContext;
  tools: ToolContext;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
}

function isFunctionCall(call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return call.type === "function";
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runAssistant(opts: RunOptions): Promise<AssistantReply> {
  const system = buildSystemPrompt(opts.store);
  const history = trimHistory(opts.history).map<OpenAI.Chat.Completions.ChatCompletionMessageParam>((t) => ({ role: t.role, content: t.content }));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: system }, ...history, { role: "user", content: opts.userMessage }];
  const toolCalls: AssistantReply["toolCalls"] = [];
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await opts.client.chat.completions.create({ model: opts.model, max_tokens: 2048, tools: assistantTools, messages, thinking: { type: "disabled" } });
    const u = response.usage;
    usage = {
      inputTokens: usage.inputTokens + (u?.prompt_tokens ?? 0),
      outputTokens: usage.outputTokens + (u?.completion_tokens ?? 0),
      // DeepSeek reports context-cache hits under prompt_tokens_details.cached_tokens (OpenAI-style field name).
      cacheReadInputTokens: usage.cacheReadInputTokens + (u?.prompt_tokens_details?.cached_tokens ?? 0),
    };

    const choice = response.choices[0];
    const message = choice?.message;
    if (!message) return { answer: "Sorry, I didn't get a response. Please try again.", suggestions: [], productRefs: [], toolCalls, usage };

    if (message.refusal || choice.finish_reason === "content_filter") {
      return { answer: "Sorry, I can't help with that request. Is there a product I can help you find?", suggestions: ["Show me popular products", "Help me choose"], productRefs: [], toolCalls, usage };
    }

    const calls = (message.tool_calls ?? []).filter(isFunctionCall);
    const respond = calls.find((c) => c.function.name === "respond");
    if (respond) {
      const input = safeParseArgs(respond.function.arguments) as { answer?: unknown; suggestions?: unknown; productRefs?: unknown };
      return {
        answer: typeof input.answer === "string" && input.answer.trim() ? input.answer.trim() : "I'm not sure how to answer that. Could you tell me a bit more about what you're looking for?",
        suggestions: Array.isArray(input.suggestions) ? input.suggestions.map(String).filter(Boolean).slice(0, 4) : [],
        productRefs: Array.isArray(input.productRefs) ? input.productRefs.map(String).filter(Boolean).slice(0, 4) : [],
        toolCalls,
        usage,
      };
    }

    if (calls.length === 0 || choice.finish_reason === "stop" || choice.finish_reason === "length") {
      // The model answered in plain text instead of calling respond — accept it.
      const text = (message.content ?? "").trim();
      return { answer: text || "Could you tell me a bit more about what you're looking for?", suggestions: [], productRefs: [], toolCalls, usage };
    }

    messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });
    for (const call of calls) {
      const parsedInput = safeParseArgs(call.function.arguments);
      toolCalls.push({ name: call.function.name, input: parsedInput });
      let content: string;
      try {
        content = await runAssistantTool(call.function.name, parsedInput, opts.tools);
      } catch (err) {
        content = JSON.stringify({ error: (err as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { answer: "I looked into that but couldn't put together a confident answer. Could you rephrase or narrow it down?", suggestions: ["Show me popular products", "Start over"], productRefs: [], toolCalls, usage };
}
