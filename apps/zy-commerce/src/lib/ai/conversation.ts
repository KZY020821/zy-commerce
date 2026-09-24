import "server-only";

/**
 * Everything about a conversation that is not a message.
 *
 * Putting it back on screen, rating an answer, starting a new one — each is
 * wanted twice: by the Server Actions the storefront calls, and by the route
 * an embedded widget on someone else's site posts to. Written once here, so
 * the two transports cannot come to mean different things.
 */
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import type { RestoredMessage } from "catalog-concierge";
import type { Prisma } from "@/generated/prisma/client";
import { lastRatableTurn, storedTurns } from "@/lib/ai/chat-history";
import { productCardsBySku, referencedSkus, toRestoredMessages, RESTORED_TURNS } from "@/lib/ai/transcript";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/ai/turn";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

/** Restoring a conversation is two indexed reads; a page reload may do it. */
const RATE_HISTORY_PER_IP = { limit: 120, windowMs: 15 * 60_000 };
/** One rating per answer is the honest use; the rest is someone playing. */
const RATE_FEEDBACK_PER_SESSION = { limit: 60, windowMs: 15 * 60_000 };

export const feedbackSchema = z.object({ answer: z.string().trim().min(1).max(4000), rating: z.enum(["up", "down"]) });

/** The thread this browser owns, or null when it has none yet. */
async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return token && /^[a-f0-9]{32}$/.test(token) ? token : null;
}

/**
 * The conversation this browser already had, for the widget to put back on
 * screen when the chat is opened.
 *
 * Read-only on purpose: it never issues a session cookie, so a first-time
 * visitor who opens the chat is not given an identity just for looking, and a
 * reload costs two indexed reads rather than a model call.
 */
export async function loadConversation(): Promise<RestoredMessage[]> {
  const sessionToken = await currentSessionToken();
  if (!sessionToken) return [];

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
export async function rateAnswer(raw: unknown): Promise<void> {
  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) return;

  const sessionToken = await currentSessionToken();
  if (!sessionToken) return;
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
 * "New chat". The thread lives on the server, keyed by the session cookie, so
 * clearing the screen alone would leave the assistant remembering the old
 * conversation. A fresh token starts a new thread; the old one stays in the
 * store's conversation log.
 */
export async function startNewChat(options: { crossSite?: boolean } = {}): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, randomBytes(16).toString("hex"), sessionCookieOptions(options.crossSite));
}
