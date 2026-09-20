"use client";

/**
 * Mounts the Catalog Concierge widget for this storefront.
 *
 * The only glue needed: hand the widget our Server Actions — one to answer, one
 * to start a new thread — and render product cards with Next's client-side
 * navigation instead of a plain anchor.
 */
import Link from "next/link";
import { ConciergeWidget } from "catalog-concierge/react";
import { askAssistantAction, startNewChatAction } from "@/app/[tenant]/(storefront)/assistant/actions";

/**
 * Said plainly, where the customer is about to type. Every message is written
 * to the store's conversation log (`ChatConversation`) and the store's admins
 * can read it, so the widget says so rather than leaving people to guess.
 */
const PRIVACY_NOTE = "Chats are saved so this store can improve its answers.";

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
      privacyNote={PRIVACY_NOTE}
      onSend={askAssistantAction}
      onNewChat={startNewChatAction}
      renderProductLink={(product, children) => <Link href={product.url ?? "#"}>{children}</Link>}
    />
  );
}
