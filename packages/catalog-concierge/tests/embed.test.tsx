/**
 * The `<script>` embed, in jsdom. What matters here is what a shop's developer
 * gets wrong: a missing endpoint, hand-typed JSON, the script loaded twice —
 * and that nothing the widget renders escapes its shadow root.
 */
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_FEATURES, readConfig } from "../src/embed";

const ENDPOINT = "https://shop.example/api/assistant";

/** Puts a script tag on the page and loads the embed as a browser would. */
async function loadEmbed(attributes: Record<string, string> = {}) {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  const script = document.createElement("script");
  script.setAttribute("data-concierge", "");
  script.setAttribute("data-endpoint", ENDPOINT);
  script.setAttribute("data-name", "Fit Assistant");
  for (const [name, value] of Object.entries(attributes)) {
    if (value === "") script.removeAttribute(name);
    else script.setAttribute(name, value);
  }
  document.head.append(script);

  vi.resetModules();
  await import("../src/embed");
  const host = document.querySelector("[data-concierge-root]");
  return { host, shadow: host?.shadowRoot ?? null };
}

const inShadow = (shadow: ShadowRoot | null, label: string) => shadow?.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? null;

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.className = "";
  delete document.documentElement.dataset.theme;
});

describe("readConfig", () => {
  const script = (dataset: Record<string, string>) => {
    const element = document.createElement("script");
    for (const [key, value] of Object.entries(dataset)) element.dataset[key] = value;
    return element;
  };

  it("takes the whole configuration off the tag", () => {
    expect(
      readConfig(
        script({
          endpoint: ENDPOINT,
          name: "Fit Assistant",
          greeting: "Hi there.",
          suggestions: "Help me choose | What's in stock? |",
          privacyNote: "Chats are kept for 90 days.",
          handoffHref: "https://wa.me/60123456789",
          handoffLabel: "WhatsApp us",
          placeholder: "Ask away…",
          labels: '{"send":"Hantar"}',
        }),
      ),
    ).toEqual({
      endpoint: ENDPOINT,
      features: ["history", "feedback", "new-chat"],
      assistantName: "Fit Assistant",
      greeting: "Hi there.",
      starterSuggestions: ["Help me choose", "What's in stock?"],
      privacyNote: "Chats are kept for 90 days.",
      handoff: { href: "https://wa.me/60123456789", label: "WhatsApp us" },
      placeholder: "Ask away…",
      labels: { send: "Hantar" },
    });
  });

  it("needs an endpoint and nothing else", () => {
    expect(readConfig(script({ endpoint: ENDPOINT }))).toMatchObject({ assistantName: "Assistant", starterSuggestions: [], features: ["history", "feedback", "new-chat"] });
    expect(readConfig(script({ name: "Fit Assistant" }))).toBeNull();
    expect(readConfig(script({ endpoint: "   " }))).toBeNull();
    expect(readConfig(null)).toBeNull();
  });

  it("takes only the features the shop says its endpoint implements", () => {
    expect(readConfig(script({ endpoint: ENDPOINT, features: "history, FEEDBACK" }))?.features).toEqual(["history", "feedback"]);
    expect(readConfig(script({ endpoint: ENDPOINT, features: "none" }))?.features).toEqual([]);
    expect(readConfig(script({ endpoint: ENDPOINT, features: "" }))?.features).toEqual([]);
    // Nothing said at all means the endpoint is the reference one: all of it.
    expect(readConfig(script({ endpoint: ENDPOINT }))?.features).toEqual(ALL_FEATURES);
  });

  it("ignores hand-typed JSON that is not valid, rather than losing the widget", () => {
    expect(readConfig(script({ endpoint: ENDPOINT, labels: "{send: Hantar}" }))?.labels).toBeUndefined();
    expect(readConfig(script({ endpoint: ENDPOINT, labels: '["send"]' }))?.labels).toBeUndefined();
  });

  it("names a contact even when only the link was given", () => {
    expect(readConfig(script({ endpoint: ENDPOINT, handoffHref: "mailto:hi@shop.test" }))?.handoff).toEqual({ href: "mailto:hi@shop.test", label: "Message the shop" });
  });
});

