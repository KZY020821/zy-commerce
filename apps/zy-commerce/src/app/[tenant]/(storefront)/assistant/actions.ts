"use server";

/**
 * Storefront assistant Server Actions.
 *
 * Everything host-side — which tenant, who is asking, how often they may ask,
 * and keeping a record — lives in `src/lib/ai/turn.ts`, because the streaming
 * route does the same work and the two must never drift apart. What is left
 * here is the transport: one action that answers, and three small ones around
 * the conversation.
 *
 * Conversation history is read from the database, never from the browser —
 * see `src/lib/ai/chat-history.ts` for why. The httpOnly session cookie is the
 * only thing that identifies a thread, and the stored thread is the only
 * history the model ever sees.
 */
import { askConcierge, type ConversationTurn, type ProductCard, type RestoredMessage } from "catalog-concierge";
import { loadConversation, rateAnswer, startNewChat } from "@/lib/ai/conversation";
import { beginTurn, customerFacingError, recordTurn, storeProfile } from "@/lib/ai/turn";

export type AssistantActionResult =
  | { ok: true; answer: string; suggestions: string[]; products: ProductCard[] }
  | { ok: false; error: string };

/**
 * "New chat" in the widget: a fresh thread on the server, not just a cleared
 * screen. The work is in `conversation.ts`, which the embedded widget's route
 * shares.
 */
export async function startNewChatAction(): Promise<void> {
  await startNewChat();
}

/** The conversation this browser already had, for the widget to restore. */
export async function loadChatHistoryAction(): Promise<RestoredMessage[]> {
  return loadConversation();
}

/** What a customer thought of an answer. Quiet on every failure. */
export async function rateAnswerAction(raw: { answer: string; rating: "up" | "down" }): Promise<void> {
  await rateAnswer(raw);
}

/**
 * One question, one answer.
 *
 * The widget prefers the streaming route (`/api/assistant`), which says what
 * the assistant is doing while it does it; this is the same turn without the
 * progress, and what the widget falls back to when the stream cannot be used.
 */
export async function askAssistantAction(raw: { message: string; history?: ConversationTurn[]; path?: string }): Promise<AssistantActionResult> {
  const started = await beginTurn(raw);
  if (!started.ok) return { ok: false, error: started.error };
  const turn = started.turn;

  try {
    const reply = await askConcierge(
      { store: storeProfile(turn.tenant), adapter: turn.adapter },
      { message: turn.message, history: turn.history, viewing: turn.viewing },
    );

    await recordTurn(turn, reply);
    return { ok: true, answer: reply.answer, suggestions: reply.suggestions, products: reply.products };
  } catch (err) {
    // The detail — which provider, which model, whose key — belongs in the
    // store owner's logs, not on a customer's screen.
    console.error("[assistant] failed", err);
    return { ok: false, error: customerFacingError(err) };
  }
}
