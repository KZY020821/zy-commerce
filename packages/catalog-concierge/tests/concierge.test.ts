/**
 * askConcierge end to end, with an in-memory catalogue and a scripted model:
 * the guard decides before any model call, product cards come only from the
 * catalogue, and the conversation state the host supplies drives the
 * follow-up rules. No database, no network.
 */
import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessagesClient } from "../src/assistant";
import { askConcierge, askConciergeStream, ConciergeNotConfiguredError, conciergeStarters, type ConciergeEvent } from "../src/concierge";
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
function respondWith(payload: { answer: string; suggestions?: string[]; productRefs?: string[]; productNotes?: string[] }): OpenAI.Chat.Completions.ChatCompletion {
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
          tool_calls: [{ id: "call_1", type: "function", function: { name: "respond", arguments: JSON.stringify({ suggestions: [], productRefs: [], productNotes: [], ...payload }) } }],
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 100 } },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

/** A completion whose only tool call opens the catalogue, as the model does before answering. */
function lookupWith(name: "get_product" | "compare_products", input: Record<string, unknown>): OpenAI.Chat.Completions.ChatCompletion {
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
        message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: "call_lookup", type: "function", function: { name, arguments: JSON.stringify(input) } }] },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 0 } },
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

/** A model that streams: chunks in, chunks out, exactly as an SDK would. */
function streamingModel(chunks: Array<Record<string, unknown>>) {
  const create = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk as never;
    },
  }));
  return { model: { client: { chat: { completions: { create } } } as never, modelId: "deepseek-test" }, create };
}

/** One chunk of a `respond` call's arguments arriving. */
const respondChunk = (args: string, index = 0) => ({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: "call_1", type: "function", function: { name: "respond", arguments: args } }] } }] });

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

