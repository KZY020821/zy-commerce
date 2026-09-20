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
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { askConcierge, type ConversationTurn, type ProductCard, type RestoredMessage } from "catalog-concierge";
import type { Prisma } from "@/generated/prisma/client";
import { lastRatableTurn, storedTurns } from "@/lib/ai/chat-history";
import { productCardsBySku, referencedSkus, toRestoredMessages, RESTORED_TURNS } from "@/lib/ai/transcript";
import { beginTurn, customerFacingError, recordTurn, sessionCookieOptions, storeProfile, SESSION_COOKIE } from "@/lib/ai/turn";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

/** Restoring a conversation is two indexed reads; a page reload may do it. */
const RATE_HISTORY_PER_IP = { limit: 120, windowMs: 15 * 60_000 };
/** One rating per answer is the honest use; the rest is someone playing. */
const RATE_FEEDBACK_PER_SESSION = { limit: 60, windowMs: 15 * 60_000 };

export type AssistantActionResult =
  | { ok: true; answer: string; suggestions: string[]; products: ProductCard[] }
  | { ok: false; error: string };

/**
 * "New chat" in the widget. The thread lives on the server, keyed by the
 * session cookie, so clearing the screen alone would leave the assistant
 * remembering the old conversation. A fresh token starts a new thread; the
 * old one stays in the store's conversation log.
 */
export async function startNewChatAction(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, randomBytes(16).toString("hex"), sessionCookieOptions());
}

/**
 * The conversation this browser already had, for the widget to put back on
 * screen when the chat is opened.
 *
 * Read-only on purpose: it never issues a session cookie, so a first-time
 * visitor who opens the chat is not given an identity just for looking, and a
 * reload costs two indexed reads rather than a model call.
 */
export async function loadChatHistoryAction(): Promise<RestoredMessage[]> {
  const jar = await cookies();
  const sessionToken = jar.get(SESSION_COOKIE)?.value;
  if (!sessionToken || !/^[a-f0-9]{32}$/.test(sessionToken)) return [];

  const tenant = await requireCurrentTenant();
  if (!tenant.assistantEnabled) return [];

  const ip = clientIpFromHeaders(await headers());
  if (!checkRateLimit(`chat:history:${ip}`, RATE_HISTORY_PER_IP).ok) return [];

  const db = await getTenantDb();
  const existing = await db.chatConversation.findUnique({ where: { tenantId_sessionToken: { tenantId: tenant.id, sessionToken } } });
  const turns = storedTurns(existing?.messages).slice(-RESTORED_TURNS);
  if (turns.length === 0) return [];

  const cards = await productCardsBySku(db, { currency: tenant.currency, locale: tenant.locale }, referencedSkus(turns));
  return toRestoredMessages(turns, cards);
}

/**
 * What a customer thought of an answer.
 *
 * Stored beside the answer it belongs to, so the store owner can see which
 * replies are letting people down rather than guessing from a transcript.
 * Everything here fails quietly: a rating is a courtesy, and nothing a
 * customer sees should depend on it.
 */
export async function rateAnswerAction(raw: { answer: string; rating: "up" | "down" }): Promise<void> {
  const parsed = z.object({ answer: z.string().trim().min(1).max(4000), rating: z.enum(["up", "down"]) }).safeParse(raw);
  if (!parsed.success) return;

  const jar = await cookies();
  const sessionToken = jar.get(SESSION_COOKIE)?.value;
  if (!sessionToken || !/^[a-f0-9]{32}$/.test(sessionToken)) return;
  if (!checkRateLimit(`chat:rating:${sessionToken}`, RATE_FEEDBACK_PER_SESSION).ok) return;

  const tenant = await requireCurrentTenant();
  if (!tenant.assistantEnabled) return;

  try {
    const db = await getTenantDb();
    const existing = await db.chatConversation.findUnique({ where: { tenantId_sessionToken: { tenantId: tenant.id, sessionToken } } });
    if (!existing) return;

    const turns = storedTurns(existing.messages);
    const index = lastRatableTurn(turns, parsed.data.answer);
    if (index < 0) return;

    const updated = turns.map((turn, i) => (i === index ? { ...turn, rating: parsed.data.rating } : turn));
    await db.chatConversation.update({ where: { id: existing.id }, data: { messages: updated as unknown as Prisma.InputJsonValue } });
  } catch (err) {
    console.error("[assistant] failed to record feedback", err);
  }
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
