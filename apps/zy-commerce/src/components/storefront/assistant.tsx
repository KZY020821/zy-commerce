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
import { ConciergeWidget, type ConversationTurn, type WidgetStreamEvent } from "catalog-concierge/react";
import { askAssistantAction, loadChatHistoryAction, rateAnswerAction, startNewChatAction } from "@/app/[tenant]/(storefront)/assistant/actions";
import { CHAT_RETENTION_DAYS } from "@/lib/ai/retention";

/**
 * Said plainly, where the customer is about to type. Every message is written
 * to the store's conversation log (`ChatConversation`) and the store's admins
 * can read it — for as long as the seed's retention pass leaves it there, and
 * no longer, which is the part worth stating.
 */
const PRIVACY_NOTE = `Chats are kept for ${CHAT_RETENTION_DAYS} days so this store can improve its answers.`;

/**
 * The streaming route, read one JSON line at a time.
 *
 * Every line is either what the assistant is doing right now or the finished
 * reply; the widget shows the first and renders the second. Anything that
 * throws here — a dropped connection, a proxy that buffered the response into
 * nothing — sends the widget to the plain Server Action instead, so the
 * customer still gets their answer.
 */
async function* streamAnswer(input: { message: string; history: ConversationTurn[] }, path: string): AsyncGenerator<WidgetStreamEvent> {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // History is not sent: the server replays its own record of this thread.
    body: JSON.stringify({ message: input.message, path }),
  });
  if (!response.ok || !response.body) throw new Error(`The assistant stream answered ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const event = readEvent(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event) yield event;
      newline = buffer.indexOf("\n");
    }
  }
}

/** One line of the stream, ignored unless it is a shape we know. */
function readEvent(line: string): WidgetStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const event = parsed as { type?: unknown; tool?: unknown; result?: unknown };
    if (event.type === "status" && typeof event.tool === "string") return { kind: "tool", name: event.tool };
    if (event.type === "reply" && event.result && typeof event.result === "object") return { kind: "reply", result: event.result as WidgetStreamEvent extends { kind: "reply"; result: infer R } ? R : never };
    return null;
  } catch {
    return null;
  }
}

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
      onSendStream={(input) => streamAnswer(input, pathname)}
      onSend={(input) => askAssistantAction({ ...input, path: pathname })}
      onNewChat={startNewChatAction}
      loadHistory={loadChatHistoryAction}
      onFeedback={rateAnswerAction}
      renderProductLink={(product, children) => <Link href={product.url ?? "#"}>{children}</Link>}
    />
  );
}