describe("the embed on a page", () => {
  it("mounts into a shadow root, so the shop's CSS and the widget's never meet", async () => {
    const { host, shadow } = await loadEmbed();

    expect(host).not.toBeNull();
    expect(shadow).not.toBeNull();
    expect(host!.parentElement).toBe(document.body);
    // Nothing the widget renders is reachable from the page's own document.
    expect(document.querySelector('[aria-label="Ask Fit Assistant"]')).toBeNull();
    expect(shadow!.querySelector("style")).not.toBeNull();
    await waitFor(() => expect(shadow!.textContent).toContain("Ask Fit Assistant"));
  });

  it("opens, and asks the endpoint the tag named", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"status","tool":"search_products"}\n'));
        controller.enqueue(encoder.encode('{"type":"reply","result":{"ok":true,"answer":"The Atlas.","suggestions":[],"products":[]}}\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async (_url: string, request: RequestInit) =>
      JSON.parse(String(request.body)).action === "history" ? Response.json({ messages: [] }) : new Response(body, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { shadow } = await loadEmbed();
    await waitFor(() => expect(shadow!.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow!.querySelector("button")!);

    const box = await waitFor(() => shadow!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!);
    fireEvent.change(box, { target: { value: "which paddle?" } });
    fireEvent.click(inShadow(shadow, "Send")!);

    await waitFor(() => expect(shadow!.textContent).toContain("The Atlas."));
    const asked = fetchMock.mock.calls.map(([url, request]) => [url, JSON.parse(String((request as RequestInit).body))] as const);
    expect(asked.some(([url, body]) => url === ENDPOINT && body.message === "which paddle?")).toBe(true);
  });

  it("does nothing at all without an endpoint", async () => {
    const { host } = await loadEmbed({ "data-endpoint": "" });

    expect(host).toBeNull();
  });

  it("mounts once, however many times the script runs", async () => {
    await loadEmbed();
    vi.resetModules();
    await import("../src/embed");

    expect(document.querySelectorAll("[data-concierge-root]")).toHaveLength(1);
  });

  it("follows the page into dark mode, which a shadow root cannot see for itself", async () => {
    document.documentElement.classList.add("dark");
    const { shadow } = await loadEmbed();

    const mountPoint = shadow!.querySelector("div")!;
    expect(mountPoint.classList.contains("dark")).toBe(true);

    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.theme = "dark";
    await waitFor(() => expect(mountPoint.classList.contains("dark")).toBe(true));

    delete document.documentElement.dataset.theme;
    await waitFor(() => expect(mountPoint.classList.contains("dark")).toBe(false));
  });
});

describe("mounting it by hand", () => {
  const config = { endpoint: ENDPOINT, assistantName: "Fit Assistant", greeting: "Hi.", starterSuggestions: [], features: [] };
  const PROPERTY_RULE = '@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}';

  it("puts the stylesheet's property registrations on the page, because a shadow root cannot", async () => {
    const { mount } = await import("../src/embed");

    mount(config, { css: `${PROPERTY_RULE}.fixed{position:fixed}` });

    const registered = document.head.querySelector("style[data-concierge-properties]");
    expect(registered?.textContent).toBe(PROPERTY_RULE);
    // Only the registrations: a selector on the page could restyle the shop.
    expect(registered?.textContent).not.toContain(".fixed");
    expect(document.querySelector("[data-concierge-root]")!.shadowRoot!.querySelector("style")!.textContent).toContain(".fixed");
  });

  it("registers them once, however many widgets are mounted", async () => {
    const { mount } = await import("../src/embed");

    mount(config, { css: PROPERTY_RULE });
    mount(config, { css: PROPERTY_RULE });

    expect(document.head.querySelectorAll("style[data-concierge-properties]")).toHaveLength(1);
  });

  it("registers nothing when the stylesheet has no registrations to make", async () => {
    const { mount } = await import("../src/embed");

    mount(config, { css: ".fixed{position:fixed}" });

    expect(document.head.querySelector("style[data-concierge-properties]")).toBeNull();
  });

  it("falls back to a plain request when the stream cannot answer", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('{"type":"reply","result":{"ok":true,"answer":"The Atlas.","suggestions":[],"products":[]}}\n'));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { mount } = await import("../src/embed");
    const shadow = mount(config);
    await waitFor(() => expect(shadow.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow.querySelector("button")!);

    const box = await waitFor(() => shadow.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!);
    fireEvent.change(box, { target: { value: "which paddle?" } });
    fireEvent.click(inShadow(shadow, "Send")!);

    await waitFor(() => expect(shadow.textContent).toContain("The Atlas."));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, second] = fetchMock.mock.calls[1]! as unknown as [string, RequestInit];
    expect(second.credentials).toBe("include");
  });
});

