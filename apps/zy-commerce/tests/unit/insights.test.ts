/**
 * The summary a store owner reads. Counting is the easy half; the half that
 * matters is which question each answer belongs to, and not counting a
 * refusal as an answer.
 */
import { describe, expect, it } from "vitest";
import { summariseConversations } from "@/lib/ai/insights";

const thread = (...turns: Array<Record<string, unknown>>) => ({ messages: turns });

describe("summariseConversations", () => {
  const threads = [
    thread(
      { role: "user", content: "Which paddle for a beginner?" },
      { role: "assistant", content: "The Atlas.", productSkus: ["PAD-1"], rating: "up" },
      { role: "user", content: "do you deliver to Sabah?" },
      { role: "assistant", content: "I don't have that detail.", rating: "down", at: "2026-09-20T02:00:00.000Z" },
    ),
    thread(
      { role: "user", content: "which paddle for a beginner??" },
      { role: "assistant", content: "The Atlas again.", productSkus: ["PAD-1", "PAD-2"] },
      { role: "user", content: "write me a poem" },
      { role: "assistant", content: "It seems like the question is not related…", blocked: "blocked-pattern" },
    ),
  ];

  it("counts the same question however it was written, and keeps the first wording", () => {
    const insights = summariseConversations(threads);

    expect(insights.conversations).toBe(2);
    expect(insights.messages).toBe(8);
    expect(insights.topQuestions[0]).toEqual({ text: "Which paddle for a beginner?", count: 2 });
  });

  it("separates what it refused from what it answered", () => {
    const insights = summariseConversations(threads);

    expect(insights.refused).toBe(1);
    expect(insights.refusedQuestions).toEqual([{ text: "write me a poem", count: 1 }]);
    // A refusal is not an answer, so the question it refused is not "asked and answered".
    expect(insights.topQuestions.map((q) => q.text)).not.toContain("write me a poem");
  });

  it("ranks the products it put in front of people", () => {
    expect(summariseConversations(threads).topProducts).toEqual([
      { sku: "PAD-1", count: 2 },
      { sku: "PAD-2", count: 1 },
    ]);
  });

  it("adds up what the conversations cost in tokens", () => {
    const insights = summariseConversations([
      thread(
        { role: "user", content: "which paddle?" },
        { role: "assistant", content: "The Atlas.", usage: { inputTokens: 1200, outputTokens: 180, cachedInputTokens: 900 } },
        { role: "user", content: "write me a poem" },
        // Refused by the guard: no model call, so nothing to count.
        { role: "assistant", content: "It seems like…", blocked: "blocked-pattern" },
      ),
      thread({ role: "user", content: "and the other?" }, { role: "assistant", content: "The Vanguard.", usage: { inputTokens: 800, outputTokens: 120, cachedInputTokens: 700 } }),
    ]);

    expect(insights.usage).toEqual({ inputTokens: 2000, outputTokens: 300, cachedInputTokens: 1600 });
  });

  it("gathers the ratings, and the exchanges marked unhelpful with their question", () => {
    const insights = summariseConversations(threads);

    expect({ up: insights.ratedUp, down: insights.ratedDown }).toEqual({ up: 1, down: 1 });
    expect(insights.unhelpful).toEqual([
      { question: "do you deliver to Sabah?", answer: "I don't have that detail.", at: "2026-09-20T02:00:00.000Z" },
    ]);
  });

  it("says nothing rather than something wrong when there is nothing to say", () => {
    expect(summariseConversations([])).toMatchObject({ conversations: 0, messages: 0, refused: 0, topQuestions: [], topProducts: [], unhelpful: [] });
    // A schemaless column can hold anything; it must not throw.
    expect(summariseConversations([{ messages: null }, { messages: "nonsense" }, thread({ role: "assistant", content: "orphan answer" })]).messages).toBe(1);
  });
});

describe("summariseConversations — the awkward shapes", () => {
  it("orders equal counts by their wording, so the list is stable between reloads", () => {
    const insights = summariseConversations([
      thread(
        { role: "user", content: "zebra question" },
        { role: "assistant", content: "one", productSkus: ["SKU-Z"] },
        { role: "user", content: "alpha question" },
        { role: "assistant", content: "two", productSkus: ["SKU-A"] },
      ),
    ]);

    expect(insights.topQuestions.map((q) => q.text)).toEqual(["alpha question", "zebra question"]);
    expect(insights.topProducts.map((p) => p.sku)).toEqual(["SKU-A", "SKU-Z"]);
  });

  it("ignores a question that is only punctuation, and an answer with no question before it", () => {
    const insights = summariseConversations([
      thread({ role: "user", content: "???" }, { role: "assistant", content: "I'm not sure." }, { role: "assistant", content: "orphan" }),
    ]);

    expect(insights.topQuestions).toEqual([]);
    expect(insights.messages).toBe(3);
  });

  it("keeps an unhelpful answer that has no timestamp", () => {
    const insights = summariseConversations([thread({ role: "user", content: "is it waterproof?" }, { role: "assistant", content: "I don't know.", rating: "down" })]);

    expect(insights.unhelpful).toEqual([{ question: "is it waterproof?", answer: "I don't know." }]);
  });

  it("shows only the most recent unhelpful answers when there are many", () => {
    const turns = Array.from({ length: 24 }, (_, i) => [
      { role: "user", content: `question ${i}` },
      { role: "assistant", content: `answer ${i}`, rating: "down" },
    ]).flat();

    const insights = summariseConversations([thread(...turns)]);

    expect(insights.ratedDown).toBe(24);
    expect(insights.unhelpful).toHaveLength(10);
    expect(insights.unhelpful[0]!.answer).toBe("answer 23");
  });
});
