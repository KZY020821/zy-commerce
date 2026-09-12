import { describe, expect, it } from "vitest";
import { appendTurns, historyForModel, storedTurns, HISTORY_TURNS, MAX_STORED_TURNS, type StoredTurn } from "@/lib/ai/chat-history";

const turn = (role: "user" | "assistant", content: string, extra: Partial<StoredTurn> = {}): StoredTurn => ({ role, content, ...extra });

describe("storedTurns", () => {
  it("reads a well-formed transcript", () => {
    const rows = [turn("user", "hi"), turn("assistant", "hello")];
    expect(storedTurns(rows)).toHaveLength(2);
  });

  it("tolerates anything else in the JSON column", () => {
    expect(storedTurns(null)).toEqual([]);
    expect(storedTurns(undefined)).toEqual([]);
    expect(storedTurns("not an array")).toEqual([]);
    expect(storedTurns({ role: "user", content: "not an array either" })).toEqual([]);
  });

  it("drops entries that are not usable turns", () => {
    const rows = [turn("user", "keep me"), null, 42, { role: "system", content: "wrong role" }, { role: "user" }, { content: "no role" }];
    expect(storedTurns(rows)).toEqual([turn("user", "keep me")]);
  });
});

describe("historyForModel", () => {
  it("drops the logging metadata the model has no use for", () => {
    const stored = [turn("user", "which paddle?", { at: "2026-01-01", productSkus: ["SKU-1"], toolCalls: ["search_products"] })];
    expect(historyForModel(stored)).toEqual([{ role: "user", content: "which paddle?" }]);
  });

  it("carries the chips an assistant turn offered, so tapping one is never refused", () => {
    const stored = [turn("assistant", "Control or power?", { at: "2026-01-01", suggestions: ["Control and feel"], toolCalls: [] })];
    expect(historyForModel(stored)).toEqual([{ role: "assistant", content: "Control or power?", suggestions: ["Control and feel"] }]);
  });

  it("omits an empty suggestions list rather than sending an empty array", () => {
    const stored = [turn("assistant", "Here are two options.", { suggestions: [] })];
    expect(historyForModel(stored)).toEqual([{ role: "assistant", content: "Here are two options." }]);
  });

  it("omits turns the guard blocked, so a refusal is never replayed to the model", () => {
    const stored = [
      turn("user", "what's the weather?"),
      turn("assistant", "It seems like the question is not related…", { blocked: "blocked-pattern" }),
      turn("user", "show me paddles"),
    ];
    expect(historyForModel(stored)).toEqual([
      { role: "user", content: "what's the weather?" },
      { role: "user", content: "show me paddles" },
    ]);
  });

  it("replays at most HISTORY_TURNS, keeping the most recent", () => {
    const stored = Array.from({ length: HISTORY_TURNS + 10 }, (_, i) => turn("user", `m${i}`));
    const history = historyForModel(stored);
    expect(history).toHaveLength(HISTORY_TURNS);
    expect(history.at(-1)).toEqual({ role: "user", content: `m${HISTORY_TURNS + 9}` });
  });
});

describe("appendTurns", () => {
  it("appends the new exchange in order", () => {
    const previous = [turn("user", "first"), turn("assistant", "reply")];
    const added = [turn("user", "second"), turn("assistant", "reply 2")];
    expect(appendTurns(previous, added).map((t) => t.content)).toEqual(["first", "reply", "second", "reply 2"]);
  });

  it("caps the stored thread so one session cookie cannot grow the row forever", () => {
    const previous = Array.from({ length: MAX_STORED_TURNS }, (_, i) => turn("user", `old-${i}`));
    const result = appendTurns(previous, [turn("user", "newest"), turn("assistant", "newest reply")]);
    expect(result).toHaveLength(MAX_STORED_TURNS);
    expect(result.at(-1)?.content).toBe("newest reply");
    expect(result.some((t) => t.content === "old-0")).toBe(false);
  });
});
