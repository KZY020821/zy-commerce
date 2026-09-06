/**
 * Drives the assistant loop with a fake model client so the tool protocol,
 * the `respond` contract and the fallbacks are verified without network.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, runAssistant, type AssistantStoreContext, type MessagesClient } from "@/lib/ai/assistant";
import * as tools from "@/lib/ai/tools";

const store: AssistantStoreContext = {
  storeName: "Selkirk Demo",
  assistantName: "Fit Assistant",
  currency: "MYR",
  locale: "ms-MY",
  country: "MY",
  profile: { productCount: 2, categories: [{ slug: "paddles", name: "Paddles", productCount: 2, priceMin: 30000, priceMax: 90000, brands: ["Selkirk"], facets: [{ key: "Core Thickness", coverage: 2, values: ["16mm", "13mm"] }] }] },
};

function message(content: unknown[], stop: Anthropic.Message["stop_reason"] = "tool_use"): Anthropic.Message {
  return { id: "msg", type: "message", role: "assistant", model: "fake", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null, service_tier: null } } as unknown as Anthropic.Message;
}

function fakeClient(responses: Anthropic.Message[]): MessagesClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        const next = responses.shift();
        if (!next) throw new Error("fake client ran out of responses");
        return next;
      },
    },
  };
}

const toolCtx = { db: {} as never, currency: "MYR", locale: "ms-MY" };

describe("runAssistant", () => {
  it("executes tool calls, feeds results back, and returns the structured respond payload", async () => {
    const runTool = vi.spyOn(tools, "runAssistantTool").mockResolvedValue(JSON.stringify({ total: 1, products: [{ sku: "SLK-001", name: "SLK Halo" }] }));
    const client = fakeClient([
      message([{ type: "tool_use", id: "t1", name: "search_products", input: { query: "16mm paddle", category: "paddles", minPrice: null, maxPrice: null, inStockOnly: false } }]),
      message([{ type: "tool_use", id: "t2", name: "respond", input: { answer: "The SLK Halo has a 16mm core.", suggestions: ["Compare with XL", "Show cheaper"], productSkus: ["SLK-001"] } }]),
    ]);

    const reply = await runAssistant({ client, model: "fake", store, tools: toolCtx, history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], userMessage: "which 16mm paddle?" });

    expect(reply.answer).toBe("The SLK Halo has a 16mm core.");
    expect(reply.suggestions).toEqual(["Compare with XL", "Show cheaper"]);
    expect(reply.productSkus).toEqual(["SLK-001"]);
    expect(reply.toolCalls.map((t) => t.name)).toEqual(["search_products"]);
    expect(runTool).toHaveBeenCalledWith("search_products", expect.objectContaining({ query: "16mm paddle" }), toolCtx);

    // Second request carries the assistant tool_use turn and a tool_result for it
    const second = client.calls[1]!;
    expect(second.messages.at(-2)?.role).toBe("assistant");
    const last = second.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect((last.content as Anthropic.ToolResultBlockParam[])[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    // History and system prompt are passed on every call
    expect(second.messages[0]).toEqual({ role: "user", content: "hi" });
    expect(JSON.stringify(second.system)).toContain("Selkirk Demo");
    expect(second.tools?.map((t) => (t as Anthropic.Tool).name)).toContain("respond");
    runTool.mockRestore();
  });

  it("accepts a plain-text answer when the model skips the respond tool", async () => {
    const client = fakeClient([message([{ type: "text", text: "Just text.", citations: null }], "end_turn")]);
    const reply = await runAssistant({ client, model: "fake", store, tools: toolCtx, history: [], userMessage: "hello" });
    expect(reply.answer).toBe("Just text.");
    expect(reply.suggestions).toEqual([]);
  });

  it("returns a safe reply on refusal and never exposes tool errors", async () => {
    const client = fakeClient([message([], "refusal")]);
    const reply = await runAssistant({ client, model: "fake", store, tools: toolCtx, history: [], userMessage: "…" });
    expect(reply.answer).toMatch(/can't help/i);
    expect(reply.suggestions.length).toBeGreaterThan(0);
  });

  it("marks failing tools as errors and still reaches a final answer", async () => {
    const runTool = vi.spyOn(tools, "runAssistantTool").mockRejectedValue(new Error("db down"));
    const client = fakeClient([
      message([{ type: "tool_use", id: "t1", name: "get_product", input: { skuOrSlug: "X" } }]),
      message([{ type: "tool_use", id: "t2", name: "respond", input: { answer: "Sorry, I couldn't look that up.", suggestions: [], productSkus: [] } }]),
    ]);
    const reply = await runAssistant({ client, model: "fake", store, tools: toolCtx, history: [], userMessage: "details of X" });
    expect(reply.answer).toMatch(/couldn't/i);
    const result = (client.calls[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(true);
    runTool.mockRestore();
  });

  it("gives up gracefully after the tool-round limit", async () => {
    vi.spyOn(tools, "runAssistantTool").mockResolvedValue("{}");
    const loop = Array.from({ length: 10 }, (_, i) => message([{ type: "tool_use", id: `t${i}`, name: "list_categories", input: {} }]));
    const client = fakeClient(loop);
    const reply = await runAssistant({ client, model: "fake", store, tools: toolCtx, history: [], userMessage: "loop" });
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
