"use client";

/**
 * The chat widget. Self-contained on purpose: no design-system dependency, no
 * knowledge of how messages reach the server. The host supplies one `onSend`
 * function, usually a Server Action or a fetch to its own route, and — when it
 * keeps the conversation on its own side — an `onNewChat` that forgets it.
 *
 * Every word it says comes from `labels`, so a store that sells in Malay or
 * Chinese can translate the interface without forking the component.
 *
 * Both roots carry `concierge-widget`, which the prebuilt stylesheet uses to
 * scope its handful of base rules — a host without Tailwind's preflight would
 * otherwise get browser-default blue underlined links and Arial buttons inside
 * the widget, and nothing outside it may be touched to fix that.
 *
 * Styling uses Tailwind utility classes and the CSS custom properties that
 * shadcn/ui and most Tailwind setups already define: --primary, --background,
 * --muted and friends. A project without them still renders a usable widget,
 * just in the browser default palette.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { AssistantAnswer, AssistantStreamEvent, ConversationTurn, ProductCard, RestoredMessage, StockLabel } from "../types";

/** Kept as the widget's own names for shapes that live in `types.ts`. */
export type WidgetSendResult = AssistantAnswer;
export type WidgetStreamEvent = AssistantStreamEvent;

export type { RestoredMessage };

/** Every fixed string the widget shows. Override any subset through `labels`. */
export interface WidgetLabels {
  /** Launcher button. `{name}` is replaced with the assistant's name. */
  launcher: string;
  /** The line under the assistant's name in the header. */
  subtitle: string;
  newChat: string;
  close: string;
  /** Accessible name of the message box. */
  messageLabel: string;
  send: string;
  placeholder: string;
  offlinePlaceholder: string;
  offlineNotice: string;
  /** Shown while a reply is being prepared, and read out to screen readers. */
  thinking: string;
  /** What it is doing right now, when the host reports its progress. */
  workingCategories: string;
  workingSearch: string;
  workingProduct: string;
  workingCompare: string;
  /** Keyboard help under the box. Desktop only — it mentions Enter. */
  inputHint: string;
  newChatFailed: string;
  jumpToLatest: string;
  /** Divider above messages restored from an earlier visit. */
  earlier: string;
  /** Precedes the link to a person, e.g. "Need a person?". */
  handoffPrompt: string;
  /** Accessible names of the two rating buttons, and what replaces them. */
  ratingUp: string;
  ratingDown: string;
  ratingThanks: string;
  /** Shown while that conversation is being fetched. */
  restoring: string;
  /** The chip offered when a reply failed. Tapping it re-sends the question. */
  retry: string;
  /** Prefix for a price that varies by variant, e.g. "from RM 220.90". */
  priceFrom: string;
}

