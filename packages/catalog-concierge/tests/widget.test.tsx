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
const messageBox = () => screen.getByLabelText("Message") as HTMLInputElement;
const type = (text: string) => fireEvent.change(messageBox(), { target: { value: text } });

describe("ConciergeWidget", () => {
  it("starts as a launcher and opens into a labelled panel with the greeting and starter chips", () => {
    renderWidget();
    expect(screen.queryByRole("region", { name: "Fit Assistant" })).toBeNull();

    openWidget();

    expect(screen.getByRole("region", { name: "Fit Assistant" })).toBeTruthy();
    expect(screen.getByText("Hi! Ask me anything.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help me choose" })).toBeTruthy();
    const launcher = screen.getByRole("button", { name: "Close" });
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
  });

  it("announces replies to screen readers", () => {
    renderWidget();
    openWidget();
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
  });

  it("sends a typed message and shows the reply with product cards and new chips", async () => {
    const { onSend } = renderWidget();
    openWidget();
    type("which paddle for a beginner?");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith({ message: "which paddle for a beginner?", history: [] });
    expect(await screen.findByText("Here are two options.")).toBeTruthy();
    expect(screen.getByText("which paddle for a beginner?")).toBeTruthy();

    const link = screen.getByRole("link", { name: /Atlas Control Paddle/ });
    expect(link.getAttribute("href")).toBe("/products/atlas");
    expect(link.textContent).toContain("from RM 220.90 · Low stock");
    expect(screen.getByRole("button", { name: "Compare them" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Help me choose" })).toBeNull();
    expect(messageBox().value).toBe("");
  });

  it("sends on Enter but not on Shift+Enter", async () => {
    const { onSend } = renderWidget();
    openWidget();
    type("show me paddles");
    fireEvent.keyDown(messageBox(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    await screen.findByText("Here are two options.");
  });

  it("never sends an empty or whitespace-only message", () => {
    const { onSend } = renderWidget();
    openWidget();
    type("   ");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(messageBox(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("The assistant is busy.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

    type("second question");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Here are two options.");

    expect(onSend).toHaveBeenLastCalledWith({ message: "second question", history: [{ role: "user", content: "first question" }] });
  });

  it("shows a pending state and locks the input until the reply arrives", async () => {
    let resolveReply!: (r: WidgetSendResult) => void;
    const onSend = vi.fn<ConciergeWidgetProps["onSend"]>(() => new Promise<WidgetSendResult>((r) => (resolveReply = r)));
    renderWidget({ onSend });
    openWidget();
    type("show me paddles");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText("Checking the catalogue…")).toBeTruthy();
    expect(messageBox().disabled).toBe(true);

    resolveReply(replied);
    expect(await screen.findByText("Here are two options.")).toBeTruthy();
    expect(screen.queryByText("Checking the catalogue…")).toBeNull();
    expect(messageBox().disabled).toBe(false);
  });

  it("uses the host's link renderer for product cards when one is given", async () => {
    renderWidget({ renderProductLink: (product, children) => <a href={`/custom/${product.ref}`} data-testid="host-link">{children}</a> });
    openWidget();
    type("paddles");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
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

  it("caps the message length", () => {
    renderWidget({ maxLength: 50 });
    openWidget();
    expect(messageBox().maxLength).toBe(50);
  });
});
