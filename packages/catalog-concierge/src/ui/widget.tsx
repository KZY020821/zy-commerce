"use client";

/**
 * The chat widget. Self-contained on purpose: no design-system dependency, no
 * knowledge of how messages reach the server. The host supplies one `onSend`
 * function, usually a Server Action or a fetch to its own route, and — when it
 * keeps the conversation on its own side — an `onNewChat` that forgets it.
 *
 * Styling uses Tailwind utility classes and the CSS custom properties that
 * shadcn/ui and most Tailwind setups already define: --primary, --background,
 * --muted and friends. A project without them still renders a usable widget,
 * just in the browser default palette.
 */
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ConversationTurn, ProductCard, StockLabel } from "../types";

export type WidgetSendResult =
  | { ok: true; answer: string; suggestions: string[]; products: ProductCard[] }
  | { ok: false; error: string };

export interface ConciergeWidgetProps {
  /** Display name in the header and on the launcher button. */
  assistantName: string;
  /** First message shown before the customer types anything. */
  greeting: string;
  /** Quick-reply chips offered alongside the greeting. */
  starterSuggestions?: string[];
  /**
   * Sends a message and resolves with the reply. Typically a Next.js Server
   * Action wrapping `askConcierge`.
   */
  onSend: (input: { message: string; history: ConversationTurn[] }) => Promise<WidgetSendResult>;
  /**
   * Runs when the customer starts a new chat, before the screen clears. A host
   * that keeps the conversation on its own side, as the README advises, uses it
   * to start a fresh thread there; without it only the screen is cleared.
   */
  onNewChat?: () => Promise<void> | void;
  /** Set false to show an "offline" state, e.g. when no model key is configured. */
  configured?: boolean;
  /** Rendered when a product card is clicked. Defaults to a plain anchor. */
  renderProductLink?: (product: ProductCard, children: ReactNode) => ReactNode;
  placeholder?: string;
  maxLength?: number;
}

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  products?: ProductCard[];
  error?: boolean;
  /** On a failed reply: the question to send again when "Try again" is tapped. */
  retry?: string;
}

/** About six lines of text. Past that the box scrolls — downwards, never sideways. */
const MESSAGE_BOX_HEIGHT = "max-h-[9.75rem]";

const STOCK_BADGE: Record<StockLabel, string> = {
  "In stock": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Low stock": "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  "Sold out": "bg-muted text-muted-foreground",
};

