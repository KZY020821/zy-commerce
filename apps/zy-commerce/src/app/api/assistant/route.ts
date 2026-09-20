/**
 * The storefront assistant, answering as it works.
 *
 * A turn takes several seconds, nearly all of it inside the model's tool loop,
 * and three silent dots make that feel broken. This route streams one line per
 * tool call — searching, opening a product, comparing — and then the answer.
 *
 * It is a Route Handler rather than a Server Action on purpose (the app's one
 * exception to "Route Handlers are for webhooks and Auth.js"): actions are
 * queued one at a time per client and their result arrives in a single piece,
 * neither of which suits a long reply a customer is watching. Everything a
 * turn needs is shared with the action through `src/lib/ai/turn.ts`, so the
 * two cannot drift apart.
 */
import { headers } from "next/headers";
import { askConciergeStream } from "catalog-concierge";
import { beginTurn, customerFacingError, recordTurn, storeProfile } from "@/lib/ai/turn";
import { requestHost } from "@/lib/tenant/resolve";

/** The tool loop can take a while; the platform's default is not enough. */
export const maxDuration = 60;

/** One JSON object per line, so the browser can act on each as it lands. */
const encoder = new TextEncoder();
const line = (event: unknown) => encoder.encode(`${JSON.stringify(event)}\n`);

const STREAM_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  // Tells proxies that do their own buffering to pass the chunks straight on.
  "x-accel-buffering": "no",
};

/** A refusal, in the same shape the stream ends with. */
function refusal(error: string): Response {
  return new Response(line({ type: "reply", result: { ok: false, error } }), { headers: STREAM_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  // A Server Action checks this for itself; a route handler has to. The chat
  // is anonymous, so without it another site could spend a visitor's quota.
  const origin = request.headers.get("origin");
  if (origin && originHost(origin) !== requestHost(await headers())) return refusal("This request did not come from the store.");

  const body: unknown = await request.json().catch(() => null);
  const started = await beginTurn(body);
  if (!started.ok) return refusal(started.error);
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

  return new Response(stream, { headers: STREAM_HEADERS });
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
