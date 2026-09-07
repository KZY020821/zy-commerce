"use client";

/**
 * The chat widget. Self-contained on purpose: no design-system dependency, no
 * knowledge of how messages reach the server. The host supplies one `onSend`
 * function, usually a Server Action or a fetch to its own route.
 *
 * Styling uses Tailwind utility classes and the CSS custom properties that
 * shadcn/ui and most Tailwind setups already define: --primary, --background,
 * --muted and friends. A project without them still renders a usable widget,
 * just in the browser default palette.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import type { ConversationTurn, ProductCard } from "../types";

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
  /** Set false to show an "offline" state, e.g. when no model key is configured. */
  configured?: boolean;
  /** Rendered when a product card is clicked. Defaults to a plain anchor. */
  renderProductLink?: (product: ProductCard, children: React.ReactNode) => React.ReactNode;
  placeholder?: string;
  maxLength?: number;
}

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  products?: ProductCard[];
  error?: boolean;
}

export function ConciergeWidget({
  assistantName,
  greeting,
  starterSuggestions = [],
  onSend,
  configured = true,
  renderProductLink,
  placeholder = "Ask about any product…",
  maxLength = 1000,
}: ConciergeWidgetProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([{ role: "assistant", content: greeting, suggestions: starterSuggestions }]);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    // The greeting is ours, not part of the conversation the model sees.
    const history: ConversationTurn[] = messages.filter((m) => !m.error).slice(1).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    startTransition(async () => {
      const result = await onSend({ message, history });
      setMessages((prev) =>
        result.ok
          ? [...prev, { role: "assistant", content: result.answer, suggestions: result.suggestions, products: result.products }]
          : [...prev, { role: "assistant", content: result.error, error: true, suggestions: ["Try again"] }],
      );
    });
  }

  const last = messages[messages.length - 1];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="concierge-panel"
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90"
      >
        <span aria-hidden className="inline-block size-2 rounded-full bg-green-400" />
        {open ? "Close" : `Ask ${assistantName}`}
      </button>

      {open ? (
        <section
          id="concierge-panel"
          aria-label={assistantName}
          className="fixed right-4 bottom-20 z-40 flex h-[min(600px,calc(100vh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        >
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{assistantName}</p>
              <p className="text-xs text-muted-foreground">Answers from the product specs in this store</p>
            </div>
            <span aria-hidden className="inline-block size-6 rounded-full bg-primary" />
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {!configured ? (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                The assistant is not connected to a model yet. Once a model key is configured it will answer questions from the product catalogue.
              </div>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className="max-w-[88%] space-y-2">
                  <div
                    className={
                      m.role === "user"
                        ? "rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                        : m.error
                          ? "rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                          : "rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm whitespace-pre-line"
                    }
                  >
                    {m.content}
                  </div>

                  {m.products && m.products.length > 0 ? (
                    <div className="grid gap-2">
                      {m.products.map((p) => {
                        const body = (
                          <>
                            <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                              {/* Plain <img> on purpose: the package stays framework-agnostic. */}
                              {p.imageUrl ? (
                                <img src={p.imageUrl} alt={p.name} className="size-full object-cover" loading="lazy" />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{p.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.priceFrom ? "from " : ""}
                                {p.priceLabel}
                                {p.stockLabel === "In stock" ? "" : ` · ${p.stockLabel}`}
                              </p>
                            </div>
                          </>
                        );
                        const className = "flex items-center gap-3 rounded-lg border bg-card p-2 text-sm hover:bg-muted/50";
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
                <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">Checking the catalogue…</div>
              </div>
            ) : null}
          </div>

          {last?.suggestions && last.suggestions.length > 0 && !pending ? (
            <div className="flex flex-wrap gap-2 border-t px-4 py-2">
              {last.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={!configured} className="rounded-full border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50">
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
            className="flex items-center gap-2 border-t p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={configured ? placeholder : "Assistant offline"}
              disabled={!configured || pending}
              maxLength={maxLength}
              aria-label="Message"
              data-slot="input"
              onKeyDown={(e) => {
                // Send on Enter explicitly rather than relying on the form's
                // implicit submission, which a host can break by nesting the
                // widget inside another form.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30"
            />
            <button
              type="submit"
              disabled={!configured || pending || !input.trim()}
              data-slot="button"
              className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent bg-primary bg-clip-padding px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-primary-foreground transition-all outline-none select-none hover:bg-primary/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
