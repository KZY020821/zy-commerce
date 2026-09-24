/**
 * Talking to a host's assistant endpoint.
 *
 * The widget does not care how a reply reaches it, but every host that streams
 * one ends up writing the same loop: POST the question, read one JSON object
 * per line, turn each into an event. It is written once here so the React
 * integration and the `<script>` embed cannot drift, and so a host in another
 * framework has it too.
 *
 * A message streams back as newline-delimited JSON. Everything else about a
 * conversation — putting it back on screen, rating an answer, starting a new
 * one — is a plain JSON POST to the same endpoint with an `action`, so a shop
 * builds one route rather than four.
 *
 * The wire format is newline-delimited JSON, one object per line:
 *
 *   {"type":"status","tool":"search_products"}
 *   {"type":"answer","delta":"The Atlas ","restart":true}
 *   {"type":"reply","result":{"ok":true,"answer":"…","suggestions":[],"products":[]}}
 *
 * Anything else on a line is ignored rather than fatal: a proxy that injects a
 * blank line, or a newer server sending an event this version has never heard
 * of, must not cost the customer their answer.
 */
import type { AssistantAnswer, AssistantStreamEvent, ProductCard, RestoredMessage } from "./types";

/** One line of the stream, or null when it says nothing this version knows. */
export function parseStreamLine(line: string): AssistantStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const event = parsed as { type?: unknown; tool?: unknown; delta?: unknown; restart?: unknown; result?: unknown };
    if (event.type === "status" && typeof event.tool === "string") return { kind: "tool", name: event.tool };
    if (event.type === "answer" && typeof event.delta === "string") return { kind: "answer", delta: event.delta, ...(event.restart === true ? { restart: true } : {}) };
    if (event.type === "reply" && event.result && typeof event.result === "object") return { kind: "reply", result: event.result as AssistantAnswer };
    return null;
  } catch {
    return null;
  }
}

/** The events of a streamed response, as they arrive. */
export async function* readAssistantStream(response: Response): AsyncGenerator<AssistantStreamEvent> {
  if (!response.ok || !response.body) throw new Error(`The assistant endpoint answered ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // A line can arrive in pieces; only a completed one is parsed.
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const event = parseStreamLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event) yield event;
      newline = buffer.indexOf("\n");
    }
  }

  // A server that closed without a final newline still said something.
  const last = parseStreamLine(buffer);
  if (last) yield last;
}

/** POSTs a question to an endpoint and streams what comes back. */
export function askEndpointStream(endpoint: string, body: Record<string, unknown>, init: RequestInit = {}): AsyncGenerator<AssistantStreamEvent> {
  async function* run() {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: JSON.stringify(body),
      ...init,
    });
    yield* readAssistantStream(response);
  }
  return run();
}

/** The same call for a host that only wants the answer, streaming or not. */
export async function askEndpoint(endpoint: string, body: Record<string, unknown>, init?: RequestInit): Promise<AssistantAnswer> {
  let answer: AssistantAnswer = { ok: false, error: "The assistant did not answer. Please try again." };
  for await (const event of askEndpointStream(endpoint, body, init)) {
    if (event.kind === "reply") answer = event.result;
  }
  return answer;
}

/** POSTs an action to the endpoint and returns its JSON, or null if it refused. */
async function postAction(endpoint: string, body: Record<string, unknown>, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

/**
 * The conversation this browser already had.
 *
 * Every message is checked before it is handed to the widget: this arrives
 * over the network and goes straight onto a customer's screen, so a field of
 * the wrong shape is dropped rather than rendered.
 */
export async function loadEndpointHistory(endpoint: string, init?: RequestInit): Promise<RestoredMessage[]> {
  const payload = await postAction(endpoint, { action: "history" }, init);
  const messages = (payload as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((entry) => {
    const message = entry as Partial<RestoredMessage>;
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return [];
    return [
      {
        role: message.role,
        content: message.content,
        ...(Array.isArray(message.suggestions) ? { suggestions: message.suggestions.filter((s): s is string => typeof s === "string") } : {}),
        ...(Array.isArray(message.products) ? { products: message.products.filter(isProductCard) } : {}),
        ...(message.rating === "up" || message.rating === "down" ? { rating: message.rating } : {}),
      },
    ];
  });
}

/** Enough of a card to render one; anything else is left out. */
function isProductCard(value: unknown): value is ProductCard {
  const card = value as Partial<ProductCard> | null;
  return Boolean(card && typeof card.ref === "string" && typeof card.name === "string" && typeof card.priceLabel === "string" && typeof card.stockLabel === "string");
}

/** What the customer thought of an answer. Fire and forget, like the widget's own. */
export async function sendEndpointFeedback(endpoint: string, feedback: { answer: string; rating: "up" | "down" }, init?: RequestInit): Promise<void> {
  await postAction(endpoint, { action: "feedback", ...feedback }, init);
}

/**
 * Starts a new thread on the host's side.
 *
 * Throws when the endpoint refuses, because the widget shows the customer
 * that their old conversation is still there rather than clearing the screen
 * on a promise the server did not keep.
 */
export async function startEndpointChat(endpoint: string, init?: RequestInit): Promise<void> {
  const payload = await postAction(endpoint, { action: "new-chat" }, init);
  if (!payload || (payload as { ok?: unknown }).ok !== true) throw new Error("The assistant endpoint could not start a new chat.");
}
