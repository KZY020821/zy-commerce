"use client";

/**
 * Mounts the Catalog Concierge widget for this storefront.
 *
 * The only glue needed: hand the widget our Server Action, and render product
 * cards with Next's client-side navigation instead of a plain anchor.
 */
import Link from "next/link";
import { ConciergeWidget } from "catalog-concierge/react";
import { askAssistantAction } from "@/app/[tenant]/(storefront)/assistant/actions";

export function StorefrontAssistant({
  assistantName,
  greeting,
  starterSuggestions,
  configured,
}: {
  assistantName: string;
  greeting: string;
  starterSuggestions: string[];
  configured: boolean;
}) {
  return (
    <ConciergeWidget
      assistantName={assistantName}
      greeting={greeting}
      starterSuggestions={starterSuggestions}
      configured={configured}
      onSend={askAssistantAction}
      renderProductLink={(product, children) => <Link href={product.url ?? "#"}>{children}</Link>}
    />
  );
}