export const DEFAULT_WIDGET_LABELS: WidgetLabels = {
  launcher: "Ask {name}",
  subtitle: "Answers from the product specs in this store",
  newChat: "Start a new chat",
  close: "Close chat",
  messageLabel: "Message",
  send: "Send",
  placeholder: "Ask about any product…",
  offlinePlaceholder: "Assistant offline",
  offlineNotice: "The assistant is not connected to a model yet. Once a model key is configured it will answer questions from the product catalogue.",
  thinking: "Checking the catalogue…",
  workingCategories: "Looking at what this store sells…",
  workingSearch: "Searching the catalogue…",
  workingProduct: "Reading the product details…",
  workingCompare: "Comparing products…",
  inputHint: "Enter to send · Shift+Enter for a new line",
  newChatFailed: "Couldn't start a new chat. Please try again.",
  jumpToLatest: "Jump to latest",
  earlier: "Earlier in this chat",
  handoffPrompt: "Need a person?",
  ratingUp: "This answer helped",
  ratingDown: "This answer didn't help",
  ratingThanks: "Thanks — this helps the shop improve.",
  restoring: "Looking for your last chat…",
  retry: "Try again",
  priceFrom: "from ",
};

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
   * Sends a message and reports progress until the reply lands.
   *
   * Preferred over `onSend` when given: a turn takes several seconds, and
   * saying what the assistant is doing — searching, comparing — is the
   * difference between waiting and wondering whether it is broken. If the
   * stream fails before a reply arrives, `onSend` is used instead, so a
   * customer never loses a question to a dropped connection.
   */
  onSendStream?: (input: { message: string; history: ConversationTurn[] }) => AsyncIterable<WidgetStreamEvent>;
  /**
   * Runs when the customer starts a new chat, before the screen clears. A host
   * that keeps the conversation on its own side, as the README advises, uses it
   * to start a fresh thread there; without it only the screen is cleared.
   */
  onNewChat?: () => Promise<void> | void;
  /**
   * Puts the conversation the customer already had back on screen, called once
   * when the chat is first opened.
   *
   * A host that keeps history server-side (as the README advises) has the
   * assistant remembering a conversation the customer can no longer see after
   * a reload — it will answer "the first one" against a blank screen. Return
   * the recent turns, oldest first, and the widget shows them under an
   * "earlier" divider. Failures are ignored: the chat still works without it.
   */
  loadHistory?: () => Promise<RestoredMessage[]>;
  /** Set false to show an "offline" state, e.g. when no model key is configured. */
  configured?: boolean;
  /** Rendered when a product card is clicked. Defaults to a plain anchor. */
  renderProductLink?: (product: ProductCard, children: ReactNode) => ReactNode;
  /** Translations / rewording. Anything omitted keeps its English default. */
  labels?: Partial<WidgetLabels>;
  /**
   * Records what a customer thought of an answer.
   *
   * Without it no rating is offered at all. With it, each answer carries two
   * buttons, and what the host does with them — usually storing them beside
   * the conversation — is what tells a shop owner where the assistant is
   * letting customers down.
   */
  onFeedback?: (feedback: { answer: string; rating: "up" | "down" }) => Promise<void> | void;
  /**
   * A way to reach a human: WhatsApp, email, a contact page.
   *
   * An assistant that cannot help is where most shops lose the sale, so the
   * way out is on screen rather than waiting to be asked for.
   */
  handoff?: { label: string; href: string };
  /**
   * One short line under the message box saying what happens to what the
   * customer types, e.g. "Chats are saved to improve this store's answers."
   * Nothing is shown when it is omitted — only the host knows what it stores.
   */
  privacyNote?: string;
  /**
   * Letter that opens and closes the chat with Ctrl/⌘ + Shift. Defaults to
   * "k"; pass null for no shortcut.
   */
  shortcutKey?: string | null;
  /** Shortcut for `labels.placeholder`, kept for hosts that already pass it. */
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
  /** First message of a restored conversation: the divider goes above it. */
  earlier?: boolean;
  /** Set once the customer has rated this answer, here or on an earlier visit. */
  rating?: "up" | "down";
}

/** About six lines of text. Past that the box scrolls — downwards, never sideways. */
const MESSAGE_BOX_HEIGHT = "max-h-[9.75rem]";

/** Below this the panel covers the screen, which changes how it must behave. */
const PHONE_QUERY = "(max-width: 639px)";

