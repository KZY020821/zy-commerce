/**
 * The wire between a host's endpoint and the widget. Everything here is about
 * partial data: a line split across chunks, a line nobody understands, a
 * server that hangs up. None of it may cost the customer their answer.
 */
import { describe, expect, it, vi } from "vitest";
import { askEndpoint, askEndpointStream, loadEndpointHistory, parseStreamLine, readAssistantStream, sendEndpointFeedback, startEndpointChat } from "../src/transport";
import type { AssistantStreamEvent } from "../src/types";

const reply = { ok: true as const, answer: "The Atlas.", suggestions: ["Compare them"], products: [] };

/** A response that hands its body over in exactly these pieces. */
function streamed(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

const collect = async (events: AsyncGenerator<AssistantStreamEvent>) => {
  const seen: AssistantStreamEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
};

describe("parseStreamLine", () => {
  it("reads the two shapes it knows", () => {
    expect(parseStreamLine('{"type":"status","tool":"search_products"}')).toEqual({ kind: "tool", name: "search_products" });
    expect(parseStreamLine(`{"type":"reply","result":${JSON.stringify(reply)}}`)).toEqual({ kind: "reply", result: reply });
  });

  it("ignores everything else instead of throwing", () => {
    for (const line of ["", "   ", "not json", "123", "null", '"a string"', "[1,2]", '{"type":"status"}', '{"type":"status","tool":7}', '{"type":"reply"}', '{"type":"from the future"}']) {
      expect(parseStreamLine(line), line).toBeNull();
    }
  });
});

describe("readAssistantStream", () => {
  it("yields events as the lines arrive, including one split across chunks", async () => {
    const events = await collect(
      readAssistantStream(
        streamed(['{"type":"status","tool":"search_products"}\n', '{"type":"reply","result":{"ok":true,"answer":"The At', 'las.","suggestions":["Compare them"],"products":[]}}\n']),
      ),
    );

    expect(events).toEqual([{ kind: "tool", name: "search_products" }, { kind: "reply", result: reply }]);
  });

  it("still reads a last line that arrived without its newline", async () => {
    expect(await collect(readAssistantStream(streamed([`{"type":"reply","result":${JSON.stringify(reply)}}`])))).toEqual([{ kind: "reply", result: reply }]);
  });

  it("skips the lines it cannot use and keeps the ones it can", async () => {
    const events = await collect(readAssistantStream(streamed(["\n", "not json\n", '{"type":"who knows"}\n', `{"type":"reply","result":${JSON.stringify(reply)}}\n`])));

    expect(events).toEqual([{ kind: "reply", result: reply }]);
  });

  it("refuses a response that is not one", async () => {
    await expect(collect(readAssistantStream(new Response("", { status: 500 })))).rejects.toThrow("answered 500");
    await expect(collect(readAssistantStream(new Response(null, { status: 204 })))).rejects.toThrow();
  });
});

describe("askEndpointStream", () => {
  it("posts the question as JSON and streams the answer back", async () => {
    const fetchMock = vi.fn(async () => streamed([`{"type":"status","tool":"get_product"}\n{"type":"reply","result":${JSON.stringify(reply)}}\n`]));
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect(askEndpointStream("/api/assistant", { message: "which paddle?", path: "/products/atlas" }));

    expect(events.map((e) => e.kind)).toEqual(["tool", "reply"]);
    const [url, request] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/assistant");
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toEqual({ message: "which paddle?", path: "/products/atlas" });
    vi.unstubAllGlobals();
  });
});

describe("askEndpoint", () => {
  it("returns the reply the stream ended with", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamed([`{"type":"status","tool":"search_products"}\n{"type":"reply","result":${JSON.stringify(reply)}}\n`])));

    expect(await askEndpoint("/api/assistant", { message: "which paddle?" })).toEqual(reply);
    vi.unstubAllGlobals();
  });

  it("says so, in words a customer can read, when the stream ended without one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamed(['{"type":"status","tool":"search_products"}\n'])));

    expect(await askEndpoint("/api/assistant", { message: "which paddle?" })).toEqual({ ok: false, error: "The assistant did not answer. Please try again." });
    vi.unstubAllGlobals();
  });
});

describe("the rest of a conversation over one endpoint", () => {
  const post = (answer: unknown) => vi.fn(async (_url: string, _init: RequestInit) => (answer instanceof Response ? answer : Response.json(answer)));

  it("loads the earlier messages, keeping only what it can render", async () => {
    const fetchMock = post({
      messages: [
        { role: "user", content: "which paddle?" },
        {
          role: "assistant",
          content: "The Atlas.",
          suggestions: ["Compare them", 7],
          products: [{ ref: "PAD-1", name: "Atlas", priceLabel: "RM 220.90", stockLabel: "In stock" }, { ref: 5 }],
          rating: "up",
        },
        { role: "narrator", content: "dropped" },
        { role: "assistant" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadEndpointHistory("/api/assistant")).toEqual([
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "The Atlas.", suggestions: ["Compare them"], products: [{ ref: "PAD-1", name: "Atlas", priceLabel: "RM 220.90", stockLabel: "In stock" }], rating: "up" },
    ]);
    const [, historyRequest] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(historyRequest.body))).toEqual({ action: "history" });
    vi.unstubAllGlobals();
  });

  it("restores nothing rather than guessing, when the endpoint says something else", async () => {
    for (const answer of [{ messages: "later" }, {}, new Response("", { status: 500 }), new Response("not json", { status: 200 })]) {
      vi.stubGlobal("fetch", post(answer));
      expect(await loadEndpointHistory("/api/assistant")).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it("sends a rating and does not care what comes back", async () => {
    const fetchMock = post({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEndpointFeedback("/api/assistant", { answer: "The Atlas.", rating: "down" })).resolves.toBeUndefined();
    const [, feedbackRequest] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(feedbackRequest.body))).toEqual({ action: "feedback", answer: "The Atlas.", rating: "down" });

    vi.stubGlobal("fetch", post(new Response("", { status: 500 })));
    await expect(sendEndpointFeedback("/api/assistant", { answer: "The Atlas.", rating: "up" })).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  // The widget clears the screen on this promise, so a refusal has to be loud.
  it("throws when the endpoint cannot start a new chat", async () => {
    vi.stubGlobal("fetch", post({ ok: true }));
    await expect(startEndpointChat("/api/assistant")).resolves.toBeUndefined();

    for (const answer of [{ ok: false }, {}, new Response("", { status: 500 })]) {
      vi.stubGlobal("fetch", post(answer));
      await expect(startEndpointChat("/api/assistant")).rejects.toThrow("could not start a new chat");
    }
    vi.unstubAllGlobals();
  });
});
