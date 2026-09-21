/**
 * The `<script>` embed, in jsdom. What matters here is what a shop's developer
 * gets wrong: a missing endpoint, hand-typed JSON, the script loaded twice —
 * and that nothing the widget renders escapes its shadow root.
 */
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/embed";

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
    expect(readConfig(script({ endpoint: ENDPOINT }))).toMatchObject({ assistantName: "Assistant", starterSuggestions: [] });
    expect(readConfig(script({ name: "Fit Assistant" }))).toBeNull();
    expect(readConfig(script({ endpoint: "   " }))).toBeNull();
    expect(readConfig(null)).toBeNull();
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
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { shadow } = await loadEmbed();
    await waitFor(() => expect(shadow!.textContent).toContain("Ask Fit Assistant"));
    fireEvent.click(shadow!.querySelector("button")!);

    const box = await waitFor(() => shadow!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!);
    fireEvent.change(box, { target: { value: "which paddle?" } });
    fireEvent.click(inShadow(shadow, "Send")!);

    await waitFor(() => expect(shadow!.textContent).toContain("The Atlas."));
    const [url, request] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(request.body))).toMatchObject({ message: "which paddle?" });
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
  const config = { endpoint: ENDPOINT, assistantName: "Fit Assistant", greeting: "Hi.", starterSuggestions: [] };
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
