"use server";

/**
 * Storefront assistant Server Action.
 *
 * Everything here is host responsibility: which tenant, who is asking, how
 * often they may ask, and keeping a record. The assistant itself lives in the
 * `catalog-concierge` package and is reached through one call.
 *
 * Conversation history is read from the database, never from the browser —
 * see `src/lib/ai/chat-history.ts` for why. The httpOnly session cookie is the
 * only thing that identifies a thread, and the stored thread is the only
 * history the model ever sees.
 */
import { randomBytes } from "node:crypto";
import OpenAI from "openai";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { askConcierge, isAssistantConfigured, type ConversationTurn, type ProductCard, type RestoredMessage } from "catalog-concierge";
import type { ChatConversation, Prisma } from "@/generated/prisma/client";
import { appendTurns, historyForModel, lastRatableTurn, storedTurns, type StoredTurn } from "@/lib/ai/chat-history";
import { createPrismaCatalogAdapter } from "@/lib/ai/prisma-adapter";
import { productCardsBySku, productSlugFromPath, referencedSkus, toRestoredMessages, RESTORED_TURNS } from "@/lib/ai/transcript";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

const SESSION_COOKIE = "zy_chat_session";
const MAX_MESSAGE_CHARS = 1000;
const RATE_PER_IP = { limit: 60, windowMs: 15 * 60_000 };
const RATE_PER_SESSION = { limit: 30, windowMs: 15 * 60_000 };
/** Restoring a conversation is two indexed reads; a page reload may do it. */
const RATE_HISTORY_PER_IP = { limit: 120, windowMs: 15 * 60_000 };
/** One rating per answer is the honest use; the rest is someone playing. */
const RATE_FEEDBACK_PER_SESSION = { limit: 60, windowMs: 15 * 60_000 };

/**
 * `history` is accepted so the widget's transport contract is unchanged, but it
 * is deliberately never read. Keeping it in the schema means an oversized
 * payload is rejected here rather than carried any further in.
 */
const inputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(24).optional(),
  /**
   * The storefront page the customer is on. The browser is the only thing that
   * knows it, so it is never used as content: a product path is resolved
   * against this tenant's own catalogue, and anything else is ignored.
   */
  path: z.string().max(512).optional(),
});

export type AssistantActionResult =
  | { ok: true; answer: string; suggestions: string[]; products: ProductCard[] }
  | { ok: false; error: string };

/** The anonymous thread's cookie: 30 days, never readable by page scripts. */
function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 };
}

async function getOrCreateSessionToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const token = randomBytes(16).toString("hex");
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  return token;
}

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

interface LoggedAnswer {
  answer: string;
  suggestions: string[];
  productRefs: string[];
  toolCalls: string[];
  /** Set when the message was turned away by the off-topic guard (no model call). */
  blocked?: string;
}

/**
 * Appends the exchange to the tenant's conversation log. Best effort: a
 * logging failure must never cost the customer their answer. Off-topic
 * messages are logged too, so the store owner can see what people asked.
 */
async function logConversation(
  db: Awaited<ReturnType<typeof getTenantDb>>,
  tenantId: string,
  sessionToken: string,
  existing: ChatConversation | null,
  previous: StoredTurn[],
  userMessage: string,
  answer: LoggedAnswer,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const added: StoredTurn[] = [
      { role: "user", content: userMessage, at: now },
      { role: "assistant", content: answer.answer, at: now, suggestions: answer.suggestions, productSkus: answer.productRefs, toolCalls: answer.toolCalls, ...(answer.blocked ? { blocked: answer.blocked } : {}) },
    ];
    const messages = appendTurns(previous, added) as unknown as Prisma.InputJsonValue;
    if (existing) {
      await db.chatConversation.update({ where: { id: existing.id }, data: { messages, messageCount: existing.messageCount + 2, lastMessageAt: new Date() } });
    } else {
      await db.chatConversation.create({ data: { tenantId, sessionToken, messages, messageCount: 2 } });
    }
  } catch (err) {
    console.error("[assistant] failed to log conversation", err);
  }
}

export async function askAssistantAction(raw: { message: string; history?: ConversationTurn[]; path?: string }): Promise<AssistantActionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please enter a message (up to 1000 characters)." };

  const tenant = await requireCurrentTenant();
  if (!tenant.assistantEnabled) return { ok: false, error: "The assistant is turned off for this store." };
  if (!isAssistantConfigured()) return { ok: false, error: "The assistant is not configured yet." };

  const h = await headers();
  const ip = clientIpFromHeaders(h);
  const sessionToken = await getOrCreateSessionToken();
  if (!checkRateLimit(`chat:ip:${ip}`, RATE_PER_IP).ok || !checkRateLimit(`chat:session:${sessionToken}`, RATE_PER_SESSION).ok) {
    return { ok: false, error: "You're sending messages quickly — please wait a few minutes and try again." };
  }

  const db = await getTenantDb();
  const adapter = createPrismaCatalogAdapter(db);

  // The one read that establishes what this thread has actually said. Reused
  // for logging below, so a turn costs one SELECT rather than two.
  const existing = await db.chatConversation.findUnique({ where: { tenantId_sessionToken: { tenantId: tenant.id, sessionToken } } });
  const previous = storedTurns(existing?.messages);

  // "Is this one good for a beginner?" asked on a product page names nothing
  // the assistant can look up. The page does.
  const slug = productSlugFromPath(parsed.data.path);
  const viewing = slug ? (await db.product.findFirst({ where: { slug, active: true }, select: { sku: true } }))?.sku : undefined;

  try {
    const reply = await askConcierge(
      {
        store: {
          storeName: tenant.name,
          assistantName: tenant.assistantName,
          currency: tenant.currency,
          locale: tenant.locale,
          country: tenant.country,
          // Delivery, returns, opening hours: the questions a catalogue cannot
          // answer, in the shop's own words.
          ...(tenant.assistantPolicies ? { policies: tenant.assistantPolicies } : {}),
        },
        adapter,
      },
      { message: parsed.data.message, history: historyForModel(previous), viewing },
    );

    await logConversation(db, tenant.id, sessionToken, existing, previous, parsed.data.message, {
      answer: reply.answer,
      suggestions: reply.suggestions,
      productRefs: reply.products.map((p) => p.ref),
      toolCalls: reply.origin.kind === "model" ? reply.origin.toolCalls : [],
      ...(reply.origin.kind === "blocked" ? { blocked: reply.origin.reason } : {}),
    });

    return { ok: true, answer: reply.answer, suggestions: reply.suggestions, products: reply.products };
  } catch (err) {
    // The detail — which provider, which model, whose key — belongs in the
    // store owner's logs, not on a customer's screen.
    console.error("[assistant] failed", err);
    return { ok: false, error: customerFacingError(err) };
  }
}

/**
 * What a customer is told when a turn fails.
 *
 * Only two things matter to them: whether waiting will help, and that the shop
 * is otherwise fine. Naming the model vendor, or telling a shopper that the
 * owner has misconfigured something, does neither — it just makes the store
 * look broken by someone who isn't there.
 */
function customerFacingError(err: unknown): string {
  if (err instanceof OpenAI.RateLimitError) return "The assistant is busy right now — please try again in a moment.";
  if (err instanceof OpenAI.APIError) return "The assistant is unavailable right now. Please try again shortly, or browse the store as usual.";
  return "Something went wrong while answering. Please try again.";
}
