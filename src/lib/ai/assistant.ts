/**
 * The product assistant: a tool-using Claude loop over the tenant's catalogue.
 *
 * Behaviour (system prompt):
 *   - only talks about this store's products, and only from tool results
 *   - when the customer's need is under-specified, asks ONE targeted follow-up
 *     question chosen from the spec facets that actually differentiate the
 *     relevant category (works for any product type)
 *   - every reply carries 2–4 quick-reply suggestions ("auto follow-up")
 *   - finishes by calling the `respond` tool, which gives a structured reply
 *
 * The loop is provider-agnostic: pass any object with `messages.create`.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { formatMoney } from "@/lib/money";
import { renderCatalogProfile, type CatalogProfile } from "./catalog-profile";
import { assistantTools, runAssistantTool, type ToolContext } from "./tools";

export interface AssistantStoreContext {
  storeName: string;
  assistantName: string;
  currency: string;
  locale: string;
  country: string;
  profile: CatalogProfile;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  answer: string;
  suggestions: string[];
  productSkus: string[];
  /** Tool calls made this turn (for logging / admin analytics). */
  toolCalls: { name: string; input: unknown }[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number };
}

/** Minimal surface of the SDK client the loop needs — lets tests pass a fake. */
export type MessagesClient = { messages: { create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } };

export const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_TURNS = 12;

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
    "3. When recommending, propose 2–3 products maximum, each with a one-line reason tied to a concrete spec or fit, and list their SKUs in `productSkus`.",
    "4. When comparing, use compare_products and highlight the 2–4 specs that differ most.",
    "5. Always end your turn by calling `respond` exactly once. `suggestions` must be 2–4 short options (≤ 6 words each): answers to your question, or natural next steps such as \"Compare the top two\" or \"Show something cheaper\".",
    "",
    "Store catalogue overview (use category slugs with search_products):",
    renderCatalogProfile(ctx.profile, ctx.currency, money),
    "",
    `Store region: ${ctx.country}. Answer in the customer's language.`,
  ].join("\n");
}

interface RunOptions {
  client: MessagesClient;
  model: string;
  store: AssistantStoreContext;
  tools: ToolContext;
  history: AssistantTurn[];
  userMessage: string;
  /** Prefer lower effort for chat latency; medium is a good default. */
  effort?: "low" | "medium" | "high";
}

export async function runAssistant(opts: RunOptions): Promise<AssistantReply> {
  const system = buildSystemPrompt(opts.store);
  const history = opts.history.slice(-MAX_HISTORY_TURNS).map<Anthropic.MessageParam>((t) => ({ role: t.role, content: t.content }));
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: opts.userMessage }];
  const toolCalls: AssistantReply["toolCalls"] = [];
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await opts.client.messages.create({
      model: opts.model,
      max_tokens: 2048,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: assistantTools,
      output_config: { effort: opts.effort ?? "medium" },
      messages,
    });
    usage = {
      inputTokens: usage.inputTokens + (response.usage?.input_tokens ?? 0),
      outputTokens: usage.outputTokens + (response.usage?.output_tokens ?? 0),
      cacheReadInputTokens: usage.cacheReadInputTokens + (response.usage?.cache_read_input_tokens ?? 0),
    };

    if (response.stop_reason === "refusal") {
      return { answer: "Sorry, I can't help with that request. Is there a product I can help you find?", suggestions: ["Show me popular products", "Help me choose"], productSkus: [], toolCalls, usage };
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const respond = toolUses.find((t) => t.name === "respond");
    if (respond) {
      const input = respond.input as { answer?: unknown; suggestions?: unknown; productSkus?: unknown };
      return {
        answer: typeof input.answer === "string" && input.answer.trim() ? input.answer.trim() : "I'm not sure how to answer that. Could you tell me a bit more about what you're looking for?",
        suggestions: Array.isArray(input.suggestions) ? input.suggestions.map(String).filter(Boolean).slice(0, 4) : [],
        productSkus: Array.isArray(input.productSkus) ? input.productSkus.map(String).filter(Boolean).slice(0, 4) : [],
        toolCalls,
        usage,
      };
    }

    if (toolUses.length === 0 || response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      // The model answered in plain text instead of calling respond — accept it.
      const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { answer: text || "Could you tell me a bit more about what you're looking for?", suggestions: [], productSkus: [], toolCalls, usage };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      toolCalls.push({ name: call.name, input: call.input });
      try {
        results.push({ type: "tool_result", tool_use_id: call.id, content: await runAssistantTool(call.name, call.input, opts.tools) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify({ error: (err as Error).message }), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return { answer: "I looked into that but couldn't put together a confident answer. Could you rephrase or narrow it down?", suggestions: ["Show me popular products", "Start over"], productSkus: [], toolCalls, usage };
}
