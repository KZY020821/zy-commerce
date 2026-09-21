/**
 * The evaluation a prospective client runs before paying for anything, and
 * the command that drives it. The model is scripted: what is under test is
 * what the report says about a catalogue, not what a model says about it.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArgs, parseCatalogue, run } from "../src/cli";
import { arrayAdapter, evaluateCatalogue } from "../src/evaluate";
import { assessCatalogue, countSpecs } from "../src/readiness";
import type { CatalogueProduct } from "../src/types";

const catalogue: CatalogueProduct[] = [
  { ref: "PAD-1", name: "Atlas Control Paddle", price: 22090, category: { slug: "paddles", name: "Paddles" }, description: "A forgiving control paddle.", imageUrl: "https://img.test/a.png", specs: { "Core Thickness": "16mm", "Skill Level": "Beginner" } },
  { ref: "PAD-2", name: "Vanguard Power Paddle", price: 44590, category: { slug: "paddles", name: "Paddles" }, specs: { "Core Thickness": "13mm" } },
  { ref: "BALL-1", name: "Outdoor Ball 6-pack", price: 3090, category: { slug: "balls", name: "Balls" }, specs: { Use: "  " } },
];

const store = { storeName: "Selkirk Demo", assistantName: "Fit Assistant", currency: "MYR", locale: "en-MY" };

/** A model that answers every turn with the same `respond` call. */
function scriptedModel(payload: { answer: string; productRefs?: string[] }) {
  const completion = {
    id: "c",
    object: "chat.completion",
    created: 0,
    model: "test",
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: "tool_calls",
        message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: "1", type: "function", function: { name: "respond", arguments: JSON.stringify({ suggestions: [], productNotes: [], productRefs: [], ...payload }) } }] },
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020, prompt_tokens_details: { cached_tokens: 600 } },
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
  return { client: { chat: { completions: { create: async () => completion } } } as never, modelId: "test" };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assessCatalogue", () => {
  it("measures what the assistant has to work with", () => {
    expect(assessCatalogue(catalogue)).toEqual({
      products: 3,
      withSpecs: 2,
      withDescription: 1,
      withImage: 1,
      specCoverage: 67,
      averageSpecs: 1,
      thinnest: [
        // A blank specification value is not a specification.
        { ref: "BALL-1", name: "Outdoor Ball 6-pack", specCount: 0 },
        { ref: "PAD-2", name: "Vanguard Power Paddle", specCount: 1 },
        { ref: "PAD-1", name: "Atlas Control Paddle", specCount: 2 },
      ],
    });
  });

  it("does not divide by an empty catalogue", () => {
    expect(assessCatalogue([])).toMatchObject({ products: 0, specCoverage: 0, averageSpecs: 0, thinnest: [] });
  });

  it("counts only the specifications that say something", () => {
    expect(countSpecs({ Core: "16mm", Weight: "", Grip: null })).toBe(1);
    expect(countSpecs(null)).toBe(0);
  });
});

describe("evaluateCatalogue", () => {
  it("asks each question and reports what came back", async () => {
    let clock = 1000;
    const evaluation = await evaluateCatalogue(
      { catalogue, store, questions: ["which paddle for a beginner?", "what's the weather like?"], model: scriptedModel({ answer: "The Atlas suits beginners.", productRefs: ["PAD-1"] }) },
      () => (clock += 250),
    );

    expect(evaluation.results[0]).toMatchObject({ question: "which paddle for a beginner?", refused: false, products: ["PAD-1"], answer: "The Atlas suits beginners." });
    // The guard answers this one for nothing, which the report must show.
    expect(evaluation.results[1]).toMatchObject({ refused: true, products: [], usage: { inputTokens: 0, outputTokens: 0 } });
    expect(evaluation.summary).toMatchObject({ asked: 2, answered: 1, refused: 1, withoutProducts: 0 });
    expect(evaluation.summary.usage.inputTokens).toBe(900);
  });

  it("flags an answer that named no product, which is what a thin catalogue looks like", async () => {
    const evaluation = await evaluateCatalogue({ catalogue, store, questions: ["which paddle for a beginner?"], model: scriptedModel({ answer: "I'm not sure." }) });

    expect(evaluation.summary.withoutProducts).toBe(1);
  });

  it("falls back to the store's own opening chips", async () => {
    const evaluation = await evaluateCatalogue({ catalogue, store, model: scriptedModel({ answer: "Sure." }) });

    expect(evaluation.results.map((r) => r.question)).toEqual(["Help me choose", "Show me paddles", "Show me balls", "What's in stock?"]);
  });

  it("costs the run when rates are given", async () => {
    const evaluation = await evaluateCatalogue({ catalogue, store, questions: ["which paddle?"], model: scriptedModel({ answer: "The Atlas." }), rates: { inputPerMillion: 0.28, outputPerMillion: 0.42, cachedInputPerMillion: 0.028 } });

    expect(evaluation.summary.cost).toBeCloseTo((300 * 0.28 + 600 * 0.028 + 120 * 0.42) / 1_000_000, 10);
  });
});

describe("arrayAdapter", () => {
  it("is a catalogue adapter over a plain array", async () => {
    const adapter = arrayAdapter(catalogue);

    expect(await adapter.listCatalogue()).toHaveLength(3);
    expect(await adapter.getProduct("pad-1")).toMatchObject({ ref: "PAD-1" });
    expect(await adapter.getProduct("nope")).toBeNull();
  });
});

