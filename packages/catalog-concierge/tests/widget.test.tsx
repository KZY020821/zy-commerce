/**
 * The drop-in widget, rendered in jsdom. This is the part a client's customers
 * actually touch, so it is tested the way they use it: open it, type, tap.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductCard } from "../src/types";
import { ConciergeWidget, type ConciergeWidgetProps, type WidgetSendResult } from "../src/ui/widget";

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
}

describe("ConciergeWidget — opening and closing", () => {
  it("starts as a launcher and opens into a labelled panel with the greeting, starter chips and the cursor in the box", () => {
    renderWidget();
    expect(screen.queryByRole("region", { name: "Fit Assistant" })).toBeNull();

    openWidget();

    expect(screen.getByRole("region", { name: "Fit Assistant" })).toBeTruthy();
    expect(screen.getByText("Hi! Ask me anything.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help me choose" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask Fit Assistant" })).toBeNull();
    expect(document.activeElement).toBe(messageBox());
  });

  it("closes from the header or with Escape, and hands focus back to the launcher", () => {
    renderWidget();
    openWidget();
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.queryByRole("region", { name: "Fit Assistant" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Fit Assistant" }));

    openWidget();
    fireEvent.keyDown(messageBox(), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Fit Assistant" })).toBeNull();
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
    expect(screen.queryByRole("status")).toBeNull();
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