describe("the whole conversation, on someone else's site", () => {
  const config = { endpoint: ENDPOINT, assistantName: "Fit Assistant", greeting: "Hi.", starterSuggestions: [], features: ALL_FEATURES };

  /** An endpoint that answers each action, and records what it was asked. */
  function endpoint(overrides: { history?: unknown[] } = {}) {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body)) as Record<string, unknown>;
      calls.push(body);
      if (body.action === "history") return Response.json({ messages: overrides.history ?? [] });
      if (body.action === "feedback" || body.action === "new-chat") return Response.json({ ok: true });
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"type":"reply","result":{"ok":true,"answer":"The Atlas.","suggestions":[],"products":[]}}\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return { calls, fetchMock };
  }

  it("puts the conversation back when the chat is opened", async () => {
    const { calls } = endpoint({
      history: [
        { role: "user", content: "which paddle?" },
        { role: "assistant", content: "The Atlas.", suggestions: ["Compare them"], rating: "up" },
      ],
    });
    const { mount } = await import("../src/embed");

    const shadow = mount(config);
    await waitFor(() => expect(shadow.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow.querySelector("button")!);

    await waitFor(() => expect(shadow.textContent).toContain("The Atlas."));
    expect(shadow.textContent).toContain("Earlier in this chat");
    // Already rated on the earlier visit, so it is not asked for again.
    expect(shadow.textContent).toContain("Thanks");
    expect(calls[0]).toEqual({ action: "history" });
  });

  it("sends a rating, and asks for a new thread before clearing the screen", async () => {
    const { calls } = endpoint();
    const { mount } = await import("../src/embed");

    const shadow = mount(config);
    await waitFor(() => expect(shadow.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow.querySelector("button")!);
    const box = await waitFor(() => shadow.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!);
    fireEvent.change(box, { target: { value: "which paddle?" } });
    fireEvent.click(inShadow(shadow, "Send")!);
    await waitFor(() => expect(shadow.textContent).toContain("The Atlas."));

    fireEvent.click(inShadow(shadow, "This answer helped")!);
    await waitFor(() => expect(calls.some((call) => call.action === "feedback")).toBe(true));
    expect(calls.find((call) => call.action === "feedback")).toEqual({ action: "feedback", answer: "The Atlas.", rating: "up" });

    fireEvent.click(inShadow(shadow, "Start a new chat")!);
    await waitFor(() => expect(calls.some((call) => call.action === "new-chat")).toBe(true));
    await waitFor(() => expect(shadow.textContent).not.toContain("The Atlas."));
  });

  it("keeps the conversation when the endpoint cannot start a new one", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, request: RequestInit) => (JSON.parse(String(request.body)).action === "new-chat" ? new Response("", { status: 500 }) : Response.json({ messages: [{ role: "assistant", content: "The Atlas." }] }))));
    const { mount } = await import("../src/embed");

    const shadow = mount(config);
    await waitFor(() => expect(shadow.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow.querySelector("button")!);
    await waitFor(() => expect(shadow.textContent).toContain("The Atlas."));

    fireEvent.click(inShadow(shadow, "Start a new chat")!);

    await waitFor(() => expect(shadow.textContent).toContain("Couldn't start a new chat"));
    expect(shadow.textContent).toContain("The Atlas.");
  });

  it("offers none of it to an endpoint that only answers messages", async () => {
    const { calls } = endpoint();
    const { mount } = await import("../src/embed");

    const shadow = mount({ ...config, features: [] });
    await waitFor(() => expect(shadow.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow.querySelector("button")!);
    const box = await waitFor(() => shadow.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!);
    fireEvent.change(box, { target: { value: "which paddle?" } });
    fireEvent.click(inShadow(shadow, "Send")!);
    await waitFor(() => expect(shadow.textContent).toContain("The Atlas."));

    // No history request, no rating buttons, no New chat to press.
    expect(calls.every((call) => call.action === undefined)).toBe(true);
    expect(inShadow(shadow, "This answer helped")).toBeNull();
    expect(inShadow(shadow, "Start a new chat")).toBeNull();
  });

  it("reads only the parts of a restored message it understands", async () => {
    endpoint({
      history: [
        { role: "assistant", content: "The Atlas.", suggestions: ["ok", 7], products: [{ ref: "PAD-1", name: "Atlas", priceLabel: "RM 220.90", stockLabel: "In stock" }, { nonsense: true }], rating: "sideways" },
        { role: "narrator", content: "should be dropped" },
        { role: "user" },
      ],
    });
    const { mount } = await import("../src/embed");

    const shadow = mount(config);
    await waitFor(() => expect(shadow.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow.querySelector("button")!);

    await waitFor(() => expect(shadow.textContent).toContain("The Atlas."));
    expect(shadow.textContent).not.toContain("should be dropped");
    expect(shadow.querySelectorAll("a")).toHaveLength(1);
    // A rating it does not recognise is no rating: the buttons are still there.
    expect(inShadow(shadow, "This answer helped")).not.toBeNull();
  });
});
