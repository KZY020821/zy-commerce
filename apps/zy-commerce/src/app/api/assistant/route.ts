/**
 * The storefront assistant, answering as it works.
 *
 * A turn takes several seconds, nearly all of it inside the model's tool loop,
 * and three silent dots make that feel broken. This route streams one line per
 * tool call — searching, opening a product, comparing — and then the answer.
 *
 * It answers three other things about a conversation too — putting it back on
 * screen, rating an answer, starting a new one — because a widget embedded on
 * someone else's site cannot call a Server Action, and a shop should build one
 * route rather than four. Those share their work with the actions through
 * `src/lib/ai/conversation.ts`.
 *
 * It is a Route Handler rather than a Server Action on purpose (the app's one
 * exception to "Route Handlers are for webhooks and Auth.js"): actions are
 * queued one at a time per client and their result arrives in a single piece,
 * neither of which suits a long reply a customer is watching — and a Server
 * Action cannot be called from another site at all, which the `<script>`
 * embed must do. Everything a turn needs is shared with the action through
 * `src/lib/ai/turn.ts`, so the two cannot drift apart.
 */
import { headers } from "next/headers";
import { askConciergeStream } from "catalog-concierge";
import { loadConversation, rateAnswer, startNewChat } from "@/lib/ai/conversation";
import { beginTurn, customerFacingError, recordTurn, storeProfile } from "@/lib/ai/turn";
import { allowedEmbedOrigin, originVerdict } from "@/lib/ai/embed-origins";
import { requestHost } from "@/lib/tenant/resolve";

/** The tool loop can take a while; the platform's default is not enough. */
export const maxDuration = 60;

/** One JSON object per line, so the browser can act on each as it lands. */
const encoder = new TextEncoder();
const line = (event: unknown) => encoder.encode(`${JSON.stringify(event)}\n`);

const STREAM_HEADERS: Record<string, string> = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  // Tells proxies that do their own buffering to pass the chunks straight on.
  "x-accel-buffering": "no",
};

/** Cross-origin headers for an embed the store has listed, and nothing else. */
function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/** A refusal, in the same shape the stream ends with. */
function refusal(error: string, cors: Record<string, string> = {}): Response {
  return new Response(line({ type: "reply", result: { ok: false, error } }), { headers: { ...STREAM_HEADERS, ...cors } });
}

/** The browser's preflight for an embed on another site. */
export async function OPTIONS(request: Request): Promise<Response> {
  const origin = allowedEmbedOrigin(request.headers.get("origin"));
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
}

export async function POST(request: Request): Promise<Response> {
  // A Server Action checks this for itself; a route handler has to. The chat
  // is anonymous, so without it another site could spend a visitor's quota —
  // and only a site the store listed may embed it at all.
  const verdict = originVerdict(request.headers.get("origin"), requestHost(await headers()));
  if (verdict.kind === "refused") return refusal("This request did not come from the store.");
  const cors = corsHeaders(verdict.kind === "embedded" ? verdict.origin : null);

  const body: unknown = await request.json().catch(() => null);

  // Everything about a conversation that is not a message. Plain JSON, since
  // there is nothing to stream, and the same CORS headers as a message.
  const action = (body as { action?: unknown } | null)?.action;
  if (typeof action === "string") return handleAction(action, body, verdict.kind === "embedded", cors);

  const started = await beginTurn(body, { crossSite: verdict.kind === "embedded" });
  if (!started.ok) return refusal(started.error, cors);
  const turn = started.turn;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const events = askConciergeStream({ store: storeProfile(turn.tenant), adapter: turn.adapter }, { message: turn.message, history: turn.history, viewing: turn.viewing });

        let step = await events.next();
        while (!step.done) {
          controller.enqueue(line({ type: "status", tool: step.value.name }));
          step = await events.next();
        }

        const reply = step.value;
        await recordTurn(turn, reply);
        controller.enqueue(line({ type: "reply", result: { ok: true, answer: reply.answer, suggestions: reply.suggestions, products: reply.products } }));
      } catch (err) {
        // The detail — which provider, which model, whose key — belongs in the
        // store owner's logs, not on a customer's screen.
        console.error("[assistant] failed", err);
        controller.enqueue(line({ type: "reply", result: { ok: false, error: customerFacingError(err) } }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { ...STREAM_HEADERS, ...cors } });
}

/** History, feedback and new chat: one JSON answer each, no stream to make. */
async function handleAction(action: string, body: unknown, crossSite: boolean, cors: Record<string, string>): Promise<Response> {
  const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { "cache-control": "no-store", ...cors } });

  if (action === "history") return json({ messages: await loadConversation() });

  if (action === "feedback") {
    await rateAnswer(body);
    // Always `ok`: a rating is a courtesy, the widget has already thanked the
    // customer, and what went wrong belongs in the store's own logs.
    return json({ ok: true });
  }

  if (action === "new-chat") {
    await startNewChat({ crossSite });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action." }, 400);
}
