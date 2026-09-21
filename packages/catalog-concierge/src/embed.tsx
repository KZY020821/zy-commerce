/**
 * The `<script>` embed: the widget on a site that has never heard of React.
 *
 *   <script src="https://your.cdn/concierge.js"
 *           data-concierge
 *           data-endpoint="https://shop.example/api/assistant"
 *           data-name="Fit Assistant"
 *           data-greeting="Hi! Ask me anything about our products."
 *           data-suggestions="Help me choose|What's in stock?"
 *           defer></script>
 *
 * Everything it needs is on that tag. React, the widget and its stylesheet are
 * bundled into the one file, and it mounts inside a shadow root so the shop's
 * CSS cannot reach in and the widget's cannot leak out.
 *
 * The only thing the shop must build is the endpoint: a POST that takes
 * `{ message, path }` and answers in newline-delimited JSON. See the README
 * and `src/transport.ts` for the wire format.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { askEndpoint, askEndpointStream } from "./transport";
import { ConciergeWidget, type ConciergeWidgetProps } from "./ui/widget";

/** Replaced at build time with the contents of `dist/styles.css`. */
declare const __CONCIERGE_CSS__: string;

const ROOT_ATTRIBUTE = "data-concierge-root";
const SCRIPT_SELECTOR = "script[data-concierge]";

export interface EmbedConfig {
  endpoint: string;
  assistantName: string;
  greeting: string;
  starterSuggestions: string[];
  privacyNote?: string;
  handoff?: { label: string; href: string };
  placeholder?: string;
  shortcutKey?: string | null;
  labels?: ConciergeWidgetProps["labels"];
}

/** The script tag that loaded this file, or one that marked itself. */
function ownScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement) return current;
  return document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
}

/** Reads the configuration a shop wrote on the tag. Endpoint is the only must. */
export function readConfig(script: HTMLScriptElement | null): EmbedConfig | null {
  const data = script?.dataset ?? {};
  const endpoint = data.endpoint?.trim();
  if (!endpoint) return null;

  const name = data.name?.trim() || "Assistant";
  return {
    endpoint,
    assistantName: name,
    greeting: data.greeting?.trim() || `Hi! Ask me anything about our products and I'll answer from what we sell.`,
    starterSuggestions: (data.suggestions ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    ...(data.privacyNote?.trim() ? { privacyNote: data.privacyNote.trim() } : {}),
    ...(data.handoffHref?.trim() ? { handoff: { href: data.handoffHref.trim(), label: data.handoffLabel?.trim() || "Message the shop" } } : {}),
    ...(data.placeholder?.trim() ? { placeholder: data.placeholder.trim() } : {}),
    ...(data.shortcutKey !== undefined ? { shortcutKey: data.shortcutKey.trim() || null } : {}),
    ...(data.labels ? { labels: safeLabels(data.labels) } : {}),
  };
}

/** `data-labels` is JSON a shop typed by hand; a typo must not cost them the widget. */
function safeLabels(raw: string): ConciergeWidgetProps["labels"] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ConciergeWidgetProps["labels"]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Follows the page's own light/dark choice.
 *
 * Inside a shadow root a `.dark` ancestor on <html> is out of reach, so the
 * class is mirrored onto the widget's own wrapper and kept in step with the
 * page. A site with no theme at all still gets the operating system's setting,
 * which the stylesheet handles on its own.
 */
function followPageTheme(target: HTMLElement): () => void {
  const root = document.documentElement;
  const sync = () => {
    const dark = root.classList.contains("dark") || root.dataset.theme === "dark";
    target.classList.toggle("dark", dark);
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
  return () => observer.disconnect();
}

/**
 * Registers the stylesheet's custom properties on the page itself.
 *
 * `@property` only takes effect from the document: the browser ignores those
 * rules inside a shadow root, and without them the widget loses its border and
 * its shadow — the two things that make it look like a panel rather than a
 * rectangle of text. Only the registrations are added to the page, never a
 * selector, so nothing of the shop's can be restyled by them.
 */
function registerCustomProperties(css: string): void {
  if (document.querySelector("style[data-concierge-properties]")) return;
  const rules = css.match(/@property[^{]+\{[^}]*\}/g);
  if (!rules?.length) return;

  const style = document.createElement("style");
  style.dataset.conciergeProperties = "";
  style.textContent = rules.join("");
  document.head.append(style);
}

/** The stylesheet the bundle was built with. Empty outside a build, e.g. in tests. */
function bundledCss(): string {
  return typeof __CONCIERGE_CSS__ === "string" ? __CONCIERGE_CSS__ : "";
}

/**
 * Mounts the widget into its own shadow root at the end of the page.
 *
 * `css` is the stylesheet to put inside that shadow root; it defaults to the
 * one bundled into this file, and is a parameter so a host can supply its own
 * and so tests can supply something smaller.
 */
export function mount(config: EmbedConfig, options: { container?: HTMLElement; css?: string } = {}): ShadowRoot {
  const host = document.createElement("div");
  host.setAttribute(ROOT_ATTRIBUTE, "");
  (options.container ?? document.body).appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  const css = options.css ?? bundledCss();
  style.textContent = css;
  registerCustomProperties(css);
  const mountPoint = document.createElement("div");
  shadow.append(style, mountPoint);
  followPageTheme(mountPoint);

  createRoot(mountPoint).render(
    createElement(ConciergeWidget, {
      assistantName: config.assistantName,
      greeting: config.greeting,
      starterSuggestions: config.starterSuggestions,
      privacyNote: config.privacyNote,
      handoff: config.handoff,
      placeholder: config.placeholder,
      labels: config.labels,
      ...(config.shortcutKey !== undefined ? { shortcutKey: config.shortcutKey } : {}),
      // The page the question was asked from, which is how the assistant knows
      // what "this one" means on a product page.
      // `include` so the endpoint's session cookie survives between messages
      // on someone else's site; without it the assistant forgets every turn.
      onSendStream: (input) => askEndpointStream(config.endpoint, { message: input.message, path: location.pathname }, { credentials: "include" }),
      onSend: (input) => askEndpoint(config.endpoint, { message: input.message, path: location.pathname }, { credentials: "include" }),
    }),
  );

  return shadow;
}

/** Mounts from the script tag's own attributes. Exported for tests and for hosts that call it themselves. */
export function start(): ShadowRoot | null {
  if (typeof document === "undefined") return null;
  if (document.querySelector(`[${ROOT_ATTRIBUTE}]`)) return null; // already on the page
  const config = readConfig(ownScript());
  return config ? mount(config) : null;
}

start();
