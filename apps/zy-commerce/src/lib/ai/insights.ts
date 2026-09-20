/**
 * What a store owner can learn from the assistant's conversations.
 *
 * A transcript answers "what did this person ask?". A shop owner needs the
 * other question — "what are people asking, and where is it letting them
 * down?" — which is what decides whether they keep paying for this. Pure
 * functions over the stored turns, so they are tested without a database.
 */
import { storedTurns } from "./chat-history";

export interface Counted {
  /** The question as the first customer who asked it wrote it. */
  text: string;
  count: number;
}

export interface UnhelpfulExchange {
  question: string;
  answer: string;
  at?: string;
}

export interface ConversationInsights {
  conversations: number;
  messages: number;
  /** Messages the guard turned away before any model call. */
  refused: number;
  ratedUp: number;
  ratedDown: number;
  topQuestions: Counted[];
  /** What customers asked that the assistant would not answer at all. */
  refusedQuestions: Counted[];
  /** Product references the assistant put on screen, most often first. */
  topProducts: { sku: string; count: number }[];
  /** The exchanges customers marked as unhelpful, most recent first. */
  unhelpful: UnhelpfulExchange[];
}

/** How many of each list is worth reading at a glance. */
const TOP = 8;
const UNHELPFUL = 10;

/** Same question, written differently: case, spacing and a trailing "?". */
function key(question: string): string {
  return question.toLowerCase().replace(/\s+/g, " ").replace(/[?!.\s]+$/, "").trim();
}

function rank(counts: Map<string, Counted>, limit = TOP): Counted[] {
  return [...counts.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, limit);
}

function tally(counts: Map<string, Counted>, text: string): void {
  const id = key(text);
  if (!id) return;
  const seen = counts.get(id);
  if (seen) seen.count += 1;
  else counts.set(id, { text: text.trim(), count: 1 });
}

export function summariseConversations(threads: { messages: unknown }[]): ConversationInsights {
  const questions = new Map<string, Counted>();
  const refusedQuestions = new Map<string, Counted>();
  const products = new Map<string, number>();
  const unhelpful: UnhelpfulExchange[] = [];
  let messages = 0;
  let refused = 0;
  let ratedUp = 0;
  let ratedDown = 0;

  for (const thread of threads) {
    const turns = storedTurns(thread.messages);
    messages += turns.length;

    turns.forEach((turn, i) => {
      if (turn.role !== "assistant") return;
      // The message this answered: the question a shop owner wants to read.
      const asked = i > 0 && turns[i - 1]!.role === "user" ? turns[i - 1]!.content : "";

      if (turn.blocked) {
        refused += 1;
        if (asked) tally(refusedQuestions, asked);
        return;
      }
      if (asked) tally(questions, asked);
      for (const sku of turn.productSkus ?? []) products.set(sku, (products.get(sku) ?? 0) + 1);
      if (turn.rating === "up") ratedUp += 1;
      if (turn.rating === "down") {
        ratedDown += 1;
        unhelpful.push({ question: asked, answer: turn.content, ...(turn.at ? { at: turn.at } : {}) });
      }
    });
  }

  return {
    conversations: threads.length,
    messages,
    refused,
    ratedUp,
    ratedDown,
    topQuestions: rank(questions),
    refusedQuestions: rank(refusedQuestions),
    topProducts: [...products.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP).map(([sku, count]) => ({ sku, count })),
    unhelpful: unhelpful.slice(-UNHELPFUL).reverse(),
  };
}
