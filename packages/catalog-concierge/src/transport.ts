/**
 * Talking to a host's assistant endpoint.
 *
 * The widget does not care how a reply reaches it, but every host that streams
 * one ends up writing the same loop: POST the question, read one JSON object
 * per line, turn each into an event. It is written once here so the React
 * integration and the `<script>` embed cannot drift, and so a host in another
 * framework has it too.
 *
 * The wire format is newline-delimited JSON, one object per line:
 *
 *   {"type":"status","tool":"search_products"}
 *   {"type":"reply","result":{"ok":true,"answer":"…","suggestions":[],"products":[]}}
 *
 * Anything else on a line is ignored rather than fatal: a proxy that injects a
 * blank line, or a newer server sending an event this version has never heard
 * of, must not cost the customer their answer.
 */
import type { AssistantAnswer, AssistantStreamEvent } from "./types";

/** One line of the stream, or null when it says nothing this version knows. */
export function parseStreamLine(line: string): AssistantStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const event = parsed as { type?: unknown; tool?: unknown; result?: unknown };
    if (event.type === "status" && typeof event.tool === "string") return { kind: "tool", name: event.tool };
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
