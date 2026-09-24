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
import { partialAnswer } from "./partial-json";
import { renderCatalogProfile, type CatalogProfile } from "./profile";
import type { StoreProfile } from "./types";
import { assistantTools, runAssistantTool, type ToolContext } from "./tools";

/** Everything the system prompt needs: who the store is, plus its map. */
export interface AssistantStoreContext extends StoreProfile {
  profile: CatalogProfile;
}

export type { ConversationTurn as AssistantTurn } from "./types";

/**
 * Something the assistant did, reported while the customer waits: a tool it
 * reached for, or the next piece of the answer as it is written.
 */
export type AssistantEvent =
  | { kind: "tool"; name: string }
  | {
      kind: "answer";
      delta: string;
      /**
       * Throw away what came before and start from this delta.
       *
       * Models often think out loud before reaching for a tool — "I'll look
       * for beginner-friendly paddles" — and then write the real answer. Both
       * are worth showing as they arrive, but the second replaces the first
       * rather than following it.
       */
      restart?: true;
    };

export interface AssistantReply {
  answer: string;
  suggestions: string[];
  productRefs: string[];
  /**
   * A reason per entry of `productRefs`, in the same order.
   *
   * Empty unless the model returned exactly one for each product: a list that
   * does not line up would put one product's reason on another's card, which
   * is worse than saying nothing.
   */
  productNotes: string[];
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

/**
 * The same client, asked for a stream.
 *
 * Every OpenAI-compatible SDK returns an async iterable of chunks for
 * `stream: true`; the narrower `MessagesClient` above is what a test fake has
 * to implement, so opting into streaming is what says yours can do both.
 */
export type DeepSeekChatCompletionStreamParams = Omit<DeepSeekChatCompletionCreateParams, "stream"> & {
  stream: true;
  /** OpenAI-compatible: usage arrives in a final chunk rather than not at all. */
  stream_options?: { include_usage: boolean };
};

export type StreamingMessagesClient = {
  chat: { completions: { create: (params: DeepSeekChatCompletionStreamParams) => Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> } };
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

/** The product the customer has open while they type, when the host knows it. */
export interface ViewingContext {
  ref: string;
  name: string;
}

/**
 * Ceiling on the store's own text in the prompt. It is resent on every tool
 * round, so a shop that pastes its whole terms page cannot make one turn
 * expensive; the first 2,000 characters are the part customers ask about.
 */
export const MAX_POLICY_CHARS = 2000;

export function buildSystemPrompt(ctx: AssistantStoreContext, viewing?: ViewingContext): string {
  const money = (minor: number) => formatMoney(minor, ctx.currency, ctx.locale);
  const policies = ctx.policies?.trim().slice(0, MAX_POLICY_CHARS);
  return [
    `You are ${ctx.assistantName}, the product assistant for the online store "${ctx.storeName}". You help customers understand and choose between the store's products.`,
    "",
    "Ground rules:",
    "- Everything you say about a product must come from the tools (search_products, get_product, compare_products). Never invent specifications, prices or availability. If the data doesn't answer a question, say so plainly.",
    "- Everything you say about the shop itself — delivery, returns, payment, opening hours, where it is — must come from the store information below, quoted as written. If it is not there, say you don't have that detail and suggest contacting the shop.",
    "- Only discuss this store's catalogue. For unrelated topics, steer back politely.",
    `- Prices are already formatted in ${ctx.currency}; quote them as given. Mention stock status when it matters (sold out, low stock).`,
    "- Be concise: normally under 120 words. Use short paragraphs or up to 4 bullet points. No headings, no markdown tables, no emojis.",
    "- Every product you name belongs in `productRefs` when you call `respond`, so the customer gets a tappable card for it, with a matching `productNotes` entry saying in a few words why it is there. Never paste a URL or a path: the card is the link.",
    "",
    "How to help (a fit-assistant flow that works for any product type):",
    "1. If the customer's need is clear enough to act on, look products up and answer or recommend directly.",
    "2. If it is under-specified (e.g. \"which paddle should I get?\", \"I need shoes\"), ask ONE focused clarifying question at a time. Choose it from the attributes that actually differentiate that category below (skill level, size, thickness, weight, use case, budget…). Offer the plausible answers as the `suggestions` so the customer can tap instead of type. Ask at most 3 clarifying questions in a row before recommending.",
    "3. When recommending, propose 2–3 products maximum, each with a one-line reason tied to a concrete spec or fit, and list their SKUs in `productRefs` with that reason, shortened, in `productNotes`.",
    "4. When comparing, use compare_products and highlight the 2–4 specs that differ most.",
    "5. Always end your turn by calling `respond` exactly once. `suggestions` must be 2–4 short options (≤ 6 words each): answers to your question, or natural next steps such as \"Compare the top two\" or \"Show something cheaper\".",
    "",
    "Store catalogue overview (use category slugs with search_products):",
    renderCatalogProfile(ctx.profile, ctx.currency, money),
    "",
    // The shop's own words, and the only non-product facts it may state.
    ...(policies ? ["Store information (the shop's own words — the only facts outside the catalogue you may state):", policies, ""] : []),
    // The customer is asking from a product page; "is this one good for me?"
    // has an obvious answer on screen and none at all in the message.
    ...(viewing ? [`The customer is looking at "${viewing.name}" (${viewing.ref}) right now. If they say "this", "it" or "this one" without naming anything else, they mean that product. Open it with get_product before saying anything about it.`, ""] : []),
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
  /** Resolved by the caller against the catalogue; see `askConcierge`. */
  viewing?: ViewingContext;
  /**
   * Ask the model to stream, and report the answer as it is written.
   *
   * Off by default: it asserts that `client` handles `stream: true`, which
   * every OpenAI-compatible SDK does and a hand-written test fake does not.
   */
  streamAnswer?: boolean;
}

function isFunctionCall(call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return call.type === "function";
}

/** How long a reason may be before it stops fitting on a card. */
const MAX_NOTE_CHARS = 60;

/**
 * The reasons, only if there is exactly one per product.
 *
 * Models drop an entry as happily as they add one, and a shifted list puts
 * one product's reason under another's name — a quiet, confident lie. When
 * the lists disagree, the cards simply say nothing.
 */
function alignedNotes(value: unknown, products: number): string[] {
  if (products === 0 || !Array.isArray(value) || value.length !== products) return [];
  const notes = value.map((note) => String(note).trim().replace(/\s+/g, " ").slice(0, MAX_NOTE_CHARS));
  return notes.every(Boolean) ? notes : [];
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The tool loop, reported as it happens.
 *
 * Yields one event per tool call, in the order the model makes them, and
 * returns the finished reply. A turn takes several seconds and spends most of
 * them inside this loop, so this is the only place that knows what the
 * assistant is actually doing while a customer waits.
 */
export async function* runAssistantEvents(opts: RunOptions): AsyncGenerator<AssistantEvent, AssistantReply> {
  const system = buildSystemPrompt(opts.store, opts.viewing);
  const history = trimHistory(opts.history).map<OpenAI.Chat.Completions.ChatCompletionMessageParam>((t) => ({ role: t.role, content: t.content }));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: system }, ...history, { role: "user", content: opts.userMessage }];
  const toolCalls: AssistantReply["toolCalls"] = [];
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
  /** True while what the customer is reading is the model thinking out loud. */
  let thinkingAloud = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const params = { model: opts.model, max_tokens: 2048, tools: assistantTools, messages, thinking: { type: "disabled" as const } };
    const response = opts.streamAnswer ? yield* reportRound(streamRound(opts.client as unknown as StreamingMessagesClient, params), () => thinkingAloud, (aloud) => (thinkingAloud = aloud)) : await opts.client.chat.completions.create(params);
    const u = response.usage;
    usage = {
      inputTokens: usage.inputTokens + (u?.prompt_tokens ?? 0),
      outputTokens: usage.outputTokens + (u?.completion_tokens ?? 0),
      // DeepSeek reports context-cache hits under prompt_tokens_details.cached_tokens (OpenAI-style field name).
      cacheReadInputTokens: usage.cacheReadInputTokens + (u?.prompt_tokens_details?.cached_tokens ?? 0),
    };

    const choice = response.choices[0];
    const message = choice?.message;
    if (!message) return { answer: "Sorry, I didn't get a response. Please try again.", suggestions: [], productRefs: [], productNotes: [], toolCalls, usage };

    if (message.refusal || choice.finish_reason === "content_filter") {
      return { answer: "Sorry, I can't help with that request. Is there a product I can help you find?", suggestions: ["Show me popular products", "Help me choose"], productRefs: [], productNotes: [], toolCalls, usage };
    }

    const calls = (message.tool_calls ?? []).filter(isFunctionCall);
    const respond = calls.find((c) => c.function.name === "respond");
    if (respond) {
      const input = safeParseArgs(respond.function.arguments) as { answer?: unknown; suggestions?: unknown; productRefs?: unknown; productNotes?: unknown };
      const productRefs = Array.isArray(input.productRefs) ? input.productRefs.map(String).filter(Boolean).slice(0, 4) : [];
      return {
        answer: typeof input.answer === "string" && input.answer.trim() ? input.answer.trim() : "I'm not sure how to answer that. Could you tell me a bit more about what you're looking for?",
        suggestions: Array.isArray(input.suggestions) ? input.suggestions.map(String).filter(Boolean).slice(0, 4) : [],
        productRefs,
        productNotes: alignedNotes(input.productNotes, productRefs.length),
        toolCalls,
        usage,
      };
    }

    if (calls.length === 0 || choice.finish_reason === "stop" || choice.finish_reason === "length") {
      // The model answered in plain text instead of calling respond — accept it.
      const text = (message.content ?? "").trim();
      return { answer: text || "Could you tell me a bit more about what you're looking for?", suggestions: [], productRefs: [], productNotes: [], toolCalls, usage };
    }

    messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });
    for (const call of calls) {
      const parsedInput = safeParseArgs(call.function.arguments);
      toolCalls.push({ name: call.function.name, input: parsedInput });
      // Said before the work, not after: this is what the customer is waiting on.
      yield { kind: "tool", name: call.function.name };
      let content: string;
      try {
        content = await runAssistantTool(call.function.name, parsedInput, opts.tools);
      } catch (err) {
        content = JSON.stringify({ error: (err as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { answer: "I looked into that but couldn't put together a confident answer. Could you rephrase or narrow it down?", suggestions: ["Show me popular products", "Start over"], productRefs: [], productNotes: [], toolCalls, usage };
}

/**
 * One round of the conversation, streamed.
 *
 * Yields the answer as the model writes it and returns the same shape the
 * non-streaming call returns, so everything after it — the tool loop, the
 * fallbacks, the usage — is untouched by how the bytes arrived.
 *
 * Only the `respond` call's `answer` is streamed. A tool call's arguments are
 * machine input: showing a customer half a search query would be noise, and
 * the tools themselves are already reported as they are used.
 */
/** What a streamed round reports: the answer, as it is written. Tools are the loop's to announce, when it runs them. */
type RoundEvent = { kind: "answer"; delta: string; source: "content" | "respond" };

/**
 * A round's events as the host sees them.
 *
 * The only translation is about where the text came from: plain content is
 * the model thinking out loud, and the first piece of the real answer tells
 * whoever is reading to start again.
 */
async function* reportRound(
  round: AsyncGenerator<RoundEvent, OpenAI.Chat.Completions.ChatCompletion>,
  wasThinkingAloud: () => boolean,
  setThinkingAloud: (aloud: boolean) => void,
): AsyncGenerator<AssistantEvent, OpenAI.Chat.Completions.ChatCompletion> {
  // Each round is its own utterance: a second thought replaces the first
  // rather than running into it, and the answer replaces both.
  let spokeThisRound = false;
  let step = await round.next();

  while (!step.done) {
    const event = step.value;
    const restart = !spokeThisRound && wasThinkingAloud();
    spokeThisRound = true;
    setThinkingAloud(event.source === "content");
    yield restart ? { kind: "answer", delta: event.delta, restart: true } : { kind: "answer", delta: event.delta };
    step = await round.next();
  }

  return step.value;
}

async function* streamRound(
  client: StreamingMessagesClient,
  params: DeepSeekChatCompletionCreateParams,
): AsyncGenerator<RoundEvent, OpenAI.Chat.Completions.ChatCompletion> {
  const stream = await client.chat.completions.create({ ...params, stream: true, stream_options: { include_usage: true } } as DeepSeekChatCompletionStreamParams);

  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let content = "";
  let refusal: string | null = null;
  let finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] | null = null;
  let usage: OpenAI.Completions.CompletionUsage | undefined;
  /** How much of the answer the customer has already been shown. */
  let shown = 0;

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices[0];
    if (!choice) continue;

    // A model that answers in plain text instead of calling `respond`.
    if (choice.delta.content) {
      content += choice.delta.content;
      yield { kind: "answer", delta: choice.delta.content, source: "content" };
    }
    if (choice.delta.refusal) refusal = (refusal ?? "") + choice.delta.refusal;

    for (const delta of choice.delta.tool_calls ?? []) {
      const call = calls.get(delta.index) ?? { id: "", name: "", arguments: "" };
      if (delta.id) call.id = delta.id;
      if (delta.function?.name) call.name = delta.function.name;
      if (delta.function?.arguments) call.arguments += delta.function.arguments;
      calls.set(delta.index, call);

      if (call.name !== "respond") continue;
      // The answer is inside JSON that has not finished arriving; send on
      // whatever is new since the last chunk, and never the same twice.
      const answer = partialAnswer(call.arguments);
      if (answer.length > shown) {
        yield { kind: "answer", delta: answer.slice(shown), source: "respond" };
        shown = answer.length;
      }
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } }));

  return {
    id: "streamed",
    object: "chat.completion",
    created: 0,
    model: params.model,
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: finishReason ?? "stop",
        message: { role: "assistant", content: content || null, refusal, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) },
      },
    ],
    ...(usage ? { usage } : {}),
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

/** The loop with nobody watching: runs it to the end and hands back the reply. */
export async function runAssistant(opts: RunOptions): Promise<AssistantReply> {
  return drain(runAssistantEvents(opts));
}

/** Runs an event generator to completion and returns what it returned. */
export async function drain<T, R>(generator: AsyncGenerator<T, R>): Promise<R> {
  let step = await generator.next();
  while (!step.done) step = await generator.next();
  return step.value;
}
