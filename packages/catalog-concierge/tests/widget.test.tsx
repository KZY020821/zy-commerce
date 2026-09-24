/**
 * The drop-in widget, rendered in jsdom. This is the part a client's customers
 * actually touch, so it is tested the way they use it: open it, type, tap.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductCard } from "../src/types";
import { ConciergeWidget, type ConciergeWidgetProps, type WidgetSendResult, type WidgetStreamEvent } from "../src/ui/widget";

const card: ProductCard = { ref: "PAD-1", name: "Atlas Control Paddle", url: "/products/atlas", imageUrl: "https://img.test/atlas.png", price: 22090, priceFrom: true, priceLabel: "RM 220.90", stockLabel: "Low stock" };

const replied: WidgetSendResult = { ok: true, answer: "Here are two options.", suggestions: ["Compare them"], products: [card] };

function renderWidget(overrides: Partial<ConciergeWidgetProps> = {}) {
  const onSend = vi.fn<ConciergeWidgetProps["onSend"]>(async () => replied);
  render(<ConciergeWidget assistantName="Fit Assistant" greeting="Hi! Ask me anything." starterSuggestions={["Help me choose"]} onSend={onSend} {...overrides} />);
  return { onSend: (overrides.onSend as typeof onSend | undefined) ?? onSend };
}

const openWidget = () => fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
const messageBox = () => screen.getByLabelText("Message") as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(messageBox(), { target: { value: text } });
const sendButton = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;

async function sendAndWait(text: string) {
  type(text);
  fireEvent.click(sendButton());
  await screen.findByText("Here are two options.");
  // The reply is painted one commit before the transition that loaded it ends.
  // Anything the widget holds back while a reply is in flight — New chat, the
  // chips — needs that second commit, so wait for the typing dots to go.
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
}

describe("ConciergeWidget — opening and closing", () => {
  it("starts as a launcher and opens into a labelled panel with the greeting, starter chips and the cursor in the box", () => {
    renderWidget();
    expect(screen.queryByRole("dialog", { name: "Fit Assistant" })).toBeNull();

    openWidget();

    expect(screen.getByRole("dialog", { name: "Fit Assistant" })).toBeTruthy();
    expect(screen.getByText("Hi! Ask me anything.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help me choose" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask Fit Assistant" })).toBeNull();
    expect(document.activeElement).toBe(messageBox());
  });

  it("closes from the header or with Escape, and hands focus back to the launcher", () => {
    renderWidget();
    openWidget();
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.queryByRole("dialog", { name: "Fit Assistant" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Fit Assistant" }));

    openWidget();
    fireEvent.keyDown(messageBox(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Fit Assistant" })).toBeNull();
  });

  it("announces replies to screen readers", () => {
    renderWidget();
    openWidget();
    expect(screen.getByRole("log").getAttribute("aria-live")).toBe("polite");
  });
});

describe("ConciergeWidget — the message box", () => {
  it("is a multi-line box: Enter sends, Shift+Enter adds a line, and Enter never sends mid-composition", async () => {
    const { onSend } = renderWidget();
    openWidget();
    expect(messageBox().tagName).toBe("TEXTAREA");
    type("show me paddles");

    fireEvent.keyDown(messageBox(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(messageBox(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(messageBox(), { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ message: "show me paddles", history: [] });
    await screen.findByText("Here are two options.");
  });

  it("keeps line breaks: a multi-line message is sent and shown as written", async () => {
    const { onSend } = renderWidget();
    openWidget();
    await sendAndWait("line one\nline two");

    expect(onSend).toHaveBeenCalledWith({ message: "line one\nline two", history: [] });
    const bubble = screen.getByText(/line one\s+line two/);
    expect(bubble.className).toContain("whitespace-pre-wrap");
  });

  it("grows with the text up to about six lines, then scrolls inside instead of sideways", async () => {
    renderWidget();
    openWidget();
    const box = messageBox();
    expect(box.className).toContain("max-h-[9.75rem]");
    expect(box.className).toContain("overflow-y-auto");

    let contentHeight = 132;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => contentHeight });
    type("a long question that wraps over several lines");
    expect(box.style.height).toBe("132px");

    contentHeight = 36;
    fireEvent.click(sendButton());
    await screen.findByText("Here are two options.");
    expect(box.value).toBe("");
    expect(box.style.height).toBe("36px");
  });

  it("never sends an empty or whitespace-only message", () => {
    const { onSend } = renderWidget();
    openWidget();
    type("   \n  ");
    expect(sendButton().disabled).toBe(true);
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("caps the message length", () => {
    renderWidget({ maxLength: 50 });
    openWidget();
    expect(messageBox().maxLength).toBe(50);
  });
});

describe("ConciergeWidget — the conversation", () => {
  it("sends a typed message and shows the reply with a product card, its stock badge and new chips", async () => {
    const { onSend } = renderWidget();
    openWidget();
    await sendAndWait("which paddle for a beginner?");

    expect(onSend).toHaveBeenCalledWith({ message: "which paddle for a beginner?", history: [] });
    expect(screen.getByText("which paddle for a beginner?")).toBeTruthy();

    const link = screen.getByRole("link", { name: /Atlas Control Paddle/ });
    expect(link.getAttribute("href")).toBe("/products/atlas");
    expect(link.textContent).toContain("from RM 220.90");
    expect(screen.getByText("Low stock").className).toContain("amber");
    expect(screen.getByRole("button", { name: "Compare them" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Help me choose" })).toBeNull();
    expect(messageBox().value).toBe("");
  });

  it("colours each stock state: green in stock, amber low, muted sold out", async () => {
    const products: ProductCard[] = [
      { ...card, ref: "A", name: "Paddle A", stockLabel: "In stock" },
      { ...card, ref: "B", name: "Paddle B", stockLabel: "Low stock" },
      // No photo, no page and a single price: the card still renders sensibly.
      { ...card, ref: "C", name: "Paddle C", stockLabel: "Sold out", imageUrl: null, url: null, priceFrom: false },
    ];
    renderWidget({ onSend: vi.fn<ConciergeWidgetProps["onSend"]>(async () => ({ ok: true, answer: "Three paddles.", suggestions: [], products })) });
    openWidget();
    type("paddles");
    fireEvent.click(sendButton());
    await screen.findByText("Three paddles.");

    expect(screen.getByText("In stock").className).toContain("emerald");
    expect(screen.getByText("Low stock").className).toContain("amber");
    expect(screen.getByText("Sold out").className).toContain("text-muted-foreground");
    const bare = screen.getByRole("link", { name: /Paddle C/ });
    expect(bare.getAttribute("href")).toBe("#");
    expect(bare.querySelector("img")).toBeNull();
    expect(bare.textContent).not.toContain("from");
  });

  it("sends a tapped chip as the message", async () => {
    const { onSend } = renderWidget();
    openWidget();
    fireEvent.click(screen.getByRole("button", { name: "Help me choose" }));
    expect(onSend).toHaveBeenCalledWith({ message: "Help me choose", history: [] });
    await screen.findByText("Here are two options.");
  });

  it("passes the visible conversation as history, without the greeting or failed turns", async () => {
    const onSend = vi
      .fn<ConciergeWidgetProps["onSend"]>()
      .mockResolvedValueOnce({ ok: false, error: "The assistant is busy." })
      .mockResolvedValueOnce(replied);
    renderWidget({ onSend });
    openWidget();

    type("first question");
    fireEvent.click(sendButton());
    expect(await screen.findByText("The assistant is busy.")).toBeTruthy();

    await sendAndWait("second question");
    expect(onSend).toHaveBeenLastCalledWith({ message: "second question", history: [{ role: "user", content: "first question" }] });
  });

  it("'Try again' re-sends the failed question once, not the words 'Try again'", async () => {
    const onSend = vi
      .fn<ConciergeWidgetProps["onSend"]>()
      .mockResolvedValueOnce({ ok: false, error: "The assistant is busy." })
      .mockResolvedValueOnce(replied);
    renderWidget({ onSend });
    openWidget();
    type("first question");
    fireEvent.click(sendButton());
    await screen.findByText("The assistant is busy.");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Here are two options.");

    expect(onSend).toHaveBeenLastCalledWith({ message: "first question", history: [] });
    expect(screen.getAllByText("first question")).toHaveLength(1);
    expect(screen.queryByText("The assistant is busy.")).toBeNull();
  });

  it("shows typing dots while the reply loads, locks the box, then gives the cursor back", async () => {
    let resolveReply!: (r: WidgetSendResult) => void;
    const onSend = vi.fn<ConciergeWidgetProps["onSend"]>(() => new Promise<WidgetSendResult>((r) => (resolveReply = r)));
    renderWidget({ onSend });
    openWidget();
    type("show me paddles");
    fireEvent.click(sendButton());

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Checking the catalogue…");
    expect(status.querySelectorAll(".motion-safe\\:animate-bounce")).toHaveLength(3);
    expect(messageBox().disabled).toBe(true);

    resolveReply(replied);
    expect(await screen.findByText("Here are two options.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(messageBox().disabled).toBe(false);
    expect(document.activeElement).toBe(messageBox());
  });

  it("uses the host's link renderer for product cards when one is given", async () => {
    renderWidget({ renderProductLink: (product, children) => <a href={`/custom/${product.ref}`} data-testid="host-link">{children}</a> });
    openWidget();
    type("paddles");
    fireEvent.click(sendButton());
    const link = await screen.findByTestId("host-link");
    expect(link.getAttribute("href")).toBe("/custom/PAD-1");
  });

  it("shows an offline state and refuses input when no model is configured", () => {
    renderWidget({ configured: false });
    openWidget();
    expect(screen.getByText(/not connected to a model yet/)).toBeTruthy();
    expect(messageBox().disabled).toBe(true);
    expect(messageBox().placeholder).toBe("Assistant offline");
    expect((screen.getByRole("button", { name: "Help me choose" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("ConciergeWidget — new chat", () => {
  it("is offered only once a conversation has started", async () => {
    renderWidget();
    openWidget();
    expect(screen.queryByRole("button", { name: "Start a new chat" })).toBeNull();
    await sendAndWait("hello");
    expect(screen.getByRole("button", { name: "Start a new chat" })).toBeTruthy();
  });

  it("asks the host to forget the conversation, then clears the screen back to the greeting", async () => {
    const onNewChat = vi.fn(async () => {});
    const { onSend } = renderWidget({ onNewChat });
    openWidget();
    await sendAndWait("first question");

    fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));
    await screen.findByRole("button", { name: "Help me choose" });

    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Here are two options.")).toBeNull();
    expect(screen.getByText("Hi! Ask me anything.")).toBeTruthy();
    expect(document.activeElement).toBe(messageBox());

    await sendAndWait("fresh start");
    expect(onSend).toHaveBeenLastCalledWith({ message: "fresh start", history: [] });
  });

  it("keeps the conversation, and says so, when the host could not start a new one", async () => {
    renderWidget({ onNewChat: vi.fn(async () => Promise.reject(new Error("network"))) });
    openWidget();
    await sendAndWait("first question");

    fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't start a new chat. Please try again.");
    expect(screen.getByText("Here are two options.")).toBeTruthy();
  });

  it("clears the screen on its own when the host keeps no history", async () => {
    renderWidget();
    openWidget();
    await sendAndWait("first question");

    fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));

    await screen.findByRole("button", { name: "Help me choose" });
    expect(screen.queryByText("first question")).toBeNull();
  });
});

/**
 * A phone-sized screen, faked. jsdom has no layout, so the widget's own media
 * query is the only thing that can tell it the panel is covering the page.
 */
