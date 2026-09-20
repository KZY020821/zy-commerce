"use client";

/**
 * Mounts the Catalog Concierge widget for this storefront.
 *
 * The only glue needed: hand the widget our Server Actions — one to answer, one
 * to start a new thread — and render product cards with Next's client-side
 * navigation instead of a plain anchor.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConciergeWidget } from "catalog-concierge/react";
import { askAssistantAction, loadChatHistoryAction, rateAnswerAction, startNewChatAction } from "@/app/[tenant]/(storefront)/assistant/actions";
import { CHAT_RETENTION_DAYS } from "@/lib/ai/retention";

/**
 * Said plainly, where the customer is about to type. Every message is written
 * to the store's conversation log (`ChatConversation`) and the store's admins
 * can read it — for as long as the seed's retention pass leaves it there, and
 * no longer, which is the part worth stating.
 */
const PRIVACY_NOTE = `Chats are kept for ${CHAT_RETENTION_DAYS} days so this store can improve its answers.`;

export function StorefrontAssistant({
  assistantName,
  greeting,
  starterSuggestions,
  configured,
  handoff,
}: {
  assistantName: string;
  greeting: string;
  starterSuggestions: string[];
  configured: boolean;
  handoff?: { label: string; href: string };
}) {
  // Which page the question was asked from. The action resolves it against the
  // catalogue, so the assistant knows what "this one" means on a product page.
  const pathname = usePathname();

  return (
    <ConciergeWidget
      assistantName={assistantName}
      greeting={greeting}
      starterSuggestions={starterSuggestions}
      configured={configured}
      handoff={handoff}
      privacyNote={PRIVACY_NOTE}
      onSend={(input) => askAssistantAction({ ...input, path: pathname })}
      onNewChat={startNewChatAction}
      loadHistory={loadChatHistoryAction}
      onFeedback={rateAnswerAction}
      renderProductLink={(product, children) => <Link href={product.url ?? "#"}>{children}</Link>}
    />
  );
}
