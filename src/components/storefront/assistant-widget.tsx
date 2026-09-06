"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import type { AssistantTurn } from "@/lib/ai/assistant";
import { askAssistantAction, type AssistantProductCard } from "@/app/[tenant]/(storefront)/assistant/actions";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  products?: AssistantProductCard[];
  error?: boolean;
}

export function AssistantWidget({
  assistantName,
  greeting,
  configured,
  locale,
  starterSuggestions,
}: {
  assistantName: string;
  greeting: string;
  configured: boolean;
  locale: string;
  starterSuggestions: string[];
}) {
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
    const history: AssistantTurn[] = messages.filter((m) => !m.error).slice(1).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    startTransition(async () => {
      const result = await askAssistantAction({ message, history });
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
        aria-controls="assistant-panel"
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90"
      >
        <span aria-hidden className="inline-block size-2 rounded-full bg-green-400" />
        {open ? "Close" : `Ask ${assistantName}`}
      </button>

      {open ? (
        <section
          id="assistant-panel"
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
                  <div className={m.role === "user" ? "rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground" : m.error ? "rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" : "rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm whitespace-pre-line"}>
                    {m.content}
                  </div>
                  {m.products && m.products.length > 0 ? (
                    <div className="grid gap-2">
                      {m.products.map((p) => (
                        <Link key={p.sku} href={`/products/${p.slug}`} className="flex items-center gap-3 rounded-lg border bg-card p-2 text-sm hover:bg-muted/50">
                          <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                            {p.imageUrl ? <Image src={p.imageUrl} alt={p.name} fill unoptimized sizes="48px" className="object-cover" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.hasVariants ? "from " : ""}
                              {formatMoney(p.price, p.currency, locale)}
                              {p.stockQuantity <= 0 ? " · Sold out" : p.stockQuantity <= p.lowStockThreshold ? " · Low stock" : ""}
                            </p>
                          </div>
                        </Link>
                      ))}
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
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={configured ? "Ask about any product…" : "Assistant offline"} disabled={!configured || pending} maxLength={1000} aria-label="Message" />
            <Button type="submit" size="sm" disabled={!configured || pending || !input.trim()}>
              Send
            </Button>
          </form>
        </section>
      ) : null}
    </>
  );
}