/** Distance from the bottom of the transcript that counts as "scrolled away". */
const STICKY_SLACK_PX = 48;

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** The assistant's tools, in the customer's words. */
const WORKING: Record<string, keyof WidgetLabels> = {
  list_categories: "workingCategories",
  search_products: "workingSearch",
  get_product: "workingProduct",
  compare_products: "workingCompare",
};

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
  onSendStream,
  onNewChat,
  loadHistory,
  onFeedback,
  configured = true,
  renderProductLink,
  labels,
  handoff,
  privacyNote,
  shortcutKey = "k",
  placeholder,
  maxLength = 1000,
}: ConciergeWidgetProps) {
  const text = { ...DEFAULT_WIDGET_LABELS, ...labels };
  const opening: UiMessage = { role: "assistant", content: greeting, suggestions: starterSuggestions };
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([opening]);
  const [pending, startTransition] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scrolledAway, setScrolledAway] = useState(false);
  const [restoring, setRestoring] = useState(false);
  /** The tool the assistant is using right now, when the host reports it. */
  const [working, setWorking] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  /** Height of the part of the screen the browser is actually showing. */
  const [visibleHeight, setVisibleHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const wasPending = useRef(false);
  /** False once the customer scrolls up: new replies must not yank them back. */
  const stickToBottom = useRef(true);
  /** Asked for once per mount, so New chat is never undone by a late restore. */
  const askedForHistory = useRef(false);

  /** Scrolls the transcript to the newest message and follows it from then on. */
  function scrollToLatest() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    stickToBottom.current = true;
    // Only ever called with something to change: a redundant state update here
    // would land inside the transition that is loading a reply and hold it open.
    if (scrolledAway) setScrolledAway(false);
  }

  useEffect(() => {
    if (stickToBottom.current) scrollToLatest();
  }, [messages, pending, open]);

  // What the customer said before they reloaded the page. The assistant still
  // remembers it, so the screen should too.
  useEffect(() => {
    if (!open || !loadHistory || askedForHistory.current) return;
    askedForHistory.current = true;
    let cancelled = false;
    setRestoring(true);
    void (async () => {
      try {
        const earlier = await loadHistory();
        if (!cancelled && earlier.length > 0) setMessages([opening, ...earlier.map((m, i) => ({ ...m, earlier: i === 0 }))]);
      } catch {
        // A conversation that cannot be restored is not worth an error over:
        // the customer can still ask their question.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadHistory]);

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

  // On a phone the panel covers the page, so it behaves as a modal: focus stays
  // inside it. On a larger screen it is a panel beside the page and does not.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const sync = () => setFullScreen(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  // An on-screen keyboard shrinks the visible area without moving a fixed
  // element, which is how the send button ends up underneath it. The visual
  // viewport is the only thing that knows the real height.
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!viewport || !open || !fullScreen) {
      setVisibleHeight(null);
      return;
    }
    const sync = () => setVisibleHeight(viewport.height);
    sync();
    viewport.addEventListener("resize", sync);
    return () => viewport.removeEventListener("resize", sync);
  }, [open, fullScreen]);

  // Ctrl/⌘ + Shift + K from anywhere on the page, including while the customer
  // is typing in one of the store's own fields.
  useEffect(() => {
    if (!shortcutKey || typeof document === "undefined") return;
    const wanted = shortcutKey.toLowerCase();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== wanted) return;
      e.preventDefault();
      setOpen((wasOpenNow) => !wasOpenNow);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcutKey]);

  /** Keeps Tab inside the panel while it is the only thing on screen. */
  function trapFocus(e: React.KeyboardEvent) {
    const panel = panelRef.current;
    if (!fullScreen || !panel) return;
    const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function send(messageText: string, base: UiMessage[] = messages) {
    const message = messageText.trim();
    if (!message || pending || resetting || !configured) return;
    setNotice(null);
    // The greeting is ours, not part of the conversation the model sees.
    const history: ConversationTurn[] = base.filter((m) => !m.error).slice(1).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    // Sending is a deliberate act: follow the answer even if they had scrolled up.
    stickToBottom.current = true;
    if (scrolledAway) setScrolledAway(false);
    startTransition(async () => {
      const result = await answer({ message, history });
      setWorking(null);
      setMessages((prev) =>
        result.ok
          ? [...prev, { role: "assistant", content: result.answer, suggestions: result.suggestions, products: result.products }]
          : [...prev, { role: "assistant", content: result.error, error: true, suggestions: [text.retry], retry: message }],
      );
    });
  }

  /**
   * Records a rating optimistically: the buttons are a courtesy, and making
   * the customer wait for a round trip to see them acknowledged would make
   * this feel heavier than it is. A failure leaves the thanks on screen and
   * is the host's to log.
   */
  function rate(index: number, rating: "up" | "down") {
    const message = messages[index];
    if (!message || message.rating) return;
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, rating } : m)));
    void Promise.resolve(onFeedback?.({ answer: message.content, rating })).catch(() => {});
  }

  /**
   * The reply, through the streaming host if there is one.
   *
   * A stream that fails before delivering anything falls back to `onSend`:
   * the customer waited for this answer, and a dropped connection is not a
   * reason to make them ask again.
   */
  async function answer(input: { message: string; history: ConversationTurn[] }): Promise<WidgetSendResult> {
    if (onSendStream) {
      try {
        for await (const event of onSendStream(input)) {
          if (event.kind === "reply") return event.result;
          setWorking(event.name);
        }
      } catch {
        // Falls through to the plain transport below.
      }
      setWorking(null);
    }
    return onSend(input);
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
      setNotice(text.newChatFailed);
    } finally {
      setResetting(false);
      boxRef.current?.focus();
    }
  }

  const last = messages[messages.length - 1];
  const started = messages.length > 1;
  const initial = assistantName.trim().charAt(0).toUpperCase() || "?";
  const boxPlaceholder = placeholder ?? text.placeholder;

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="concierge-widget fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-full bg-primary py-3 pr-5 pl-4 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ChatIcon />
        <span>{text.launcher.replace("{name}", assistantName)}</span>
      </button>
    );
  }

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-label={assistantName}
      aria-modal={fullScreen || undefined}
      style={visibleHeight ? { height: `${visibleHeight}px` } : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
        if (e.key === "Tab") trapFocus(e);
      }}
      className="concierge-widget fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(640px,calc(100dvh-2rem))] sm:w-[420px] sm:rounded-2xl sm:border sm:shadow-2xl"
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
            <span className="truncate">{text.subtitle}</span>
          </p>
        </div>
        {started ? (
          <IconButton label={text.newChat} onClick={startNewChat} disabled={pending || resetting}>
            <NewChatIcon />
          </IconButton>
        ) : null}
        <IconButton label={text.close} onClick={() => setOpen(false)}>
          <CloseIcon />
        </IconButton>
      </header>

      {notice ? (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-xs">
          {notice}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {/* Replies arrive without the reader moving focus, so they have to be
            announced. `polite` waits for a pause rather than interrupting. */}
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-busy={pending}
          onScroll={(e) => {
            const list = e.currentTarget;
            const away = list.scrollHeight - list.scrollTop - list.clientHeight > STICKY_SLACK_PX;
            stickToBottom.current = !away;
            setScrolledAway(away);
          }}
          className="h-full space-y-4 overflow-y-auto px-4 py-4"
        >
          {!configured ? <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">{text.offlineNotice}</div> : null}

          {restoring ? (
            <p role="status" className="text-center text-xs text-muted-foreground">
              {text.restoring}
            </p>
          ) : null}

          {messages.map((m, i) => (
            <Fragment key={i}>
              {m.earlier ? (
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  {text.earlier}
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </p>
              ) : null}
              <div className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
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

                  {onFeedback && m.role === "assistant" && !m.error && i > 0 ? (
                    m.rating ? (
                      <p className="px-1 text-[11px] text-muted-foreground">{text.ratingThanks}</p>
                    ) : (
                      <div className="flex items-center gap-0.5 px-0.5">
                        <RatingButton label={text.ratingUp} onClick={() => rate(i, "up")}>
                          <ThumbIcon />
                        </RatingButton>
                        <RatingButton label={text.ratingDown} onClick={() => rate(i, "down")}>
                          <ThumbIcon down />
                        </RatingButton>
                      </div>
                    )
                  ) : null}

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
                              {/* Why this one, in the assistant's own words. */}
                              {p.note ? <span className="line-clamp-1 block text-xs text-muted-foreground">{p.note}</span> : null}
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-semibold">
                                  {p.priceFrom ? <span className="font-normal text-muted-foreground">{text.priceFrom}</span> : null}
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
            </Fragment>
          ))}

          {pending ? (
            <div className="flex justify-start">
              <div role="status" className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-muted px-4 py-3">
                <span className="flex items-center gap-1">
                  {[0, 160, 320].map((delay) => (
                    <span key={delay} aria-hidden className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </span>
                {/* What it is actually doing, when the host says; otherwise
                    the same line that was only ever read to screen readers. */}
                <span className={working ? "text-xs text-muted-foreground" : "sr-only"}>{working ? text[WORKING[working] ?? "thinking"] : text.thinking}</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Reading back through a long answer should not mean missing the next one. */}
        {scrolledAway ? (
          <button
            type="button"
            onClick={() => scrollToLatest()}
            className="absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-md transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <DownIcon />
            {text.jumpToLatest}
          </button>
        ) : null}
      </div>

      <div className="border-t pb-[env(safe-area-inset-bottom)]">
        {handoff ? (
          <p className="px-4 pt-2.5 text-xs text-muted-foreground">
            {text.handoffPrompt}{" "}
            <a href={handoff.href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2 transition hover:opacity-80">
              {handoff.label}
            </a>
          </p>
        ) : null}

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
              placeholder={configured ? boxPlaceholder : text.offlinePlaceholder}
              disabled={!configured || pending}
              maxLength={maxLength}
              aria-label={text.messageLabel}
              className={`${MESSAGE_BOX_HEIGHT} flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-[0.9375rem]`}
            />
            <button
              type="submit"
              aria-label={text.send}
              disabled={!configured || pending || !input.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
            >
              <SendIcon />
            </button>
          </div>
          {/* The keyboard hint is meaningless on a phone; what we store is not. */}
          <p className={`mt-1.5 px-1 text-[11px] text-muted-foreground ${privacyNote ? "" : "hidden sm:block"}`}>
            <span className={privacyNote ? "hidden sm:inline" : undefined}>{text.inputHint}</span>
            {privacyNote ? (
              <>
                <span aria-hidden className="hidden sm:inline"> · </span>
                <span>{privacyNote}</span>
              </>
            ) : null}
          </p>
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

function RatingButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-full text-muted-foreground/70 transition hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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
const DownIcon = () => (
  <Icon className="size-3.5">
    <path d="M12 5v14M5 12l7 7 7-7" />
  </Icon>
);
const ThumbIcon = ({ down = false }: { down?: boolean }) => (
  <Icon className={down ? "size-3.5 rotate-180" : "size-3.5"}>
    <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
    <path d="M7 10l4.5-7a2.5 2.5 0 0 1 4.3 2.5L14.5 9h4.3a2 2 0 0 1 2 2.4l-1.3 7a2 2 0 0 1-2 1.6H7" />
  </Icon>
);
const ChevronIcon = () => (
  <Icon className="size-4 shrink-0 text-muted-foreground">
    <path d="m9 18 6-6-6-6" />
  </Icon>
);
