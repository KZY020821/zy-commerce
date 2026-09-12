/**
 * Stored-conversation helpers for the storefront assistant.
 *
 * These are pure so they can be unit tested without a database, and they live
 * outside the Server Action because a `"use server"` module may only export
 * async functions.
 *
 * Why any of this exists: a Server Action is a public HTTP endpoint, so the
 * `history` a browser sends with a message is attacker-controlled. Forged
 * turns would be injected into the model's context as if the assistant had
 * written them, and would defeat the off-topic guard, whose "short follow-up"
 * rule assumes a conversation is genuinely in progress. History is therefore
 * reconstructed here from the row the server itself wrote.
 */
import type { ConversationTurn } from "catalog-concierge";

/** Turns of stored history replayed to the model (12 exchanges). */
export const HISTORY_TURNS = 24;

/**
 * Hard ceiling on the transcript kept per thread. Without it a single session
 * cookie grows its `messages` JSON forever, and every turn re-reads and
 * rewrites the whole blob — quadratic work on a public endpoint.
 */
export const MAX_STORED_TURNS = 200;

export interface StoredTurn {
  role: "user" | "assistant";
  content: string;
  at?: string;
  suggestions?: string[];
  productSkus?: string[];
  toolCalls?: string[];
  /** Set when the guard turned the message away, so no model call was made. */
  blocked?: string;
}

/** Reads the `messages` JSON column defensively — it is schemaless by design. */
export function storedTurns(messages: unknown): StoredTurn[] {
  if (!Array.isArray(messages)) return [];
  return (messages as unknown[]).filter((t): t is StoredTurn => {
    if (!t || typeof t !== "object") return false;
    const turn = t as Partial<StoredTurn>;
    return (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string";
  });
}

/**
 * The visible conversation as the model should see it: the most recent turns,
 * with the guard's own refusals dropped. Replaying a refusal would teach the
 * model to refuse, and it is not something the assistant said about the
 * catalogue.
 */
export function historyForModel(turns: StoredTurn[]): ConversationTurn[] {
  return turns
    .filter((t) => !t.blocked)
    .slice(-HISTORY_TURNS)
    .map((t) => ({
      role: t.role,
      content: t.content,
      // Carried for the guard only — it admits a message matching a chip the
      // assistant offered, so tapping one can never be refused as off-topic.
      // The model loop reads role and content and ignores this.
      ...(t.suggestions?.length ? { suggestions: t.suggestions } : {}),
    }));
}

/** Appends this exchange and trims the thread back to the storage ceiling. */
export function appendTurns(previous: StoredTurn[], added: StoredTurn[]): StoredTurn[] {
  return [...previous, ...added].slice(-MAX_STORED_TURNS);
}