describe("parseCatalogue", () => {
  it("takes an array, or an object with a products array", () => {
    expect(parseCatalogue(JSON.stringify(catalogue))).toHaveLength(3);
    expect(parseCatalogue(JSON.stringify({ products: catalogue }))).toHaveLength(3);
  });

  it("says which product is wrong and what is missing", () => {
    expect(() => parseCatalogue("{}")).toThrow(/array of products/);
    expect(() => parseCatalogue('[{"name":"No ref","price":1}]')).toThrow(/Product 1 has no "ref"/);
    expect(() => parseCatalogue('[{"ref":"A","price":1}]')).toThrow(/Product 1 \(A\) has no "name"/);
    expect(() => parseCatalogue('[{"ref":"A","name":"A"}]')).toThrow(/minor units/);
  });
});

describe("parseArgs", () => {
  it("reads the catalogue path and the options", () => {
    expect(parseArgs(["evaluate", "products.json", "--store", "Acme", "--currency", "myr", "--rates", "0.28,0.42,0.028", "--dry"])).toMatchObject({
      catalogue: "products.json",
      store: "Acme",
      currency: "MYR",
      rates: { inputPerMillion: 0.28, outputPerMillion: 0.42, cachedInputPerMillion: 0.028 },
      dry: true,
    });
  });

  it("ignores rates that are not numbers, rather than costing a run wrongly", () => {
    expect(parseArgs(["products.json", "--rates", "cheap,cheaper"]).rates).toBeUndefined();
    expect(parseArgs(["products.json", "--rates", "0.28,0.42"]).rates).toEqual({ inputPerMillion: 0.28, outputPerMillion: 0.42 });
  });
});

describe("the command", () => {
  const lines: string[] = [];
  const log = (line: string) => void lines.push(line);
  const output = () => lines.join("\n");

  async function catalogueFile(products: CatalogueProduct[] = catalogue): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "concierge-cli-"));
    const file = join(dir, "products.json");
    await writeFile(file, JSON.stringify(products));
    return file;
  }

  async function questionsFile(questions: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "concierge-cli-"));
    const file = join(dir, "questions.txt");
    await writeFile(file, `${questions.join("\n")}\n\n`);
    return file;
  }

  afterEach(() => {
    lines.length = 0;
  });

  it("prints how to use it, and fails when given nothing", async () => {
    expect(await run([], log)).toBe(1);
    expect(output()).toContain("catalog-concierge evaluate");

    expect(await run(["--help"], log)).toBe(0);
  });

  it("reports the catalogue without spending anything under --dry", async () => {
    expect(await run(["evaluate", await catalogueFile(), "--dry"], log)).toBe(0);

    expect(output()).toContain("Catalogue: 3 products");
    expect(output()).toContain("with specifications : 2 (67%)");
    expect(output()).toContain("Outdoor Ball 6-pack");
  });

  it("gives the whole thing as JSON when asked", async () => {
    expect(await run(["evaluate", await catalogueFile(), "--dry", "--json"], log)).toBe(0);

    expect(JSON.parse(output())).toMatchObject({ readiness: { products: 3, specCoverage: 67 } });
  });

  it("says what is wrong with a file it cannot use", async () => {
    expect(await run(["evaluate", "/nope/products.json", "--dry"], log)).toBe(1);
    expect(output()).toContain("Could not read");
  });

  it("reports every question, the products behind each answer, and what the run cost", async () => {
    const model = scriptedModel({ answer: "The Atlas suits beginners.", productRefs: ["PAD-1"] });
    const file = await catalogueFile();

    expect(await run(["evaluate", file, "--questions", await questionsFile(["which paddle for a beginner?", "what's the weather like?"]), "--store", "Selkirk Demo", "--currency", "MYR", "--rates", "0.28,0.42,0.028"], log, { model })).toBe(0);

    expect(output()).toContain("? which paddle for a beginner?");
    expect(output()).toContain("The Atlas suits beginners.");
    expect(output()).toContain("products: PAD-1");
    // The refusal has to say what to do about it, not just that it happened.
    expect(output()).toContain("REFUSED by the off-topic guard");
    expect(output()).toContain("--synonyms");
    expect(output()).toContain("1 of 2 answered, 1 refused, 0 answered without naming a product.");
    expect(output()).toMatch(/1020 tokens \(600 from cache\), median \d+ms per question, 0\.\d+ total\./);
  });

  it("answers a question its catalogue would have refused, once the shop adds the word", async () => {
    const model = scriptedModel({ answer: "Yes — the Court Trainer." });
    const file = await catalogueFile([{ ref: "SHOE-1", name: "Court Trainer", price: 30000, category: { slug: "footwear", name: "Footwear" }, specs: { Upper: "Knit" } }]);
    const questions = await questionsFile(["do you sell shoes?"]);

    await run(["evaluate", file, "--questions", questions], log, { model });
    expect(output()).toContain("REFUSED");

    lines.length = 0;
    await run(["evaluate", file, "--questions", questions, "--synonyms", "shoes, sneakers"], log, { model });
    expect(output()).toContain("Yes — the Court Trainer.");
    expect(output()).not.toContain("REFUSED");
  });

  it("gives the whole evaluation as JSON for a script to read", async () => {
    const model = scriptedModel({ answer: "The Atlas.", productRefs: ["PAD-1"] });

    await run(["evaluate", await catalogueFile(), "--questions", await questionsFile(["which paddle?"]), "--json"], log, { model });

    expect(JSON.parse(output())).toMatchObject({ readiness: { products: 3 }, summary: { asked: 1, answered: 1 }, results: [{ products: ["PAD-1"] }] });
  });

  it("refuses to run without a model, and says how to fix it", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_API_KEY", "");

    expect(await run(["evaluate", await catalogueFile()], log)).toBe(1);
    expect(output()).toContain("No model credentials found");
  });
});
