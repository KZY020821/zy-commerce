/**
 * askConcierge end to end, with an in-memory catalogue and a scripted model:
 * the guard decides before any model call, product cards come only from the
 * catalogue, and the conversation state the host supplies drives the
 * follow-up rules. No database, no network.
 */
import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessagesClient } from "../src/assistant";
import { askConcierge, ConciergeNotConfiguredError, conciergeStarters } from "../src/concierge";
import { formatMoney } from "../src/format";
import { OFF_TOPIC_REPLY } from "../src/guard";
import type { CatalogAdapter, CatalogueProduct, ConversationTurn } from "../src/types";

const catalogue: CatalogueProduct[] = [
  { ref: "PAD-1", name: "Atlas Control Paddle", brand: "Selkirk", category: { slug: "paddles", name: "Paddles" }, price: 22090, stockQuantity: 12, specs: { "Core Thickness": "16mm", "Skill Level": "Beginner" }, url: "/products/atlas", imageUrl: "https://img.test/atlas.png" },
  { ref: "PAD-2", name: "Vanguard Power Paddle", brand: "Selkirk", category: { slug: "paddles", name: "Paddles" }, price: 44590, priceFrom: true, stockQuantity: 2, lowStockThreshold: 5, specs: { "Core Thickness": "13mm", "Skill Level": "Advanced" } },
  { ref: "BALL-1", name: "Outdoor Ball 6-pack", brand: "SLK", category: { slug: "balls", name: "Balls" }, price: 3090, stockQuantity: 0, specs: { Use: "Outdoor" } },
];

function makeAdapter(): CatalogAdapter & { listCatalogue: ReturnType<typeof vi.fn> } {
  return {
    listCatalogue: vi.fn(async () => catalogue),
    getProduct: async (ref: string) => catalogue.find((p) => p.ref.toLowerCase() === ref.toLowerCase()) ?? null,
  };
}

const store = { storeName: "Selkirk Demo", assistantName: "Fit Assistant", currency: "MYR", locale: "en-MY" };

/** A completion whose only tool call is `respond` with this payload. */
function respondWith(payload: { answer: string; suggestions?: string[]; productRefs?: string[] }): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "cmpl",
    object: "chat.completion",
    created: 0,
    model: "deepseek-test",
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "respond", arguments: JSON.stringify({ suggestions: [], productRefs: [], ...payload }) } }],
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 100 } },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

/** Records every request; fails loudly if the model is asked more than scripted. */
function scriptedModel(responses: OpenAI.Chat.Completions.ChatCompletion[]) {
  const calls: unknown[] = [];
  const client: MessagesClient = {
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          const next = responses.shift();
          if (!next) throw new Error("the model was called when it should not have been");
          return next;
        },
      },
    },
  };
  return { model: { client, modelId: "deepseek-test" }, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("askConcierge — the off-topic guard runs before the model", () => {
  it("refuses an unrelated question with the exact reply and never calls the model", async () => {
    const { model, calls } = scriptedModel([]);
    const adapter = makeAdapter();

    const reply = await askConcierge({ store, adapter, model }, { message: "what's the weather like today?", history: [] });

    expect(reply.answer).toBe(OFF_TOPIC_REPLY);
    expect(reply.origin).toEqual({ kind: "blocked", reason: "blocked-pattern" });
    expect(reply.products).toEqual([]);
    expect(reply.usage).toBeUndefined();
    expect(calls).toHaveLength(0);
    // "Try with the sample questions below" — the same chips the widget opens with.
    expect(reply.suggestions).toEqual(await conciergeStarters(adapter));
  });

  it("lets the host switch the guard off, and then the model answers anything", async () => {
    const { model, calls } = scriptedModel([respondWith({ answer: "Sunny." })]);
    const reply = await askConcierge({ store, adapter: makeAdapter(), model, disableTopicGuard: true }, { message: "what's the weather like today?", history: [] });
    expect(reply.answer).toBe("Sunny.");
    expect(calls).toHaveLength(1);
  });
});

describe("askConcierge — answers from the catalogue", () => {
  it("resolves the products the model names into cards, in its order, dropping any it made up", async () => {
    const { model, calls } = scriptedModel([respondWith({ answer: "Two good options.", suggestions: ["Compare the top two"], productRefs: ["pad-2", "NOT-A-PRODUCT", "PAD-1"] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "which paddle is best for a beginner?", history: [] });

    expect(calls).toHaveLength(1);
    expect(reply.answer).toBe("Two good options.");
    expect(reply.suggestions).toEqual(["Compare the top two"]);
    expect(reply.origin).toEqual({ kind: "model", toolCalls: [] });
    expect(reply.usage).toEqual({ inputTokens: 120, outputTokens: 30, cachedInputTokens: 100 });
    expect(reply.products).toEqual([
      { ref: "PAD-2", name: "Vanguard Power Paddle", url: null, imageUrl: null, price: 44590, priceFrom: true, priceLabel: formatMoney(44590, "MYR", "en-MY"), stockLabel: "Low stock" },
      { ref: "PAD-1", name: "Atlas Control Paddle", url: "/products/atlas", imageUrl: "https://img.test/atlas.png", price: 22090, priceFrom: false, priceLabel: formatMoney(22090, "MYR", "en-MY"), stockLabel: "In stock" },
    ]);
  });

  it("falls back to the opening chips when the model offers none", async () => {
    const adapter = makeAdapter();
    const { model } = scriptedModel([respondWith({ answer: "Here you go.", suggestions: [] })]);
    const reply = await askConcierge({ store, adapter, model }, { message: "show me paddles", history: [] });
    expect(reply.suggestions).toEqual(await conciergeStarters(adapter));
  });

  it("reads the catalogue exactly once per message, whatever the model does", async () => {
    const adapter = makeAdapter();
    const { model } = scriptedModel([respondWith({ answer: "Ok." })]);
    await askConcierge({ store, adapter, model }, { message: "show me paddles", history: [] });
    expect(adapter.listCatalogue).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when no model is configured", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    await expect(askConcierge({ store, adapter: makeAdapter() }, { message: "show me paddles", history: [] })).rejects.toBeInstanceOf(ConciergeNotConfiguredError);
  });
});

describe("askConcierge — follow-ups use the conversation the host stored", () => {
  const ask = async (message: string, history: ConversationTurn[]) => {
    const { model, calls } = scriptedModel([respondWith({ answer: "Ok." })]);
    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message, history });
    return { blocked: reply.origin.kind === "blocked", modelCalls: calls.length };
  };

  it("treats a short reply as an answer when the assistant's last turn asked a question", async () => {
    const asked: ConversationTurn[] = [
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "How often do you play?" },
    ];
    const told: ConversationTurn[] = [
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "Here are two options." },
    ];
    expect(await ask("twice a week", asked)).toEqual({ blocked: false, modelCalls: 1 });
    expect(await ask("twice a week", told)).toEqual({ blocked: true, modelCalls: 0 });
  });

  it("admits a chip the assistant offered, even one naming nothing in the catalogue", async () => {
    const offered: ConversationTurn[] = [
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "Here are two options.", suggestions: ["Quiet mornings"] },
    ];
    const notOffered: ConversationTurn[] = [
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "Here are two options." },
    ];
    expect(await ask("Quiet mornings", offered)).toEqual({ blocked: false, modelCalls: 1 });
    expect(await ask("Quiet mornings", notOffered)).toEqual({ blocked: true, modelCalls: 0 });
  });
});