export function ConciergeWidget({
  assistantName,
  greeting,
  starterSuggestions = [],
  onSend,
  onNewChat,
  configured = true,
  renderProductLink,
  placeholder = "Ask about any product…",
  maxLength = 1000,
}: ConciergeWidgetProps) {
  const opening: UiMessage = { role: "assistant", content: greeting, suggestions: starterSuggestions };
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([opening]);
  const [pending, startTransition] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const wasPending = useRef(false);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  // Opening puts the cursor in the message box; closing hands focus back to the launcher.
  useEffect(() => {
    if (open) boxRef.current?.focus();
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // The box is locked while a reply loads; give the cursor back when it lands.
  useEffect(() => {
    if (wasPending.current && !pending) boxRef.current?.focus();
    wasPending.current = pending;
  }, [pending]);

  // Grow with the text up to MESSAGE_BOX_HEIGHT, then scroll inside the box.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    if (box.scrollHeight > 0) box.style.height = `${box.scrollHeight}px`;
  }, [input, open]);

  function send(text: string, base: UiMessage[] = messages) {
    const message = text.trim();
    if (!message || pending || resetting || !configured) return;
    setNotice(null);
    // The greeting is ours, not part of the conversation the model sees.
    const history: ConversationTurn[] = base.filter((m) => !m.error).slice(1).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    startTransition(async () => {
      const result = await onSend({ message, history });
      setMessages((prev) =>
        result.ok
          ? [...prev, { role: "assistant", content: result.answer, suggestions: result.suggestions, products: result.products }]
          : [...prev, { role: "assistant", content: result.error, error: true, suggestions: ["Try again"], retry: message }],
      );
    });
  }

  /** Sends the failed question again in place of the failed exchange, so it isn't shown twice. */
  function retry(question: string) {
    const base = messages.slice(0, -2);
    setMessages(base);
    send(question, base);
  }

  async function startNewChat() {
    if (pending || resetting) return;
    setResetting(true);
    setNotice(null);
    try {
      await onNewChat?.();
      setMessages([opening]);
      setInput("");
    } catch {
      setNotice("Couldn't start a new chat. Please try again.");
    } finally {
      setResetting(false);
      boxRef.current?.focus();
    }
  }

  const last = messages[messages.length - 1];
  const started = messages.length > 1;
  const initial = assistantName.trim().charAt(0).toUpperCase() || "?";

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary py-3 pr-5 pl-4 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ChatIcon />
        <span>{`Ask ${assistantName}`}</span>
      </button>
    );
  }

  return (
    <section
      aria-label={assistantName}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(640px,calc(100dvh-2rem))] sm:w-[420px] sm:rounded-2xl sm:border sm:shadow-2xl"
    >
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{assistantName}</p>
          {/* The ellipsis needs its own inline box: text-overflow does nothing on a flex container. */}
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className={configured ? "size-1.5 shrink-0 rounded-full bg-emerald-500" : "size-1.5 shrink-0 rounded-full bg-muted-foreground/50"} />
            <span className="truncate">Answers from the product specs in this store</span>
          </p>
        </div>
        {started ? (
          <IconButton label="Start a new chat" onClick={startNewChat} disabled={pending || resetting}>
            <NewChatIcon />
          </IconButton>
        ) : null}
        <IconButton label="Close chat" onClick={() => setOpen(false)}>
          <CloseIcon />
        </IconButton>
      </header>

      {notice ? (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-xs">
          {notice}
        </p>
      ) : null}

      {/* Replies arrive without the reader moving focus, so they have to be
          announced. `polite` waits for a pause rather than interrupting. */}
      <div ref={listRef} role="log" aria-live="polite" aria-atomic="false" aria-busy={pending} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!configured ? (
          <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            The assistant is not connected to a model yet. Once a model key is configured it will answer questions from the product catalogue.
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={m.role === "user" ? "max-w-[85%]" : m.products?.length ? "w-full max-w-[92%] space-y-2" : "max-w-[92%]"}>
              <div
                className={
                  m.role === "user"
                    ? "rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap text-primary-foreground"
                    : m.error
                      ? "rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[0.9375rem] leading-relaxed"
                      : "rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-[0.9375rem] leading-relaxed break-words whitespace-pre-line"
                }
              >
                {m.content}
              </div>

              {m.products && m.products.length > 0 ? (
                <div className="grid gap-2">
                  {m.products.map((p) => {
                    const body = (
                      <>
                        <span className="block size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {/* Plain <img> on purpose: the package stays framework-agnostic. */}
                          {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="line-clamp-2 block text-sm leading-snug font-medium">{p.name}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold">
                              {p.priceFrom ? <span className="font-normal text-muted-foreground">from </span> : null}
                              {p.priceLabel}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STOCK_BADGE[p.stockLabel]}`}>{p.stockLabel}</span>
                          </span>
                        </span>
                        <ChevronIcon />
                      </>
                    );
                    const className = "flex items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition hover:border-foreground/20 hover:bg-muted/40";
                    return renderProductLink ? (
                      <div key={p.ref} className="contents">
                        {renderProductLink(p, <span className={className}>{body}</span>)}
                      </div>
                    ) : (
                      <a key={p.ref} href={p.url ?? "#"} className={className}>
                        {body}
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {pending ? (
          <div className="flex justify-start">
            <div role="status" className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-4 py-3.5">
              <span className="sr-only">Checking the catalogue…</span>
              {[0, 160, 320].map((delay) => (
                <span key={delay} aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t">
        {last?.suggestions && last.suggestions.length > 0 && !pending ? (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {last.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => (last.retry ? retry(last.retry) : send(s))}
                disabled={!configured || resetting}
                className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="px-3 pt-3 pb-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-input bg-background py-1.5 pr-1.5 pl-3.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <textarea
              ref={boxRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends and Shift+Enter starts a new line. Never send while an
                // input method is composing (Chinese, Japanese…): there Enter picks
                // a word, and Safari reports that keystroke as keyCode 229.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={configured ? placeholder : "Assistant offline"}
              disabled={!configured || pending}
              maxLength={maxLength}
              aria-label="Message"
              className={`${MESSAGE_BOX_HEIGHT} flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-[0.9375rem]`}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!configured || pending || !input.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            >
              <SendIcon />
            </button>
          </div>
          <p className="mt-1.5 hidden px-1 text-[11px] text-muted-foreground sm:block">Enter to send · Shift+Enter for a new line</p>
        </form>
      </div>
    </section>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

const ChatIcon = () => (
  <Icon className="size-5">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
  </Icon>
);
const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
const NewChatIcon = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);
const SendIcon = () => (
  <Icon>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);
const ChevronIcon = () => (
  <Icon className="size-4 shrink-0 text-muted-foreground">
    <path d="m9 18 6-6-6-6" />
  </Icon>
);
