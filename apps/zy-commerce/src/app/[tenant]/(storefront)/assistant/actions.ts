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
import { askConcierge, isAssistantConfigured, type ConversationTurn, type ProductCard } from "catalog-concierge";
import type { ChatConversation, Prisma } from "@/generated/prisma/client";
import { appendTurns, historyForModel, storedTurns, type StoredTurn } from "@/lib/ai/chat-history";
import { createPrismaCatalogAdapter } from "@/lib/ai/prisma-adapter";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

const SESSION_COOKIE = "zy_chat_session";
const MAX_MESSAGE_CHARS = 1000;
const RATE_PER_IP = { limit: 60, windowMs: 15 * 60_000 };
const RATE_PER_SESSION = { limit: 30, windowMs: 15 * 60_000 };

/**
 * `history` is accepted so the widget's transport contract is unchanged, but it
 * is deliberately never read. Keeping it in the schema means an oversized
 * payload is rejected here rather than carried any further in.
 */
const inputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(24).optional(),
});

export type AssistantActionResult =
  | { ok: true; answer: string; suggestions: string[]; products: ProductCard[] }
  | { ok: false; error: string };

async function getOrCreateSessionToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const token = randomBytes(16).toString("hex");
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return token;
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

export async function askAssistantAction(raw: { message: string; history?: ConversationTurn[] }): Promise<AssistantActionResult> {
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

  try {
    const reply = await askConcierge(
      {
        store: { storeName: tenant.name, assistantName: tenant.assistantName, currency: tenant.currency, locale: tenant.locale, country: tenant.country },
        adapter,
      },
      { message: parsed.data.message, history: historyForModel(previous) },
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
    console.error("[assistant] failed", err);
    if (err instanceof OpenAI.AuthenticationError) return { ok: false, error: "The assistant's DeepSeek API key is invalid. The store owner needs to check the configuration." };
    if (err instanceof OpenAI.PermissionDeniedError) return { ok: false, error: "The assistant's DeepSeek account doesn't have access to this model. The store owner needs to check their DeepSeek account." };
    if (err instanceof OpenAI.RateLimitError) return { ok: false, error: "The assistant is busy right now — please try again in a moment." };
    if (err instanceof OpenAI.APIError) return { ok: false, error: "The assistant couldn't reach its model. Please try again shortly." };
    return { ok: false, error: "Something went wrong while answering. Please try again." };
  }
}
