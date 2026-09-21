/**
 * Two things a shop owner asks that the package could not answer: what a
 * conversation costs, and whether a big catalogue has to be read on every
 * message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedCatalogues, invalidateCatalogue, loadCatalogue, DEFAULT_CACHE_TTL_MS } from "../src/catalogue-cache";
import { estimateCost, replyUsage, totalUsage } from "../src/cost";
import type { CatalogAdapter, CatalogueProduct } from "../src/types";

const product = (ref: string): CatalogueProduct => ({ ref, name: `Paddle ${ref}`, price: 1000 });

function countingAdapter(products: CatalogueProduct[] = [product("PAD-1")]): CatalogAdapter & { reads: () => number } {
  let reads = 0;
  return {
    listCatalogue: async () => {
      reads += 1;
      return products;
    },
    getProduct: async () => null,
    reads: () => reads,
  };
}

describe("estimateCost", () => {
  // DeepSeek's published rates at the time of writing, as an example only.
  const rates = { inputPerMillion: 0.28, outputPerMillion: 0.42, cachedInputPerMillion: 0.028 };

  it("bills fresh input, cached input and output at their own rates", () => {
    const cost = estimateCost({ inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 8_000 }, rates);

    // 2,000 fresh at 0.28/M + 8,000 cached at 0.028/M, plus 1,000 out at 0.42/M.
    expect(cost.input).toBeCloseTo((2_000 * 0.28 + 8_000 * 0.028) / 1_000_000, 10);
    expect(cost.output).toBeCloseTo(1_000 * 0.42 / 1_000_000, 10);
    expect(cost.total).toBeCloseTo(cost.input + cost.output, 10);
  });

  it("never bills a cached token twice, however the provider reports it", () => {
    const honest = estimateCost({ inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 1_000 }, rates);
    const impossible = estimateCost({ inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 5_000 }, rates);

    expect(impossible).toEqual(honest);
    expect(honest.input).toBeCloseTo(1_000 * 0.028 / 1_000_000, 10);
  });

  it("charges cached input at the full rate when the host gives no cached rate", () => {
    expect(estimateCost({ inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 1_000 }, { inputPerMillion: 0.28, outputPerMillion: 0.42 }).input).toBeCloseTo(1_000 * 0.28 / 1_000_000, 10);
  });

  it("costs nothing for a turn the guard answered without a model", () => {
    expect(estimateCost(undefined, rates)).toEqual({ input: 0, output: 0, total: 0 });
    expect(replyUsage({ usage: undefined })).toEqual({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  });
});

describe("totalUsage", () => {
  it("adds up a conversation, ignoring the turns that never reached the model", () => {
    expect(totalUsage([{ inputTokens: 100, outputTokens: 10, cachedInputTokens: 50 }, undefined, { inputTokens: 200, outputTokens: 20, cachedInputTokens: 0 }])).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cachedInputTokens: 50,
    });
  });
});

describe("loadCatalogue", () => {
  beforeEach(() => {
    invalidateCatalogue();
  });

  it("reads the catalogue every time when no cache was asked for", async () => {
    const adapter = countingAdapter();

    await loadCatalogue(adapter);
    await loadCatalogue(adapter);

    expect(adapter.reads()).toBe(2);
    expect(cachedCatalogues()).toBe(0);
  });

  it("reuses the snapshot within the window, and reads again after it", async () => {
    const adapter = countingAdapter();
    const now = 1_000_000;

    expect(await loadCatalogue(adapter, { key: "store-a" }, now)).toEqual([product("PAD-1")]);
    await loadCatalogue(adapter, { key: "store-a" }, now + DEFAULT_CACHE_TTL_MS - 1);
    expect(adapter.reads()).toBe(1);

    await loadCatalogue(adapter, { key: "store-a" }, now + DEFAULT_CACHE_TTL_MS + 1);
    expect(adapter.reads()).toBe(2);
  });

  it("keeps one store's catalogue away from another's", async () => {
    const acme = countingAdapter([product("ACME-1")]);
    const other = countingAdapter([product("OTHER-1")]);

    expect(await loadCatalogue(acme, { key: "acme" })).toEqual([product("ACME-1")]);
    expect(await loadCatalogue(other, { key: "other" })).toEqual([product("OTHER-1")]);
    expect(await loadCatalogue(acme, { key: "acme" })).toEqual([product("ACME-1")]);
    expect(acme.reads()).toBe(1);
  });

  it("forgets a store on request, so a long window is safe after an import", async () => {
    const adapter = countingAdapter();

    await loadCatalogue(adapter, { key: "store-a", ttlMs: 60 * 60_000 });
    invalidateCatalogue("store-a");
    await loadCatalogue(adapter, { key: "store-a", ttlMs: 60 * 60_000 });

    expect(adapter.reads()).toBe(2);
  });

  it("holds a bounded number of stores, dropping the coldest", async () => {
    const adapter = countingAdapter();
    for (let i = 0; i < 40; i++) await loadCatalogue(adapter, { key: `store-${i}` });

    expect(cachedCatalogues()).toBe(32);
    // The first store was evicted; the most recent ones are still there.
    await loadCatalogue(adapter, { key: "store-0" });
    expect(adapter.reads()).toBe(41);
  });
});

describe("askConcierge with a cache", () => {
  it("passes the host's cache options through", async () => {
    const { askConcierge } = await import("../src/concierge");
    const adapter = countingAdapter();
    const client = { chat: { completions: { create: vi.fn() } } };
    client.chat.completions.create.mockResolvedValue({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "test",
      choices: [{ index: 0, logprobs: null, finish_reason: "tool_calls", message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: "1", type: "function", function: { name: "respond", arguments: '{"answer":"Sure.","suggestions":[],"productRefs":[],"productNotes":[]}' } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
    const options = { store: { storeName: "Acme", assistantName: "Fit", currency: "USD", locale: "en-US" }, adapter, model: { client: client as never, modelId: "test" }, cache: { key: "acme-store" } };

    await askConcierge(options, { message: "show me paddles", history: [] });
    await askConcierge(options, { message: "show me paddles", history: [] });

    expect(adapter.reads()).toBe(1);
    invalidateCatalogue();
  });
});
