/**
 * Drives the assistant loop with a fake DeepSeek (OpenAI-compatible) client
 * so the tool protocol, the `respond` contract and the fallbacks are
 * verified without network.
 */
import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, runAssistant, trimHistory, MAX_HISTORY_CHARS, type AssistantStoreContext, type MessagesClient } from "../src/assistant";
import * as tools from "../src/tools";

const store: AssistantStoreContext = {
  storeName: "Selkirk Demo",
  assistantName: "Fit Assistant",
  currency: "MYR",
  locale: "ms-MY",
  country: "MY",
  profile: { productCount: 2, categories: [{ slug: "paddles", name: "Paddles", productCount: 2, priceMin: 30000, priceMax: 90000, brands: ["Selkirk"], facets: [{ key: "Core Thickness", coverage: 2, values: ["16mm", "13mm"] }] }] },
};

function toolCall(id: string, name: string, args: unknown): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function completion(over: { content?: string | null; tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]; finish_reason?: string; refusal?: string | null }): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "cmpl", object: "chat.completion", created: 0, model: "deepseek-v4-flash",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: over.content ?? null, refusal: over.refusal ?? null, tool_calls: over.tool_calls } as OpenAI.Chat.Completions.ChatCompletionMessage,
        finish_reason: (over.finish_reason ?? (over.tool_calls ? "tool_calls" : "stop")) as never,
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

function fakeClient(responses: OpenAI.Chat.Completions.ChatCompletion[]): MessagesClient & { calls: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming[] } {
  const calls: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming[] = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          const next = responses.shift();
          if (!next) throw new Error("fake client ran out of responses");
          return next;
        },
      },
    },
  };
}

const toolCtx = {
  adapter: { listCatalogue: async () => [], getProduct: async () => null },
  catalogue: [],
  store: { storeName: "Selkirk Demo", assistantName: "Fit Assistant", currency: "MYR", locale: "ms-MY" },
};