describe("askConcierge — a product it talks about always gets a card", () => {
  it("cards the product it just opened, even when it lists none", async () => {
    // The bug this guards: the model describes a product it fetched, tells the
    // customer to tap the card, and leaves productRefs empty.
    const { model } = scriptedModel([
      lookupWith("get_product", { ref: "PAD-1" }),
      respondWith({ answer: "Here's the Atlas Control Paddle. Tap the card below to open it.", productRefs: [] }),
    ]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "take me to the atlas paddle", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1"]);
    expect(reply.products[0]!.url).toBe("/products/atlas");
  });

  it("cards every product it compared when it lists none", async () => {
    const { model } = scriptedModel([
      lookupWith("compare_products", { refs: ["PAD-1", "PAD-2"] }),
      respondWith({ answer: "They differ in core thickness.", productRefs: [] }),
    ]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "compare the top two", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1", "PAD-2"]);
  });

  it("accepts a slug or a product name where a reference was expected", async () => {
    const { model } = scriptedModel([respondWith({ answer: "Both work.", productRefs: ["atlas", "Vanguard Power Paddle"] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "which paddle should I get?", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1", "PAD-2"]);
  });

  it("recovers a reference quoted in the answer when nothing was listed or opened", async () => {
    const { model } = scriptedModel([respondWith({ answer: "PAD-2 is the powerful one.", productRefs: [] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "which paddle has the most power?", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-2"]);
  });

  it("cards a product the answer only names, when it opened nothing", async () => {
    // The commonest shape once a conversation is running: the model answers
    // from what it said earlier, calls no tool, and lists no reference.
    const { model } = scriptedModel([respondWith({ answer: "Here's the Atlas Control Paddle — tap the card to open its page.", productRefs: [] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "take me to the atlas paddle", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1"]);
  });

  it("cards both products when the answer names two, in the order named", async () => {
    const { model } = scriptedModel([respondWith({ answer: "The Vanguard Power Paddle hits harder; the Atlas Control Paddle is easier to place.", productRefs: [] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "power or control?", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-2", "PAD-1"]);
  });

  it("attaches nothing when the name could be either product", async () => {
    const twins: CatalogueProduct[] = [
      { ref: "V-16", name: "Vanguard Control 16", category: { slug: "paddles", name: "Paddles" }, price: 30000, stockQuantity: 5 },
      { ref: "V-13", name: "Vanguard Control 13", category: { slug: "paddles", name: "Paddles" }, price: 32000, stockQuantity: 5 },
    ];
    const adapter: CatalogAdapter = {
      listCatalogue: async () => twins,
      getProduct: async (ref: string) => twins.find((p) => p.ref.toLowerCase() === ref.toLowerCase()) ?? null,
    };
    const { model } = scriptedModel([respondWith({ answer: "The Vanguard Control is a good pick either way.", productRefs: [] })]);

    const reply = await askConcierge({ store, adapter, model }, { message: "which vanguard?", history: [] });

    expect(reply.products).toEqual([]);
  });

  it("treats a short, word-like slug as prose, not a citation", async () => {
    // PAD-1 lives at /products/atlas; the word "atlas" in a sentence is not a citation.
    const { model } = scriptedModel([respondWith({ answer: "We keep an atlas of paddle shapes on the blog.", productRefs: [] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "do you have paddle shape guides?", history: [] });

    expect(reply.products).toEqual([]);
  });

  it("invents no cards from ordinary prose", async () => {
    const { model } = scriptedModel([respondWith({ answer: "We sell paddles and balls — what are you after?", productRefs: [] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "what do you sell?", history: [] });

    expect(reply.products).toEqual([]);
  });

  it("keeps the model's own list, and does not add what it opened along the way", async () => {
    const { model } = scriptedModel([
      lookupWith("get_product", { ref: "PAD-2" }),
      respondWith({ answer: "The Atlas is the better beginner pick.", productRefs: ["PAD-1"] }),
    ]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "atlas or vanguard for a beginner?", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1"]);
  });

  it("never repeats a product, whichever spelling the model used", async () => {
    const { model } = scriptedModel([respondWith({ answer: "This one.", productRefs: ["PAD-1", "pad-1", "atlas"] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "show me the atlas", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1"]);
  });

  it("shows at most four cards when it recovers them itself", async () => {
    const many: CatalogueProduct[] = Array.from({ length: 5 }, (_, i) => ({
      ref: `P-${i + 1}`,
      name: `Paddle ${i + 1}`,
      category: { slug: "paddles", name: "Paddles" },
      price: 10000 + i,
      stockQuantity: 4,
    }));
    const adapter: CatalogAdapter = {
      listCatalogue: async () => many,
      getProduct: async (ref: string) => many.find((p) => p.ref.toLowerCase() === ref.toLowerCase()) ?? null,
    };
    const { model } = scriptedModel([
      lookupWith("compare_products", { refs: ["P-1", "P-2", "P-3", "P-4"] }),
      respondWith({ answer: "P-5 is cheaper than the four above.", productRefs: [] }),
    ]);

    const reply = await askConcierge({ store, adapter, model }, { message: "compare the paddles", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["P-1", "P-2", "P-3", "P-4"]);
  });
});

describe("askConcierge — the product the customer is looking at", () => {
  /** The system prompt of the first request the model received. */
  const systemPrompt = (calls: unknown[]) => ((calls[0] as { messages: { role: string; content: string }[] }).messages[0]!.content);

  it("tells the model which product is on screen, by name and reference", async () => {
    const { model, calls } = scriptedModel([respondWith({ answer: "It suits beginners." })]);

    await askConcierge({ store, adapter: makeAdapter(), model }, { message: "is this one good for a beginner?", history: [], viewing: "PAD-1" });

    expect(systemPrompt(calls)).toContain('The customer is looking at "Atlas Control Paddle" (PAD-1) right now.');
  });

  it("says nothing when the host names a product this catalogue does not have", async () => {
    const { model, calls } = scriptedModel([respondWith({ answer: "Which paddle do you mean?" })]);

    await askConcierge({ store, adapter: makeAdapter(), model }, { message: "is this paddle any good?", history: [], viewing: "../../etc/passwd" });

    expect(systemPrompt(calls)).not.toContain("The customer is looking at");
  });

  // "Is this any good?" names nothing a catalogue would recognise. On a
  // product page it is obviously about the product on screen, and refusing it
  // there is the most visible way this assistant can look stupid.
  it("lets a question about the product on screen through the guard", async () => {
    const { model } = scriptedModel([respondWith({ answer: "It is a beginner-friendly paddle." })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "is this any good?", history: [], viewing: "PAD-1" });

    expect(reply.origin).toMatchObject({ kind: "model" });
  });

  it("still refuses the same question asked from anywhere else", async () => {
    const { model, calls } = scriptedModel([]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "is this any good?", history: [] });

    expect(reply.answer).toBe(OFF_TOPIC_REPLY);
    expect(calls).toHaveLength(0);
  });

  it("says nothing at all when the host passes no page", async () => {
    const { model, calls } = scriptedModel([respondWith({ answer: "Happy to help." })]);

    await askConcierge({ store, adapter: makeAdapter(), model }, { message: "show me paddles", history: [] });

    expect(systemPrompt(calls)).not.toContain("The customer is looking at");
  });
});

describe("askConciergeStream — saying what it is doing while it does it", () => {
  /** Drains a stream, keeping every event it reported on the way. */
  async function collect(stream: AsyncGenerator<ConciergeEvent, Awaited<ReturnType<typeof askConcierge>>>) {
    const events: string[] = [];
    let step = await stream.next();
    while (!step.done) {
      events.push(step.value.kind === "tool" ? step.value.name : `answer:${step.value.delta}`);
      step = await stream.next();
    }
    return { events, reply: step.value };
  }

  it("reports each tool call before it runs, in order, and still returns the finished reply", async () => {
    const { model } = scriptedModel([
      lookupWith("get_product", { ref: "PAD-1" }),
      lookupWith("compare_products", { refs: ["PAD-1", "PAD-2"] }),
      respondWith({ answer: "The Atlas is gentler.", productRefs: ["PAD-1"] }),
    ]);

    const { events, reply } = await collect(askConciergeStream({ store, adapter: makeAdapter(), model }, { message: "compare the two paddles", history: [] }));

    expect(events).toEqual(["get_product", "compare_products"]);
    expect(reply.answer).toBe("The Atlas is gentler.");
    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1"]);
  });

  it("reports nothing at all for a message the guard turns away", async () => {
    const { model, calls } = scriptedModel([]);

    const { events, reply } = await collect(askConciergeStream({ store, adapter: makeAdapter(), model }, { message: "what's the weather like today?", history: [] }));

    expect(events).toEqual([]);
    expect(reply.answer).toBe(OFF_TOPIC_REPLY);
    expect(calls).toHaveLength(0);
  });

  // One turn, one implementation: the non-streaming call is this one drained.
  it("gives exactly what askConcierge gives", async () => {
    const withStream = scriptedModel([lookupWith("get_product", { ref: "PAD-1" }), respondWith({ answer: "The Atlas.", productRefs: ["PAD-1"] })]);
    const withoutStream = scriptedModel([lookupWith("get_product", { ref: "PAD-1" }), respondWith({ answer: "The Atlas.", productRefs: ["PAD-1"] })]);

    const streamed = await collect(askConciergeStream({ store, adapter: makeAdapter(), model: withStream.model }, { message: "tell me about the atlas", history: [] }));
    const plain = await askConcierge({ store, adapter: makeAdapter(), model: withoutStream.model }, { message: "tell me about the atlas", history: [] });

    expect(streamed.reply).toEqual(plain);
  });
});

describe("askConcierge — why each product is on the card", () => {
  it("puts the model's reason on the card it belongs to", async () => {
    const { model } = scriptedModel([respondWith({ answer: "Two options.", productRefs: ["PAD-1", "PAD-2"], productNotes: ["16mm core, easiest on the arm", "13mm, for power"] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "which paddle for tennis elbow?", history: [] });

    expect(reply.products.map((p) => ({ ref: p.ref, note: p.note }))).toEqual([
      { ref: "PAD-1", note: "16mm core, easiest on the arm" },
      { ref: "PAD-2", note: "13mm, for power" },
    ]);
  });

  // A shifted list would put one product's reason under another's name.
  it("says nothing at all when the reasons do not line up with the products", async () => {
    const { model } = scriptedModel([respondWith({ answer: "Two options.", productRefs: ["PAD-1", "PAD-2"], productNotes: ["only one reason"] })]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "which paddle?", history: [] });

    expect(reply.products.every((p) => p.note === undefined)).toBe(true);
  });

  it("leaves a recovered card without a reason, because the model gave none", async () => {
    const { model } = scriptedModel([
      lookupWith("get_product", { ref: "PAD-1" }),
      respondWith({ answer: "Tap the card below for the Atlas.", productRefs: [], productNotes: [] }),
    ]);

    const reply = await askConcierge({ store, adapter: makeAdapter(), model }, { message: "tell me about the atlas", history: [] });

    expect(reply.products.map((p) => p.ref)).toEqual(["PAD-1"]);
    expect(reply.products[0]!.note).toBeUndefined();
  });
});

describe("askConciergeStream — the answer as it is written", () => {
  async function collectStream(stream: AsyncGenerator<ConciergeEvent, Awaited<ReturnType<typeof askConcierge>>>) {
    const deltas: string[] = [];
    let step = await stream.next();
    while (!step.done) {
      if (step.value.kind === "answer") deltas.push(step.value.delta);
      step = await stream.next();
    }
    return { deltas, reply: step.value };
  }

  it("reports the answer in pieces, then returns the finished reply", async () => {
    const { model } = streamingModel([
      respondChunk('{"answer":"The Atlas'),
      respondChunk(' suits beginners.'),
      respondChunk('","suggestions":["Compare them"],"productRefs":["PAD-1"],"productNotes":["16mm core"]}'),
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 900, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 600 } } },
    ]);

    const { deltas, reply } = await collectStream(askConciergeStream({ store, adapter: makeAdapter(), model, streamAnswer: true }, { message: "which paddle for a beginner?", history: [] }));

    expect(deltas).toEqual(["The Atlas", " suits beginners."]);
    expect(deltas.join("")).toBe(reply.answer);
    expect(reply.suggestions).toEqual(["Compare them"]);
    expect(reply.products.map((p) => ({ ref: p.ref, note: p.note }))).toEqual([{ ref: "PAD-1", note: "16mm core" }]);
    expect(reply.usage).toEqual({ inputTokens: 900, outputTokens: 120, cachedInputTokens: 600 });
  });

  it("never sends the same character twice, however the chunks fall", async () => {
    const whole = '{"answer":"Both are 16mm \\"control\\" paddles.\\nThe Atlas is lighter.","suggestions":[],"productRefs":[],"productNotes":[]}';
    const { model } = streamingModel([...Array.from({ length: whole.length }, (_, i) => respondChunk(whole[i]!)), { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]);

    const { deltas, reply } = await collectStream(askConciergeStream({ store, adapter: makeAdapter(), model, streamAnswer: true }, { message: "compare the paddles", history: [] }));

    expect(deltas.join("")).toBe('Both are 16mm "control" paddles.\nThe Atlas is lighter.');
    expect(reply.answer).toBe(deltas.join(""));
  });

  it("streams a plain-text answer too, for a model that never calls respond", async () => {
    const { model } = streamingModel([
      { choices: [{ index: 0, delta: { content: "We stock " } }] },
      { choices: [{ index: 0, delta: { content: "three paddles." } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);

    const { deltas, reply } = await collectStream(askConciergeStream({ store, adapter: makeAdapter(), model, streamAnswer: true }, { message: "what paddles do you have?", history: [] }));

    expect(deltas).toEqual(["We stock ", "three paddles."]);
    expect(reply.answer).toBe("We stock three paddles.");
  });

  it("says nothing until the answer starts, while it is using its tools", async () => {
    // Two rounds: the first opens a product, the second answers.
    const lookingUp = streamingModel([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_product", arguments: '{"ref":"PAD-1"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const answering = streamingModel([respondChunk('{"answer":"The Atlas.","suggestions":[],"productRefs":[],"productNotes":[]}'), { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]);
    const rounds = [lookingUp.create, answering.create];
    let round = 0;
    const client = { chat: { completions: { create: async () => rounds[Math.min(round++, rounds.length - 1)]!() } } };

    const { deltas, reply } = await collectStream(
      askConciergeStream({ store, adapter: makeAdapter(), model: { client: client as never, modelId: "deepseek-test" }, streamAnswer: true }, { message: "tell me about the atlas", history: [] }),
    );

    expect(deltas).toEqual(["The Atlas."]);
    expect(reply.origin).toMatchObject({ kind: "model", toolCalls: ["get_product"] });
  });

  // Models emit several tool calls in one round, their chunks interleaved and
  // in no particular order; they have to be reassembled by index.
  it("puts two tool calls back together in the order the model numbered them", async () => {
    const lookingUp = streamingModel([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "get_product", arguments: '{"ref":"PAD-' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_products", arguments: '{"query":"paddle","category":null,"minPrice":null,"maxPrice":null,"inStockOnly":false}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '2"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const answering = streamingModel([respondChunk('{"answer":"Both are good.","suggestions":[],"productRefs":[],"productNotes":[]}'), { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]);
    const rounds = [lookingUp.create, answering.create];
    let round = 0;
    const client = { chat: { completions: { create: async () => rounds[Math.min(round++, rounds.length - 1)]!() } } };

    const { reply } = await collectStream(
      askConciergeStream({ store, adapter: makeAdapter(), model: { client: client as never, modelId: "deepseek-test" }, streamAnswer: true }, { message: "compare the paddles", history: [] }),
    );

    expect(reply.origin).toMatchObject({ kind: "model", toolCalls: ["search_products", "get_product"] });
    expect(reply.answer).toBe("Both are good.");
  });

  it("handles a refusal, and the usage-only chunk providers send at the end", async () => {
    const { model } = streamingModel([
      { choices: [{ index: 0, delta: { refusal: "I can't help" } }] },
      { choices: [{ index: 0, delta: { refusal: " with that." } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] },
      // DeepSeek's last chunk carries usage and no choice at all.
      { choices: [], usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 0 } } },
    ]);

    const { deltas, reply } = await collectStream(askConciergeStream({ store, adapter: makeAdapter(), model, streamAnswer: true }, { message: "which paddle?", history: [] }));

    expect(deltas).toEqual([]);
    expect(reply.answer).toMatch(/can't help with that request/);
    expect(reply.usage).toEqual({ inputTokens: 120, outputTokens: 8, cachedInputTokens: 0 });
  });

  it("does not stream at all unless the host asked for it", async () => {
    const { model } = scriptedModel([respondWith({ answer: "The Atlas." })]);

    const { deltas, reply } = await collectStream(askConciergeStream({ store, adapter: makeAdapter(), model }, { message: "which paddle?", history: [] }));

    expect(deltas).toEqual([]);
    expect(reply.answer).toBe("The Atlas.");
  });
});

describe("askConciergeStream — thinking out loud, then answering", () => {
  it("tells the host to start again when the real answer begins", async () => {
    const narrating = streamingModel([
      // The model narrates before it reaches for a tool…
      { choices: [{ index: 0, delta: { content: "I'll look for beginner paddles." } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_products", arguments: '{"query":"paddle","category":null,"minPrice":null,"maxPrice":null,"inStockOnly":false}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const answering = streamingModel([respondChunk('{"answer":"The Atlas'), respondChunk(' suits beginners.","suggestions":[],"productRefs":[],"productNotes":[]}'), { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]);
    const rounds = [narrating.create, answering.create];
    let round = 0;
    const client = { chat: { completions: { create: async () => rounds[Math.min(round++, rounds.length - 1)]!() } } };

    const events: Array<{ delta: string; restart?: true }> = [];
    const stream = askConciergeStream({ store, adapter: makeAdapter(), model: { client: client as never, modelId: "deepseek-test" }, streamAnswer: true }, { message: "which paddle for a beginner?", history: [] });
    let step = await stream.next();
    while (!step.done) {
      if (step.value.kind === "answer") events.push({ delta: step.value.delta, ...(step.value.restart ? { restart: true } : {}) });
      step = await stream.next();
    }

    expect(events).toEqual([
      { delta: "I'll look for beginner paddles." },
      // The real answer starts here: whatever was on screen goes.
      { delta: "The Atlas", restart: true },
      { delta: " suits beginners." },
    ]);
    expect(step.value.answer).toBe("The Atlas suits beginners.");
  });
});

describe("askConciergeStream — a second thought", () => {
  it("replaces the last thought rather than running into it", async () => {
    const first = streamingModel([
      { choices: [{ index: 0, delta: { content: "I'll look that up now." } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_products", arguments: '{"query":"paddle","category":null,"minPrice":null,"maxPrice":null,"inStockOnly":false}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const second = streamingModel([
      { choices: [{ index: 0, delta: { content: "I need the weight specs." } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c2", type: "function", function: { name: "get_product", arguments: '{"ref":"PAD-1"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const third = streamingModel([respondChunk('{"answer":"The Atlas is lightest.","suggestions":[],"productRefs":[],"productNotes":[]}'), { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]);
    const rounds = [first.create, second.create, third.create];
    let round = 0;
    const client = { chat: { completions: { create: async () => rounds[Math.min(round++, rounds.length - 1)]!() } } };

    const events: Array<{ delta: string; restart?: true }> = [];
    const stream = askConciergeStream({ store, adapter: makeAdapter(), model: { client: client as never, modelId: "deepseek-test" }, streamAnswer: true }, { message: "what is your lightest paddle?", history: [] });
    let step = await stream.next();
    while (!step.done) {
      if (step.value.kind === "answer") events.push({ delta: step.value.delta, ...(step.value.restart ? { restart: true } : {}) });
      step = await stream.next();
    }

    expect(events).toEqual([
      { delta: "I'll look that up now." },
      { delta: "I need the weight specs.", restart: true },
      { delta: "The Atlas is lightest.", restart: true },
    ]);
  });
});
