"use server";

/**
 * Storefront assistant Server Action. Public (no login), tenant-scoped,
 * rate-limited per IP and per session, and every turn is appended to the
 * tenant's ChatConversation log for the admin to review.
 */
import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@/generated/prisma/client";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getAiClient, isAssistantConfigured } from "@/lib/ai/client";
import { buildCatalogProfile } from "@/lib/ai/catalog-profile";
import { runAssistant, type AssistantTurn } from "@/lib/ai/assistant";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

const SESSION_COOKIE = "zy_chat_session";
const MAX_MESSAGE_CHARS = 1000;
const RATE_PER_IP = { limit: 60, windowMs: 15 * 60_000 };
const RATE_PER_SESSION = { limit: 30, windowMs: 15 * 60_000 };

const inputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(24),
});

export interface AssistantProductCard {
  sku: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  hasVariants: boolean;
  imageUrl: string | null;
  stockQuantity: number;
  lowStockThreshold: number;
}

export type AssistantActionResult =
  | { ok: true; answer: string; suggestions: string[]; products: AssistantProductCard[] }
  | { ok: false; error: string };

async function getOrCreateSessionToken(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const token = randomBytes(16).toString("hex");
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return token;
}

export async function askAssistantAction(raw: { message: string; history: AssistantTurn[] }): Promise<AssistantActionResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please enter a message (up to 1000 characters)." };

  const tenant = await requireCurrentTenant();
  if (!tenant.assistantEnabled) return { ok: false, error: "The assistant is turned off for this store." };
  const ai = getAiClient();
  if (!ai) return { ok: false, error: "The assistant is not configured yet." };

  const h = await headers();
  const ip = clientIpFromHeaders(h);
  const sessionToken = await getOrCreateSessionToken();
  if (!checkRateLimit(`chat:ip:${ip}`, RATE_PER_IP).ok || !checkRateLimit(`chat:session:${sessionToken}`, RATE_PER_SESSION).ok) {
    return { ok: false, error: "You're sending messages quickly — please wait a few minutes and try again." };
  }

  const db = await getTenantDb();
  const rows = await db.product.findMany({
    where: { active: true },
    select: { price: true, brand: true, specs: true, active: true, category: { select: { slug: true, name: true } } },
  });
  const profile = buildCatalogProfile(
    rows.map((r) => ({ categorySlug: r.category?.slug ?? null, categoryName: r.category?.name ?? null, price: r.price, brand: r.brand, specs: (r.specs as Record<string, unknown> | null) ?? null, active: r.active })),
  );

  let reply;
  try {
    reply = await runAssistant({
      client: ai.client,
      model: ai.model,
      store: { storeName: tenant.name, assistantName: tenant.assistantName, currency: tenant.currency, locale: tenant.locale, country: tenant.country, profile },
      tools: { db, currency: tenant.currency, locale: tenant.locale },
      history: parsed.data.history,
      userMessage: parsed.data.message,
    });
  } catch (err) {
    console.error("[assistant] model call failed", err);
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "The assistant's model credentials are invalid. The store owner needs to check the configuration." };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "The assistant's model account isn't activated yet. The store owner needs to enable it." };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "The assistant is busy right now — please try again in a moment." };
    if (err instanceof Anthropic.APIError) return { ok: false, error: "The assistant couldn't reach its model. Please try again shortly." };
    return { ok: false, error: "Something went wrong while answering. Please try again." };
  }

  const products: AssistantProductCard[] = reply.productSkus.length
    ? (await db.product.findMany({
        where: { active: true, sku: { in: reply.productSkus } },
        include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } },
      }))
        .sort((a, b) => reply.productSkus.indexOf(a.sku) - reply.productSkus.indexOf(b.sku))
        .map((p) => ({ sku: p.sku, slug: p.slug, name: p.name, price: p.price, currency: p.currency, hasVariants: p.hasVariants, imageUrl: p.images[0]?.url ?? null, stockQuantity: p.stockQuantity, lowStockThreshold: p.lowStockThreshold }))
    : [];

  // Append-only conversation log (best effort — never fail the reply over logging).
  try {
    const now = new Date().toISOString();
    const newTurns = [
      { role: "user", content: parsed.data.message, at: now },
      { role: "assistant", content: reply.answer, at: now, suggestions: reply.suggestions, productSkus: reply.productSkus, toolCalls: reply.toolCalls.map((t) => t.name) },
    ];
    const existing = await db.chatConversation.findUnique({ where: { tenantId_sessionToken: { tenantId: tenant.id, sessionToken } } });
    if (existing) {
      const prev = Array.isArray(existing.messages) ? (existing.messages as unknown[]) : [];
      await db.chatConversation.update({ where: { id: existing.id }, data: { messages: [...prev, ...newTurns] as Prisma.InputJsonValue, messageCount: existing.messageCount + 2, lastMessageAt: new Date() } });
    } else {
      await db.chatConversation.create({ data: { tenantId: tenant.id, sessionToken, messages: newTurns as Prisma.InputJsonValue, messageCount: 2 } });
    }
  } catch (err) {
    console.error("[assistant] failed to log conversation", err);
  }

  return { ok: true, answer: reply.answer, suggestions: reply.suggestions, products };
}

export async function assistantStatusAction(): Promise<{ configured: boolean }> {
  return { configured: isAssistantConfigured() };
}
