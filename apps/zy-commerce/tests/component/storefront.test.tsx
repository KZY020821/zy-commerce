/**
 * The storefront chrome every visitor sees. The demo notice in particular is
 * a legal safeguard, so its presence is asserted rather than assumed.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/[tenant]/(storefront)/assistant/actions", () => ({ askAssistantAction: vi.fn() }));

import type { Tenant } from "@/generated/prisma/client";
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
  it("mounts the widget with the store's assistant, and shows the offline state when unconfigured", () => {
    render(<StorefrontAssistant assistantName="Fit Assistant" greeting="Hi from Acme" starterSuggestions={["Help me choose"]} configured={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask Fit Assistant" }));
    expect(screen.getByText("Hi from Acme")).toBeTruthy();
    expect(screen.getByText(/not connected to a model yet/)).toBeTruthy();
  });
});