describe("runAssistant", () => {
  it("executes tool calls, feeds results back, and returns the structured respond payload", async () => {
    const runTool = vi.spyOn(tools, "runAssistantTool").mockResolvedValue(JSON.stringify({ total: 1, products: [{ sku: "SLK-001", name: "SLK Halo" }] }));
    const client = fakeClient([
      completion({ tool_calls: [toolCall("t1", "search_products", { query: "16mm paddle", category: "paddles", minPrice: null, maxPrice: null, inStockOnly: false })] }),
      completion({ tool_calls: [toolCall("t2", "respond", { answer: "The SLK Halo has a 16mm core.", suggestions: ["Compare with XL", "Show cheaper"], productRefs: ["SLK-001"] })] }),
    ]);

    const reply = await runAssistant({ client, model: "deepseek-v4-flash", store, tools: toolCtx, history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], userMessage: "which 16mm paddle?" });

    expect(reply.answer).toBe("The SLK Halo has a 16mm core.");
    expect(reply.suggestions).toEqual(["Compare with XL", "Show cheaper"]);
    expect(reply.productRefs).toEqual(["SLK-001"]);
    expect(reply.toolCalls.map((t) => t.name)).toEqual(["search_products"]);
    expect(runTool).toHaveBeenCalledWith("search_products", expect.objectContaining({ query: "16mm paddle" }), toolCtx);

    // Second request carries the assistant tool_calls turn and a tool result message for it
    const second = client.calls[1]!;
    expect(second.messages.at(-2)).toMatchObject({ role: "assistant" });
    const last = second.messages.at(-1)!;
    expect(last).toMatchObject({ role: "tool", tool_call_id: "t1" });
    // System prompt, full history and the tool schema are sent on every call
    expect(second.messages[0]).toMatchObject({ role: "system" });
    expect(second.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(String((second.messages[0] as { content: string }).content)).toContain("Selkirk Demo");
    expect(second.tools?.filter((t) => t.type === "function").map((t) => t.function.name)).toContain("respond");
    runTool.mockRestore();
  });

  it("accepts a plain-text answer when the model skips the respond tool", async () => {
    const client = fakeClient([completion({ content: "Just text.", finish_reason: "stop" })]);
    const reply = await runAssistant({ client, model: "deepseek-v4-flash", store, tools: toolCtx, history: [], userMessage: "hello" });
    expect(reply.answer).toBe("Just text.");
    expect(reply.suggestions).toEqual([]);
  });

  it("returns a safe reply on refusal or content_filter, and never exposes tool errors", async () => {
    const client = fakeClient([completion({ refusal: "I can't help with that.", finish_reason: "stop" })]);
    const reply = await runAssistant({ client, model: "deepseek-v4-flash", store, tools: toolCtx, history: [], userMessage: "…" });
    expect(reply.answer).toMatch(/can't help/i);
    expect(reply.suggestions.length).toBeGreaterThan(0);

    const client2 = fakeClient([completion({ content: null, finish_reason: "content_filter" })]);
    const reply2 = await runAssistant({ client: client2, model: "deepseek-v4-flash", store, tools: toolCtx, history: [], userMessage: "…" });
    expect(reply2.answer).toMatch(/can't help/i);
  });

  it("marks failing tools as errors and still reaches a final answer", async () => {
    const runTool = vi.spyOn(tools, "runAssistantTool").mockRejectedValue(new Error("db down"));
    const client = fakeClient([
      completion({ tool_calls: [toolCall("t1", "get_product", { skuOrSlug: "X" })] }),
      completion({ tool_calls: [toolCall("t2", "respond", { answer: "Sorry, I couldn't look that up.", suggestions: [], productRefs: [] })] }),
    ]);
    const reply = await runAssistant({ client, model: "deepseek-v4-flash", store, tools: toolCtx, history: [], userMessage: "details of X" });
    expect(reply.answer).toMatch(/couldn't/i);
    const result = client.calls[1]!.messages.at(-1) as { role: string; content: string };
    expect(result.role).toBe("tool");
    expect(JSON.parse(result.content)).toMatchObject({ error: "db down" });
    runTool.mockRestore();
  });

  it("tolerates malformed JSON arguments from the model instead of throwing", async () => {
    const runTool = vi.spyOn(tools, "runAssistantTool").mockResolvedValue("{}");
    const client = fakeClient([
      { ...completion({ tool_calls: [{ id: "t1", type: "function", function: { name: "list_categories", arguments: "{not json" } }] }) },
      completion({ tool_calls: [toolCall("t2", "respond", { answer: "ok", suggestions: [], productRefs: [] })] }),
    ]);
    const reply = await runAssistant({ client, model: "deepseek-v4-flash", store, tools: toolCtx, history: [], userMessage: "hi" });
    expect(reply.answer).toBe("ok");
    expect(runTool).toHaveBeenCalledWith("list_categories", {}, toolCtx);
    runTool.mockRestore();
  });

  it("gives up gracefully after the tool-round limit", async () => {
    vi.spyOn(tools, "runAssistantTool").mockResolvedValue("{}");
    const loop = Array.from({ length: 10 }, (_, i) => completion({ tool_calls: [toolCall(`t${i}`, "list_categories", {})] }));
    const client = fakeClient(loop);
    const reply = await runAssistant({ client, model: "deepseek-v4-flash", store, tools: toolCtx, history: [], userMessage: "loop" });
    expect(reply.answer).toMatch(/couldn't put together/i);
    expect(client.calls.length).toBeLessThanOrEqual(8);
    vi.restoreAllMocks();
  });
});

describe("buildSystemPrompt", () => {
  it("embeds the store identity, rules and catalogue facets", () => {
    const text = buildSystemPrompt(store);
    expect(text).toContain("Fit Assistant");
    expect(text).toContain("Selkirk Demo");
    expect(text).toContain("Never invent specifications");
    expect(text).toContain("Core Thickness: 16mm | 13mm");
    expect(text).toContain("respond");
  });
});

describe("trimHistory", () => {
  const t = (content: string, role: "user" | "assistant" = "user") => ({ role, content });

  it("keeps history that fits both budgets untouched", () => {
    const history = [t("hi"), t("hello", "assistant"), t("show me paddles")];
    expect(trimHistory(history)).toEqual(history);
  });

  it("keeps only the most recent turns", () => {
    const history = Array.from({ length: 30 }, (_, i) => t(`m${i}`));
    const kept = trimHistory(history);
    expect(kept).toHaveLength(12);
    expect(kept.at(-1)).toEqual(t("m29"));
    expect(kept[0]).toEqual(t("m18"));
  });

  it("drops the oldest turns once the character budget is exceeded", () => {
    // Three turns, each half the budget: only the newest two can fit.
    const big = "x".repeat(MAX_HISTORY_CHARS / 2);
    const kept = trimHistory([t(big + "oldest"), t(big), t(big)]);
    expect(kept).toHaveLength(2);
    expect(kept.some((turn) => turn.content.endsWith("oldest"))).toBe(false);
  });

  it("bounds one turn's cost even when a host passes an enormous transcript", () => {
    const history = Array.from({ length: 24 }, () => t("y".repeat(4000)));
    const chars = trimHistory(history).reduce((n, turn) => n + turn.content.length, 0);
    expect(chars).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  it("returns nothing when even the newest turn overflows the budget", () => {
    expect(trimHistory([t("z".repeat(MAX_HISTORY_CHARS + 1))])).toEqual([]);
  });
});