function stubScreen({ phone, keyboardLeaves }: { phone: boolean; keyboardLeaves?: number }) {
  const mediaQuery = { matches: phone, media: "(max-width: 639px)", addEventListener: vi.fn(), removeEventListener: vi.fn() };
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => mediaQuery });
  if (keyboardLeaves !== undefined) {
    Object.defineProperty(window, "visualViewport", { configurable: true, writable: true, value: { height: keyboardLeaves, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  }
  return mediaQuery;
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(window, "visualViewport");
});

const panel = () => screen.getByRole("dialog", { name: "Fit Assistant" });

describe("ConciergeWidget — speaking the store's language", () => {
  it("says everything in the labels it is given", () => {
    renderWidget({
      labels: {
        launcher: "Tanya {name}",
        subtitle: "Jawapan daripada spesifikasi produk kedai ini",
        close: "Tutup sembang",
        messageLabel: "Mesej",
        send: "Hantar",
        placeholder: "Tanya tentang mana-mana produk…",
        inputHint: "Enter untuk hantar",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Tanya Fit Assistant" }));

    expect(screen.getByText("Jawapan daripada spesifikasi produk kedai ini")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tutup sembang" })).toBeTruthy();
    expect((screen.getByLabelText("Mesej") as HTMLTextAreaElement).placeholder).toBe("Tanya tentang mana-mana produk…");
    expect(screen.getByRole("button", { name: "Hantar" })).toBeTruthy();
    expect(screen.getByText("Enter untuk hantar")).toBeTruthy();
  });

  it("keeps the English default for every label the host leaves out", () => {
    renderWidget({ labels: { send: "Hantar" } });
    openWidget();

    expect(screen.getByRole("button", { name: "Hantar" })).toBeTruthy();
    expect(screen.getByText("Answers from the product specs in this store")).toBeTruthy();
    expect(messageBox().placeholder).toBe("Ask about any product…");
  });

  it("translates the offline state, the typing line and the retry chip too", async () => {
    const labels = { thinking: "Sedang menyemak katalog…", retry: "Cuba lagi" };
    const onSend = vi.fn<ConciergeWidgetProps["onSend"]>(async () => ({ ok: false, error: "Ada masalah." }));
    renderWidget({ labels, onSend });
    openWidget();
    type("paddle");
    fireEvent.click(sendButton());

    expect(await screen.findByRole("button", { name: "Cuba lagi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("ConciergeWidget — telling customers what happens to their messages", () => {
  it("shows the host's privacy line under the box, on every screen size", () => {
    renderWidget({ privacyNote: "Chats are saved to improve this store's answers." });
    openWidget();

    const line = screen.getByText("Chats are saved to improve this store's answers.");
    expect(line.closest("p")!.className).not.toContain("hidden");
    // The keyboard hint is the part that only makes sense with a keyboard.
    expect(screen.getByText("Enter to send · Shift+Enter for a new line").className).toContain("hidden sm:inline");
  });

  it("claims nothing about storage when the host gives no line", () => {
    renderWidget();
    openWidget();

    expect(screen.queryByText(/saved/i)).toBeNull();
    expect(screen.getByText("Enter to send · Shift+Enter for a new line").closest("p")!.className).toContain("hidden sm:block");
  });
});

describe("ConciergeWidget — keyboard shortcut", () => {
  it("opens with Ctrl+Shift+K and closes with ⌘+Shift+K", () => {
    renderWidget();

    fireEvent.keyDown(document, { key: "K", ctrlKey: true, shiftKey: true });
    expect(panel()).toBeTruthy();

    fireEvent.keyDown(document, { key: "k", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog", { name: "Fit Assistant" })).toBeNull();
  });

  it("needs both modifiers, so typing the letter never opens it", () => {
    renderWidget();

    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "k", shiftKey: true });

    expect(screen.queryByRole("dialog", { name: "Fit Assistant" })).toBeNull();
  });

  it("takes the host's letter, and can be turned off entirely", () => {
    renderWidget({ shortcutKey: "j" });
    fireEvent.keyDown(document, { key: "j", ctrlKey: true, shiftKey: true });
    expect(panel()).toBeTruthy();
  });

  it("binds nothing when the host passes null", () => {
    renderWidget({ shortcutKey: null });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog", { name: "Fit Assistant" })).toBeNull();
  });
});

describe("ConciergeWidget — on a phone", () => {
  it("is a modal dialog and keeps Tab inside itself", () => {
    stubScreen({ phone: true });
    renderWidget();
    openWidget();

    expect(panel().getAttribute("aria-modal")).toBe("true");

    // Last stop forward is the box (Send is disabled while it is empty).
    expect(document.activeElement).toBe(messageBox());
    fireEvent.keyDown(messageBox(), { key: "Tab" });
    const close = screen.getByRole("button", { name: "Close chat" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(messageBox());
  });

  it("shrinks to the space the on-screen keyboard leaves visible", () => {
    stubScreen({ phone: true, keyboardLeaves: 420 });
    renderWidget();
    openWidget();

    expect(panel().style.height).toBe("420px");
  });

  it("stays a plain panel on a larger screen: no modal, no focus trap, no forced height", () => {
    stubScreen({ phone: false, keyboardLeaves: 420 });
    renderWidget();
    openWidget();

    expect(panel().getAttribute("aria-modal")).toBeNull();
    expect(panel().style.height).toBe("");
    fireEvent.keyDown(messageBox(), { key: "Tab" });
    expect(document.activeElement).toBe(messageBox());
  });
});

describe("ConciergeWidget — reading back through the conversation", () => {
  /** jsdom has no layout: give the transcript the shape of a scrolled list. */
  function scrollList(list: HTMLElement, { from }: { from: number }) {
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => 1000 - 400 - from });
    fireEvent.scroll(list);
  }

  it("offers a jump back to the latest, and hides it again once there", async () => {
    renderWidget();
    openWidget();
    const list = screen.getByRole("log");
    const scrollTo = vi.spyOn(list, "scrollTo").mockImplementation(() => {});

    scrollList(list, { from: 300 });
    const jump = await screen.findByRole("button", { name: /Jump to latest/ });

    fireEvent.click(jump);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
  });

  it("does not drag the customer back down when a reply lands while they are reading", async () => {
    let resolveReply!: (r: WidgetSendResult) => void;
    const onSend = vi.fn<ConciergeWidgetProps["onSend"]>(() => new Promise<WidgetSendResult>((r) => (resolveReply = r)));
    renderWidget({ onSend });
    openWidget();
    type("which paddle?");
    fireEvent.click(sendButton());

    const list = screen.getByRole("log");
    const scrollTo = vi.spyOn(list, "scrollTo").mockImplementation(() => {});
    scrollList(list, { from: 300 });

    resolveReply(replied);
    await screen.findByText("Here are two options.");

    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeTruthy();
  });

  it("follows the conversation down again as soon as the customer sends something", async () => {
    renderWidget();
    openWidget();
    const list = screen.getByRole("log");
    vi.spyOn(list, "scrollTo").mockImplementation(() => {});
    scrollList(list, { from: 300 });
    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeTruthy();

    await sendAndWait("show me paddles");
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
  });
});

describe("ConciergeWidget — putting the earlier conversation back", () => {
  const earlier = [
    { role: "user" as const, content: "which paddle for a beginner?" },
    { role: "assistant" as const, content: "The Atlas is the gentlest one.", suggestions: ["Compare the top two"], products: [card] },
  ];

  it("asks for it only when the chat is opened, and shows it under a divider", async () => {
    const loadHistory = vi.fn(async () => earlier);
    renderWidget({ loadHistory });
    expect(loadHistory).not.toHaveBeenCalled();

    openWidget();

    expect(await screen.findByText("The Atlas is the gentlest one.")).toBeTruthy();
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Hi! Ask me anything.")).toBeTruthy();
    expect(screen.getByText("Earlier in this chat")).toBeTruthy();
    expect(screen.getByText("which paddle for a beginner?")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Atlas Control Paddle/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare the top two" })).toBeTruthy();
  });

  it("sends the restored conversation on as history, so the screen and the assistant agree", async () => {
    const { onSend } = renderWidget({ loadHistory: vi.fn(async () => earlier) });
    openWidget();
    await screen.findByText("The Atlas is the gentlest one.");

    await sendAndWait("and the other one?");

    expect(onSend).toHaveBeenLastCalledWith({
      message: "and the other one?",
      history: [
        { role: "user", content: "which paddle for a beginner?" },
        { role: "assistant", content: "The Atlas is the gentlest one." },
      ],
    });
  });

  it("does not put it back after the customer starts a new chat", async () => {
    const loadHistory = vi.fn(async () => earlier);
    renderWidget({ loadHistory, onNewChat: vi.fn(async () => {}) });
    openWidget();
    await screen.findByText("The Atlas is the gentlest one.");

    fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));
    await screen.findByRole("button", { name: "Help me choose" });

    expect(screen.queryByText("The Atlas is the gentlest one.")).toBeNull();
    expect(screen.queryByText("Earlier in this chat")).toBeNull();
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it("carries on with just the greeting when there is nothing to restore, or it fails", async () => {
    renderWidget({ loadHistory: vi.fn(async () => []) });
    openWidget();
    await screen.findByRole("button", { name: "Help me choose" });
    expect(screen.queryByText("Earlier in this chat")).toBeNull();

    cleanup();

    renderWidget({ loadHistory: vi.fn(async () => Promise.reject(new Error("offline"))) });
    openWidget();
    expect(screen.getByText("Hi! Ask me anything.")).toBeTruthy();
    await sendAndWait("show me paddles");
    expect(screen.getByText("Here are two options.")).toBeTruthy();
  });
});

describe("ConciergeWidget — reaching a person", () => {
  it("offers the host's way out, opened in a new tab", () => {
    renderWidget({ handoff: { label: "Message us on WhatsApp", href: "https://wa.me/60123456789" } });
    openWidget();

    const link = screen.getByRole("link", { name: "Message us on WhatsApp" });
    expect(link.getAttribute("href")).toBe("https://wa.me/60123456789");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(screen.getByText(/Need a person\?/)).toBeTruthy();
  });

  it("says nothing about a person when the host offers none", () => {
    renderWidget();
    openWidget();
    expect(screen.queryByText(/Need a person\?/)).toBeNull();
  });
});

describe("ConciergeWidget — what the customer thought of the answer", () => {
  it("offers a rating on answers, but never on the greeting or an error", async () => {
    const onFeedback = vi.fn();
    const onSend = vi
      .fn<ConciergeWidgetProps["onSend"]>()
      .mockResolvedValueOnce({ ok: false, error: "The assistant is busy." })
      .mockResolvedValueOnce(replied);
    renderWidget({ onFeedback, onSend });
    openWidget();

    // The greeting is ours, not an answer.
    expect(screen.queryByRole("button", { name: "This answer helped" })).toBeNull();

    type("first question");
    fireEvent.click(sendButton());
    await screen.findByText("The assistant is busy.");
    expect(screen.queryByRole("button", { name: "This answer helped" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Here are two options.");
    expect(screen.getByRole("button", { name: "This answer helped" })).toBeTruthy();
  });

  it("sends the rating with the answer it belongs to, then thanks the customer instead of asking again", async () => {
    const onFeedback = vi.fn(async () => {});
    renderWidget({ onFeedback });
    openWidget();
    await sendAndWait("which paddle?");

    fireEvent.click(screen.getByRole("button", { name: "This answer didn't help" }));

    expect(onFeedback).toHaveBeenCalledWith({ answer: "Here are two options.", rating: "down" });
    expect(await screen.findByText("Thanks — this helps the shop improve.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "This answer helped" })).toBeNull();
  });

  it("keeps the thanks on screen when the host could not record it", async () => {
    renderWidget({ onFeedback: vi.fn(async () => Promise.reject(new Error("offline"))) });
    openWidget();
    await sendAndWait("which paddle?");

    fireEvent.click(screen.getByRole("button", { name: "This answer helped" }));

    expect(await screen.findByText("Thanks — this helps the shop improve.")).toBeTruthy();
  });

  it("asks for nothing when the host records no feedback", async () => {
    renderWidget();
    openWidget();
    await sendAndWait("which paddle?");

    expect(screen.queryByRole("button", { name: "This answer helped" })).toBeNull();
  });

  it("does not ask again for an answer rated on an earlier visit", async () => {
    renderWidget({
      onFeedback: vi.fn(),
      loadHistory: vi.fn(async () => [
        { role: "user" as const, content: "which paddle?" },
        { role: "assistant" as const, content: "The Atlas.", rating: "up" as const },
      ]),
    });
    openWidget();

    expect(await screen.findByText("The Atlas.")).toBeTruthy();
    expect(screen.getByText("Thanks — this helps the shop improve.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "This answer helped" })).toBeNull();
  });
});

describe("ConciergeWidget — saying what it is doing", () => {
  /** A host that reports progress, one event at a time, on demand. */
  function scriptedStream(events: WidgetStreamEvent[]) {
    const released: Array<() => void> = [];
    const stream = async function* () {
      for (const event of events) {
        await new Promise<void>((resolve) => released.push(resolve));
        yield event;
      }
    };
    return { stream: vi.fn(() => stream()), next: async () => { released.shift()?.(); await Promise.resolve(); } };
  }

  it("shows what the assistant is doing, in order, then the answer", async () => {
    const { stream, next } = scriptedStream([
      { kind: "tool", name: "search_products" },
      { kind: "tool", name: "compare_products" },
      { kind: "reply", result: replied },
    ]);
    renderWidget({ onSendStream: stream });
    openWidget();
    type("compare the two paddles");
    fireEvent.click(sendButton());

    await next();
    expect((await screen.findByRole("status")).textContent).toContain("Searching the catalogue…");
    await next();
    expect((await screen.findByRole("status")).textContent).toContain("Comparing products…");

    await next();
    expect(await screen.findByText("Here are two options.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to the plain transport when the stream breaks before answering", async () => {
    const onSendStream = vi.fn(async function* (): AsyncGenerator<WidgetStreamEvent> {
      yield { kind: "tool", name: "search_products" };
      throw new Error("connection lost");
    });
    const { onSend } = renderWidget({ onSendStream });
    openWidget();
    await sendAndWait("which paddle?");

    expect(onSendStream).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({ message: "which paddle?", history: [] });
    expect(screen.getByText("Here are two options.")).toBeTruthy();
  });

  it("does not ask twice when the stream answered and then failed", async () => {
    const onSendStream = vi.fn(async function* (): AsyncGenerator<WidgetStreamEvent> {
      yield { kind: "reply", result: replied };
      throw new Error("connection lost after the answer");
    });
    const { onSend } = renderWidget({ onSendStream });
    openWidget();
    await sendAndWait("which paddle?");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("names an unfamiliar tool in the same words as no tool at all", async () => {
    const { stream, next } = scriptedStream([{ kind: "tool", name: "consult_the_oracle" }, { kind: "reply", result: replied }]);
    renderWidget({ onSendStream: stream });
    openWidget();
    type("which paddle?");
    fireEvent.click(sendButton());

    await next();
    expect((await screen.findByRole("status")).textContent).toContain("Checking the catalogue…");

    await next();
    await screen.findByText("Here are two options.");
  });

  it("still uses the plain transport when the host streams nothing", async () => {
    const { onSend } = renderWidget();
    openWidget();
    await sendAndWait("which paddle?");
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("ConciergeWidget — why this product", () => {
  it("shows the assistant's reason under the product's name", async () => {
    const products: ProductCard[] = [
      { ...card, ref: "PAD-1", name: "Atlas", note: "16mm core, easiest on the arm" },
      { ...card, ref: "PAD-2", name: "Vanguard" },
    ];
    renderWidget({ onSend: vi.fn<ConciergeWidgetProps["onSend"]>(async () => ({ ok: true, answer: "Two options.", suggestions: [], products })) });
    openWidget();
    type("which paddle for tennis elbow?");
    fireEvent.click(sendButton());
    await screen.findByText("Two options.");

    expect(screen.getByText("16mm core, easiest on the arm")).toBeTruthy();
    // The one without a reason says nothing rather than something vague.
    expect(screen.getByRole("link", { name: /Vanguard/ }).textContent).not.toContain("16mm");
  });
});

describe("ConciergeWidget — when a new chat is not possible", () => {
  it("does not offer one, so the screen and the assistant cannot disagree", async () => {
    renderWidget({ allowNewChat: false });
    openWidget();
    await sendAndWait("which paddle?");

    expect(screen.queryByRole("button", { name: "Start a new chat" })).toBeNull();
    expect(screen.getByText("Here are two options.")).toBeTruthy();
  });
});
