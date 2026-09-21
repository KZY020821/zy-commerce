import "server-only";

/**
 * One turn of a storefront conversation, minus the transport.
 *
 * The Server Action and the streaming route both have to do the same things
 * before and after the assistant runs — decide which store, who is asking,
 * whether they may ask again, what was said before, and what to record — and
 * the one thing worse than duplicating that is letting the two drift apart.
 * So it lives here and each transport only decides how the answer is carried.
 */
import { randomBytes } from "node:crypto";
import OpenAI from "openai";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { isAssistantConfigured, type ConciergeReply } from "catalog-concierge";
import type { ChatConversation, Prisma, Tenant } from "@/generated/prisma/client";
import { appendTurns, historyForModel, storedTurns, type StoredTurn } from "@/lib/ai/chat-history";
import { createPrismaCatalogAdapter } from "@/lib/ai/prisma-adapter";
import { productSlugFromPath } from "@/lib/ai/transcript";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

export const SESSION_COOKIE = "zy_chat_session";
export const MAX_MESSAGE_CHARS = 1000;

const RATE_PER_IP = { limit: 60, windowMs: 15 * 60_000 };
const RATE_PER_SESSION = { limit: 30, windowMs: 15 * 60_000 };

/**
 * `history` is accepted so the widget's transport contract is unchanged, but
 * it is deliberately never read. Keeping it in the schema means an oversized
 * payload is rejected here rather than carried any further in.
 */
export const askInputSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(24).optional(),
  /**
   * The storefront page the customer is on. The browser is the only thing that
   * knows it, so it is never used as content: a product path is resolved
   * against this tenant's own catalogue, and anything else is ignored.
   */
  path: z.string().max(512).optional(),
});

export type AskInputShape = z.input<typeof askInputSchema>;

/**
 * The anonymous thread's cookie: 30 days, never readable by page scripts.
 *
 * `lax` on our own storefront. For the widget embedded on someone else's site
 * the browser would drop a `lax` cookie altogether, and the assistant would
 * forget the conversation between every message — so an allowed embed gets
 * `None; Secure` instead, and the route only ever allows an origin the store
 * listed itself.
 */
export function sessionCookieOptions(crossSite = false) {
  return {
    httpOnly: true,
    sameSite: crossSite ? ("none" as const) : ("lax" as const),
    secure: crossSite || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function getOrCreateSessionToken(crossSite = false): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const token = randomBytes(16).toString("hex");
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(crossSite));
  return token;
}

/** Everything the assistant needs, once the request has earned the right to it. */
export interface PreparedTurn {
  tenant: Tenant;
  db: Awaited<ReturnType<typeof getTenantDb>>;
  adapter: ReturnType<typeof createPrismaCatalogAdapter>;
  sessionToken: string;
  message: string;
  /** The stored thread, reused for logging so a turn costs one SELECT. */
  existing: ChatConversation | null;
  previous: StoredTurn[];
  history: ReturnType<typeof historyForModel>;
  /** SKU of the product page the question was asked from, if it was. */
  viewing?: string;
}

export type TurnStart = { ok: true; turn: PreparedTurn } | { ok: false; error: string };

/**
 * Everything that happens before the model: validate, resolve the store, rate
 * limit, read the thread, and work out what the customer is looking at.
 */
export async function beginTurn(raw: unknown, options: { crossSite?: boolean } = {}): Promise<TurnStart> {
  const parsed = askInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `Please enter a message (up to ${MAX_MESSAGE_CHARS} characters).` };

  const tenant = await requireCurrentTenant();
  if (!tenant.assistantEnabled) return { ok: false, error: "The assistant is turned off for this store." };
  if (!isAssistantConfigured()) return { ok: false, error: "The assistant is not configured yet." };

  const h = await headers();
  const ip = clientIpFromHeaders(h);
  const sessionToken = await getOrCreateSessionToken(options.crossSite);
  if (!checkRateLimit(`chat:ip:${ip}`, RATE_PER_IP).ok || !checkRateLimit(`chat:session:${sessionToken}`, RATE_PER_SESSION).ok) {
    return { ok: false, error: "You're sending messages quickly — please wait a few minutes and try again." };
  }

  const db = await getTenantDb();
  const existing = await db.chatConversation.findUnique({ where: { tenantId_sessionToken: { tenantId: tenant.id, sessionToken } } });
  const previous = storedTurns(existing?.messages);

  // "Is this one good for a beginner?" asked on a product page names nothing
  // the assistant can look up. The page does.
  const slug = productSlugFromPath(parsed.data.path);
  const viewing = slug ? (await db.product.findFirst({ where: { slug, active: true }, select: { sku: true } }))?.sku : undefined;

  return {
    ok: true,
    turn: {
      tenant,
      db,
      adapter: createPrismaCatalogAdapter(db),
      sessionToken,
      message: parsed.data.message,
      existing,
      previous,
      history: historyForModel(previous),
      viewing,
    },
  };
}

/** The store profile the package is handed, including the shop's own words. */
export function storeProfile(tenant: Tenant) {
  const synonyms = (tenant.assistantSynonyms ?? "").split(",").map((word) => word.trim()).filter(Boolean);
  return {
    storeName: tenant.name,
    assistantName: tenant.assistantName,
    currency: tenant.currency,
    locale: tenant.locale,
    country: tenant.country,
    // Delivery, returns, opening hours: the questions a catalogue cannot
    // answer, in the shop's own words.
    ...(tenant.assistantPolicies ? { policies: tenant.assistantPolicies } : {}),
    // What customers call things this catalogue calls something else.
    ...(synonyms.length ? { synonyms } : {}),
  };
}

/**
 * Appends the exchange to the tenant's conversation log. Best effort: a
 * logging failure must never cost the customer their answer. Off-topic
 * messages are logged too, so the store owner can see what people asked.
 */
export async function recordTurn(turn: PreparedTurn, reply: ConciergeReply): Promise<void> {
  try {
    const now = new Date().toISOString();
    const added: StoredTurn[] = [
      { role: "user", content: turn.message, at: now },
      {
        role: "assistant",
        content: reply.answer,
        at: now,
        suggestions: reply.suggestions,
        productSkus: reply.products.map((p) => p.ref),
        // Kept so a restored conversation still says why each card is there.
        ...(reply.products.some((p) => p.note) ? { productNotes: reply.products.map((p) => p.note ?? "") } : {}),
        toolCalls: reply.origin.kind === "model" ? reply.origin.toolCalls : [],
        ...(reply.origin.kind === "blocked" ? { blocked: reply.origin.reason } : {}),
        // What this turn cost. Without it nobody can answer what a
        // conversation costs — the store owner or whoever is pricing this.
        ...(reply.usage ? { usage: reply.usage } : {}),
      },
    ];
    const messages = appendTurns(turn.previous, added) as unknown as Prisma.InputJsonValue;
    if (turn.existing) {
      await turn.db.chatConversation.update({ where: { id: turn.existing.id }, data: { messages, messageCount: turn.existing.messageCount + 2, lastMessageAt: new Date() } });
    } else {
      await turn.db.chatConversation.create({ data: { tenantId: turn.tenant.id, sessionToken: turn.sessionToken, messages, messageCount: 2 } });
    }
  } catch (err) {
    console.error("[assistant] failed to log conversation", err);
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
export function customerFacingError(err: unknown): string {
  if (err instanceof OpenAI.RateLimitError) return "The assistant is busy right now — please try again in a moment.";
  if (err instanceof OpenAI.APIError) return "The assistant is unavailable right now. Please try again shortly, or browse the store as usual.";
  return "Something went wrong while answering. Please try again.";
}
