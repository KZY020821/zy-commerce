/**
 * The storefront chrome every visitor sees. The demo notice in particular is
 * a legal safeguard, so its presence is asserted rather than assumed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/(storefront)/assistant/actions", () => ({ askAssistantAction: vi.fn(), startNewChatAction: vi.fn(), loadChatHistoryAction: vi.fn(), rateAnswerAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/products/slk-atlas-max" }));

import type { Tenant } from "@/generated/prisma/client";
import { askAssistantAction, loadChatHistoryAction, rateAnswerAction, startNewChatAction } from "@/app/[tenant]/(storefront)/assistant/actions";
import { StorefrontAssistant } from "@/components/storefront/assistant";
import { StorefrontFooter } from "@/components/storefront/footer";
import { StorefrontHeader } from "@/components/storefront/header";
import { ProductCard } from "@/components/storefront/product-card";
import { StockBadge } from "@/components/storefront/stock-badge";
import { formatMoney } from "@/lib/money";

const tenant = (over: Partial<Tenant> = {}) => ({ id: "t-acme", slug: "acme", name: "Acme Store", logoUrl: null, contactEmail: null, ...over }) as Tenant;

describe("StorefrontHeader", () => {
  it("shows the uploaded logo when the store has one", () => {
    render(<StorefrontHeader tenant={tenant({ logoUrl: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo.png" })} />);
    expect(screen.getByRole("img", { name: "Acme Store" }).getAttribute("src")).toBe("https://store.public.blob.vercel-storage.com/tenants/t-acme/logo.png");
  });

  it("falls back to a square in the brand colour when there is no logo", () => {
    render(<StorefrontHeader tenant={tenant()} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: "Acme Store" }).getAttribute("href")).toBe("/");
  });

  it("offers product search on every screen size, and labels the store as a demo", () => {
    render(<StorefrontHeader tenant={tenant()} />);
    const search = screen.getByRole("search");
    expect(search.getAttribute("action")).toBe("/");
    expect((within(search).getByRole("searchbox", { name: "Search products" }) as HTMLInputElement).name).toBe("q");
    expect(search.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByText("Demo")).toBeTruthy();
  });
});

describe("StorefrontFooter", () => {
  it("always carries the demonstration notice", () => {
    render(<StorefrontFooter tenant={tenant()} />);
    expect(screen.getByText("Demonstration store.")).toBeTruthy();
    expect(screen.getByText(/not affiliated with, endorsed by, or connected to any brand shown/)).toBeTruthy();
    expect(screen.getByText(/nothing here is for sale/)).toBeTruthy();
  });

  it("links the contact email only when there is one", () => {
    const { unmount } = render(<StorefrontFooter tenant={tenant({ contactEmail: "hello@acme.test" })} />);
    expect(screen.getByRole("link", { name: "hello@acme.test" }).getAttribute("href")).toBe("mailto:hello@acme.test");
    unmount();
    render(<StorefrontFooter tenant={tenant()} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("ProductCard", () => {
  const base = { slug: "atlas", name: "Atlas Paddle", price: 22090, currency: "MYR", stockQuantity: 3, lowStockThreshold: 5, hasVariants: true, imageUrl: "https://cdn.shopify.com/atlas.jpg", imageAlt: null, categoryName: "Paddles" };

  it("links to the product and shows its price, category and stock", () => {
    render(<ProductCard locale="en-MY" product={base} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/products/atlas");
    expect(link.textContent).toContain("from");
    expect(link.textContent).toContain(formatMoney(22090, "MYR", "en-MY"));
    expect(link.textContent).toContain("Paddles");
    expect(screen.getByText("Low stock")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Atlas Paddle" }).getAttribute("src")).toBe("https://cdn.shopify.com/atlas.jpg");
  });

  it("shows a placeholder without an image, and no 'from' for a single price", () => {
    render(<ProductCard locale="en-MY" product={{ ...base, imageUrl: null, hasVariants: false }} />);
    expect(screen.getByText("No image")).toBeTruthy();
    expect(screen.getByRole("link").textContent).not.toContain("from");
  });
});

describe("StockBadge", () => {
  it("labels sold-out, low and healthy stock", () => {
    render(
      <>
        <StockBadge quantity={0} lowStockThreshold={5} />
        <StockBadge quantity={3} lowStockThreshold={5} />
        <StockBadge quantity={50} lowStockThreshold={5} />
      </>,
    );
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.getByText("Low stock")).toBeTruthy();
    expect(screen.getByText("In stock")).toBeTruthy();
  });
});

describe("StorefrontAssistant", () => {
  // Every test gets a widget with nothing to restore unless it says otherwise.
  beforeEach(() => {
    vi.mocked(loadChatHistoryAction).mockResolvedValue([]);
  });

  it("mounts the widget with the store's assistant, and shows the offline state when unconfigured", () => {
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    expect(screen.getByText("Hi from Acme")).toBeTruthy();
    expect(screen.getByText(/not connected to a model yet/)).toBeTruthy();
  });

  /** The streaming route, answering in lines, the way the browser reads it. */
  function streamOf(lines: string[], init: ResponseInit = {}) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { status: 200, ...init });
  }

  it("reads the streaming route and shows what the assistant is doing before the answer", async () => {
    const fetchMock = vi.fn(async () =>
      streamOf([
        '{"type":"status","tool":"search_products"}\n',
        // A line split across chunks, which is what a real stream does.
        '{"type":"reply","result":{"ok":true,"answer":"Try the At',
        'las.","suggestions":[],"products":[]}}\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "which paddle?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Try the Atlas.")).toBeTruthy();
    expect(askAssistantAction).not.toHaveBeenCalled();
    const [url, request] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/api/assistant");
    expect(JSON.parse(String(request.body))).toEqual({ message: "which paddle?", path: "/products/slk-atlas-max" });
    vi.unstubAllGlobals();
  });

  it("shows the answer arriving before the reply lands", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamOf([
          '{"type":"status","tool":"search_products"}\n',
          '{"type":"answer","delta":"Try the "}\n',
          '{"type":"answer","delta":"Atlas."}\n',
          '{"type":"reply","result":{"ok":true,"answer":"Try the Atlas.","suggestions":[],"products":[]}}\n',
        ]),
      ),
    );
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "which paddle?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The pieces are shown as they arrive and end as one message, not four.
    expect(await screen.findByText("Try the Atlas.")).toBeTruthy();
    expect(screen.getAllByText("Try the Atlas.")).toHaveLength(1);
    expect(askAssistantAction).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("falls back to the Server Action when the stream cannot answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    vi.mocked(askAssistantAction).mockResolvedValue({ ok: true, answer: "Try the Atlas.", suggestions: [], products: [] });
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "which paddle?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Try the Atlas.")).toBeTruthy();
    expect(askAssistantAction).toHaveBeenCalledWith({ message: "which paddle?", history: [], path: "/products/slk-atlas-max" });
    vi.unstubAllGlobals();
  });

  it("ignores a line of the stream it does not understand", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamOf(["not json\n", "123\n", '{"type":"who knows"}\n', "\n", '{"type":"reply","result":{"ok":false,"error":"The assistant is busy."}}\n'])));
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "which paddle?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The assistant is busy.")).toBeTruthy();
    expect(askAssistantAction).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("asks again through the Server Action when the stream ends without answering", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamOf(['{"type":"status","tool":"search_products"}\n'])));
    vi.mocked(askAssistantAction).mockResolvedValue({ ok: true, answer: "Try the Atlas.", suggestions: [], products: [] });
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "which paddle?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Try the Atlas.")).toBeTruthy();
    expect(askAssistantAction).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("sends the page the question was asked from, so the assistant knows what \"this one\" is", async () => {
    vi.mocked(askAssistantAction).mockResolvedValue({ ok: true, answer: "It suits beginners.", suggestions: [], products: [] });
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "is this one good for a beginner?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("It suits beginners.");

    expect(askAssistantAction).toHaveBeenCalledWith({ message: "is this one good for a beginner?", history: [], path: "/products/slk-atlas-max" });
  });

  it("puts the conversation from the last visit back on screen when the chat is opened", async () => {
    vi.mocked(loadChatHistoryAction).mockResolvedValue([
      { role: "user", content: "which paddle for a beginner?" },
      { role: "assistant", content: "The Atlas is the gentlest.", suggestions: ["Compare the top two"] },
    ]);
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);

    expect(loadChatHistoryAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));

    expect(await screen.findByText("The Atlas is the gentlest.")).toBeTruthy();
    expect(screen.getByText("Earlier in this chat")).toBeTruthy();
  });

  it("records what the customer thought of an answer", async () => {
    vi.mocked(askAssistantAction).mockResolvedValue({ ok: true, answer: "Try the Atlas.", suggestions: [], products: [] });
    vi.mocked(rateAnswerAction).mockResolvedValue(undefined);
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "which paddle?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Try the Atlas.");

    fireEvent.click(screen.getByRole("button", { name: "This answer didn't help" }));

    expect(rateAnswerAction).toHaveBeenCalledWith({ answer: "Try the Atlas.", rating: "down" });
  });

  it("renders the assistant's product cards as client-side links, and a card with no page as a dead end", async () => {
    vi.mocked(askAssistantAction).mockResolvedValue({
      ok: true,
      answer: "Two options.",
      suggestions: [],
      products: [
        { ref: "PAD-1", name: "Atlas", url: "/products/atlas", imageUrl: null, price: 22090, priceFrom: false, priceLabel: "RM 220.90", stockLabel: "In stock" },
        { ref: "PAD-2", name: "Vanguard", url: null, imageUrl: null, price: 44590, priceFrom: true, priceLabel: "RM 445.90", stockLabel: "Sold out" },
      ],
    });
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "paddles?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Two options.");

    expect(screen.getByRole("link", { name: /Atlas/ }).getAttribute("href")).toBe("/products/atlas");
    expect(screen.getByRole("link", { name: /Vanguard/ }).getAttribute("href")).toBe("#");
  });

  it("tells customers their chat is kept, because this store keeps it", () => {
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    expect(screen.getByText("Chats are kept for 90 days so this store can improve its answers.")).toBeTruthy();
  });

  it("wires New chat to the server, so the assistant forgets the old thread", async () => {
    vi.mocked(askAssistantAction).mockResolvedValue({ ok: true, answer: "Try the Atlas.", suggestions: [], products: [] });
    vi.mocked(startNewChatAction).mockResolvedValue(undefined);
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Try the Atlas.");
    // The answer appears one commit before the transition that loaded it ends,
    // and New chat is deliberately inert while a reply is still in flight.
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));

    await screen.findByRole("button", { name: "Help me choose" });
    expect(startNewChatAction).toHaveBeenCalledTimes(1);
  });
});
