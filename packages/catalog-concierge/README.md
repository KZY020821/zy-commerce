# Catalog Concierge

A product-aware chat assistant that answers customer questions from a store's **own catalogue and specifications**, and asks the right follow-up question when a request is vague.

It is not a scripted bot and it is not a general chatbot bolted onto a shop. It reads the catalogue live on every message, looks products up through tools, and every claim it makes is traceable to a record in your data.

```
Customer: "I'm a point guard, which shoes have the best cushioning under $150?"

Concierge: Two good options under $150:
           • Nike G.T. Cut 4 — $110.97. Air Zoom Strobel + ZoomX, a plush,
             low-to-the-ground ride built for quick guards. Runs small.
           • Book 2 — $86.97. Lighter build with Air Zoom + Cushlon.
           What US size do you wear? Availability varies by size.
           [Compare the top two] [Show something cheaper] [Size 10]
```

---

## Why it is different

**It cannot make things up.** The model never sees your catalogue as free text it can paraphrase. It gets tools, calls them, and answers from the rows that come back. No price, spec or stock claim exists that did not come from your data.

**It knows what to ask.** Before answering, it builds a map of the catalogue and works out which specification fields actually *differ* between products in each category. A field that is identical everywhere is useless for narrowing a choice; a field that varies is exactly what a good shop assistant asks about. That is derived from your data, so it works for paddles, shoes, coffee machines or industrial fasteners without a line of configuration.

**Off-topic questions cost nothing.** "What's the weather?" is rejected in plain code before any model call, so it consumes zero tokens. See [The off-topic guard](#the-off-topic-guard).

**New products are understood immediately.** There is no index to rebuild, no embeddings to regenerate, no retraining. A product saved now is answerable on the next message.

**It runs on any OpenAI-compatible model.** DeepSeek, OpenAI, Groq, Together, or a local runtime. The reference deployment uses DeepSeek at roughly **$0.003–0.007 per conversation**.

---

## Installing it

```bash
pnpm add catalog-concierge openai zod        # plus react, for the widget
```

> **Licence.** The package is `private` and the current `LICENSE` grants no
> right to use it: the source is published so clients and employers can read
> it. [`docs/LICENSING.md`](../../docs/LICENSING.md) covers what has to change
> before it can be sold or installed by someone else.

**If your app runs Tailwind**, point it at the package so the widget's classes
are generated, and you are done:

```css
/* app.css, next to your @import "tailwindcss" */
@source "../node_modules/catalog-concierge/src";
```

**If it does not** — or you would rather not scan a dependency — import the
prebuilt stylesheet instead:

```ts
import "catalog-concierge/styles.css";
```

It carries the widget's own classes and nothing else: no reset, no preflight,
nothing that touches an element the widget does not render, so dropping it into
a shop cannot move that shop's own buttons. Colours come from CSS variables
(`--primary`, `--background`, `--muted`, `--border`, `--ring`…), each with a
neutral fallback, so it inherits a shadcn/ui theme where there is one and still
looks deliberate where there is not. Use one path or the other, not both.

### Without React, from a script tag

A shop that is not a React app — Shopify, WooCommerce, WordPress, a hand-written
site — adds one tag:

```html
<script src="https://your.cdn/concierge.js"
        data-concierge
        data-endpoint="https://shop.example/api/assistant"
        data-name="Fit Assistant"
        data-greeting="Hi! Ask me anything about our paddles."
        data-suggestions="Help me choose|What's in stock?"
        data-features="history,feedback,new-chat"
        data-privacy-note="Chats are kept for 90 days."
        data-handoff-href="https://wa.me/60123456789"
        data-handoff-label="Message us on WhatsApp"
        defer></script>
```

The file is `dist/embed.js` (`pnpm --filter catalog-concierge build`), about
220KB — 68KB gzipped — with React, the widget and the stylesheet inside it. It
mounts in a **shadow root**, so the shop's CSS cannot reach in and the widget's
cannot leak out, and it follows the page into dark mode by watching `<html>`
for a `dark` class or `data-theme="dark"`.

The one thing the shop must build is the endpoint — **one route, four things**.
A message streams back as newline-delimited JSON; everything else about a
conversation is a plain JSON answer:

```
POST { "message": "…", "path": "/products/atlas" }
  → {"type":"status","tool":"search_products"}
    {"type":"reply","result":{"ok":true,"answer":"…","suggestions":["…"],"products":[…]}}

POST { "action": "history" }                              → { "messages": [ … ] }
POST { "action": "feedback", "answer": "…", "rating": "up" } → { "ok": true }
POST { "action": "new-chat" }                             → { "ok": true }
```

The last three are why an embedded widget can put the conversation back after
a reload, record what a customer thought of an answer, and start a fresh
thread — the things a same-origin React host gets from its Server Actions.
`data-features="history,feedback"` narrows it to what your endpoint actually
implements, and `data-features="none"` leaves only messages; the widget then
offers nothing it cannot honour, including hiding **New chat**, because
clearing the screen while the assistant remembers is worse than no button.

`askConciergeStream` produces exactly those events; see the reference
implementation in
[`apps/zy-commerce/src/app/api/assistant/route.ts`](../../apps/zy-commerce/src/app/api/assistant/route.ts),
which also shows the two things an embedded endpoint needs that a same-origin
one does not: CORS headers for the origins the shop has listed, and a
`SameSite=None` session cookie, without which the assistant forgets the
conversation between every message.

---

## Integrating it

You implement **two methods**. That is the entire integration surface.

```ts
import { askConcierge, type CatalogAdapter } from "catalog-concierge";

const adapter: CatalogAdapter = {
  // Everything currently purchasable. Called once per customer message.
  async listCatalogue() {
    const rows = await db.product.findMany({ where: { active: true } });
    return rows.map((p) => ({
      ref: p.sku,                 // what the model quotes back
      name: p.name,
      url: `/products/${p.slug}`,
      price: p.priceInCents,      // integer minor units
      brand: p.brand,
      category: { slug: "shoes", name: "Shoes" },
      stockQuantity: p.stock,
      specs: { "Cushioning": "High", "Weight": "9.1 oz" },  // the important bit
      imageUrl: p.image,
    }));
  },

  // Full detail, fetched only when the assistant needs it.
  async getProduct(ref) {
    /* … return the same shape plus `variants` … */
  },
};

const reply = await askConcierge(
  { store: { storeName: "Acme Running", assistantName: "Acme Fit", currency: "USD", locale: "en-US" }, adapter },
  { message: "which shoe suits flat feet?", history: [] },
);
// → { answer, suggestions, products, origin, usage }
```

> **`history` must come from your own storage, never from the browser.** Whatever
> endpoint you put in front of `askConcierge` is public, so a transcript the
> client sends is attacker-controlled. Forged `assistant` turns land in the
> model's context as if the assistant had written them, and the guard's
> "short follow-up" rule below assumes a conversation is genuinely in progress —
> claim a history and off-topic questions start reaching the model. Key the
> thread by an httpOnly cookie or a signed session id, store the turns
> server-side, and replay those. The reference integration does this in
> [`apps/zy-commerce/src/lib/ai/chat-history.ts`](../../apps/zy-commerce/src/lib/ai/chat-history.ts).
>
> As a backstop the loop trims history to the most recent 12 turns and
> `MAX_HISTORY_CHARS` (12,000) characters, so one turn's cost is bounded even
> if a host gets this wrong.

Then render the widget and hand it a transport, usually a Next.js Server Action:

```tsx
import { ConciergeWidget } from "catalog-concierge/react";

<ConciergeWidget
  assistantName="Acme Fit"
  greeting="Hi! Tell me how you run and I'll find the right shoe."
  starterSuggestions={["Help me choose", "Show me trail shoes"]}
  onSend={askAssistantAction}
  onNewChat={startNewChatAction}
/>
```

`onNewChat` runs when the customer taps **New chat**, before the screen clears. If you keep history on the server, as above, use it to start a fresh thread there — the reference app issues a new session cookie. Without it the widget only clears what it shows.

The message box grows with the text to about six lines, then scrolls inside itself, so a long question is always readable at once. Enter sends and Shift+Enter starts a new line; an input method's Enter (choosing a Chinese or Japanese word) never sends. Ctrl/⌘ + Shift + K opens and closes the chat from anywhere on the page — pass `shortcutKey` to change the letter, or `null` to bind nothing.

### Bringing the conversation back

A host that keeps history server-side has the assistant remembering a conversation the customer can no longer see: reload the page and the screen is empty, but "the first one" still resolves. Give the widget a `loadHistory` and it puts the recent turns back, product cards included, under an "earlier" divider.

```tsx
<ConciergeWidget loadHistory={loadChatHistoryAction} … />
```

It is asked for once, when the chat is first opened, and never again after **New chat**. Failures are ignored — the customer can still ask their question. `toProductCard()` is exported so a restored card is built exactly like the one the reply drew.

### Answering questions a catalogue cannot

Customers ask about delivery, returns and opening hours constantly, and no product record contains them. Put the shop's own words in `store.policies` and they become the only non-product facts the assistant may state — quoted as written, never paraphrased or invented.

```ts
await askConcierge({
  store: { …, policies: "Delivery: free over RM 200, 2–4 working days.\nReturns: 14 days, unused." },
  adapter,
}, { message, history });
```

Anything the text does not cover is still "I don't have that detail", followed by an offer to contact the shop. The first `MAX_POLICY_CHARS` (2,000) characters reach the prompt: it is resent on every tool round, so a pasted terms page cannot make a single turn expensive.

Pair it with `handoff`, a way to reach a person, which the widget shows under the conversation:

```tsx
<ConciergeWidget handoff={{ label: "Message us on WhatsApp", href: "https://wa.me/60123456789" }} … />
```

### Saying what it is doing

A turn takes several seconds, nearly all of it inside the tool loop, and three silent dots make that feel broken. `askConciergeStream` is the same turn with its progress reported: it yields one event per tool call and returns the finished reply.

```ts
const turn = askConciergeStream({ store, adapter }, { message, history });
let step = await turn.next();
while (!step.done) {
  send({ type: "status", tool: step.value.name }); // search_products, compare_products…
  step = await turn.next();
}
const reply = step.value;
```

`askConcierge` is this drained to its end, so there is one implementation of a turn and choosing progress reporting cannot change the answer.

Add `streamAnswer: true` and the reply itself arrives as it is written:

```ts
askConciergeStream({ store, adapter, streamAnswer: true }, { message, history });
// → { kind: "tool", name: "search_products" }
//   { kind: "answer", delta: "For tennis elbow, " }
//   { kind: "answer", delta: "a 16mm core " } …
```

Measured against the live model: first words on screen at **0.9 seconds** instead of a blank wait until 5.7. It is off by default because it asserts your client handles `stream: true` — every OpenAI-compatible SDK does; a hand-written test fake need not.

Models think out loud before reaching for a tool ("I'll look that up now"), so an `answer` event can carry `restart: true`: throw away what is on screen and start from this delta. The widget does that for you; a host rendering its own UI should too, or the customer reads the assistant's notes and its answer run together.

On the widget side, `onSendStream` takes over from `onSend` when you pass it, and the customer sees "Searching the catalogue…" then "Comparing products…" instead of dots. If the stream fails before a reply arrives, the widget falls back to `onSend` — a dropped connection should not cost someone their question. The reference app streams NDJSON from a Route Handler; see [`src/app/api/assistant/route.ts`](../../apps/zy-commerce/src/app/api/assistant/route.ts).

### Finding out whether it actually helped

Pass `onFeedback` and every answer carries two small buttons. Nothing is shown without it.

```tsx
<ConciergeWidget onFeedback={rateAnswerAction} … />
// → { answer: "The Atlas suits beginners.", rating: "down" }
```

The answer's text identifies it rather than an index, because what the widget shows after a restore is a window onto the thread rather than the whole of it; the host marks the most recent answer that matches. Recording it is optimistic — the customer sees the thanks immediately — and a rating already given comes back with `loadHistory` as `rating`, so nobody is asked twice.

### Knowing which page the question came from

`askConcierge` takes `viewing`: the reference of the product the customer has open. It has to be a product in the catalogue — anything else is ignored, so a host can pass whatever its page says without trusting it.

```ts
await askConcierge({ store, adapter }, { message, history, viewing: "SLK-ATLAS-MAX" });
```

Two things change. The model is told what "this one" means, and the guard treats a short question as a follow-up about that product — so "is this any good?", asked on a product page, reaches the model instead of being refused for naming nothing.

### Saying it in your customers' language

Every fixed word in the widget comes from `labels`. Pass the ones you want changed; the rest stay in English.

```tsx
<ConciergeWidget
  labels={{ launcher: "Tanya {name}", send: "Hantar", placeholder: "Tanya tentang mana-mana produk…" }}
  privacyNote="Sembang disimpan untuk menambah baik jawapan kedai ini."
  …
/>
```

`DEFAULT_WIDGET_LABELS` is exported, so `{ ...DEFAULT_WIDGET_LABELS, ...yours }` is the full list of keys. The model answers in whatever language the customer writes in; `labels` covers the interface around it.

`privacyNote` is one line under the message box saying what happens to what the customer types. Nothing is shown unless you pass it — only you know what your integration stores.

### On a phone

Below 640px the panel covers the screen, and behaves accordingly: it is a modal dialog, Tab stays inside it, and it resizes to the space the on-screen keyboard leaves so the send button is never under the keyboard. It also keeps clear of the home indicator. On a larger screen it is a 420px panel in the corner that does not trap focus.

Scrolling back through a long answer no longer means missing the next one: new replies stop pulling the view down, and a **Jump to latest** button appears until you are back at the bottom.

The widget has no design-system dependency. It uses Tailwind utility classes and the CSS variables most Tailwind setups already define (`--primary`, `--background`, `--muted`, `--input`, `--ring`), so it inherits your theme automatically.

> **Styling is one line, either way.** With Tailwind, `@source` the package so it generates the widget's classes (in a monorepo, the relative path: `@source "../../../../packages/catalog-concierge/src";`). Without it, `import "catalog-concierge/styles.css"`. Skip both and the widget renders unstyled — most visibly, it loses its fixed positioning and appears in the top-left corner. See **Installing it** above.

### Trying it on your own catalogue

Before anyone pays for this, they should see it answer their own customers'
questions about their own products:

```bash
npx catalog-concierge evaluate products.json --store "Acme" --currency MYR \
  --questions questions.txt --rates 0.28,0.42,0.028
```

`products.json` is an array of the same product shape the adapter returns —
`ref`, `name`, `price` in minor units, and specs. No database, no application,
nothing from the shop's own codebase. It prints what the catalogue can support,
then every question with the answer, the products it put forward, the tools it
used, the tokens and the time:

```
Catalogue: 192 products
  with specifications : 189 (98%), 4.9 on average
  least to say about  : Realistic Pickleball Board Game    no specifications

? which paddle should I buy as a beginner with tennis elbow?
  For tennis elbow, the two things that matter most are core thickness…
  products: SLK-160, SLK-156 · tools: search_products · 8313 tokens · 3776ms · 0.0014

? do you sell shoes?
  REFUSED by the off-topic guard — no model call. If your customers ask this,
  the word they used is not one your catalogue uses: add it with --synonyms…

2 of 4 answered, 2 refused, 0 answered without naming a product.
22459 tokens (14720 from cache), median 1890ms per question, 0.0028 total.
```

`--dry` reports the catalogue without calling a model at all, and `--json`
gives the whole evaluation for a script to read.

**Every refused question is a finding.** The one above is real: that shop's
category is *Footwear*, and its customers say *shoes*. Put their word in
`store.synonyms` (or `--synonyms shoes,sneakers`) and it counts as one of
yours — the same question then answers, with a card.

`assessCatalogue(catalogue)` is the same measurement on its own, for a shop
owner's dashboard.

### Big catalogues, and what a turn costs

`listCatalogue()` runs for every message: one read serves the store map, the
guard and every search, so the assistant can never answer from data older than
the question. That is the right trade up to a few thousand products, and it is
the default.

Past that, opt into a snapshot:

```ts
await askConcierge({ store, adapter, cache: { key: storeId, ttlMs: 60_000 } }, { message, history });

// …and drop it the moment the catalogue changes, so a long window stays safe
invalidateCatalogue(storeId);
```

The key is the store, never shared between tenants — it is the only thing
keeping their catalogues apart — and at most 32 stores are held, coldest
evicted first. The trade is stated plainly: within the window, stock levels and
prices can be that stale.

Every reply carries `usage` (input, output and cached input tokens). Rates are
yours to supply, because they differ per provider and change without notice:

```ts
import { estimateCost, replyUsage } from "catalog-concierge";

// DeepSeek's published rates at the time of writing, as an example only.
const cost = estimateCost(replyUsage(reply), { inputPerMillion: 0.28, outputPerMillion: 0.42, cachedInputPerMillion: 0.028 });
```

Cached input is billed at its own rate and never billed twice. A turn the guard
answered costs nothing, and says so.

### Specifications are what make it good

`specs` is a flat map of strings. The richer it is, the better the assistant performs: it powers the follow-up questions, the comparisons and the spec-value search. A product with no specs is still found and recommended by name and price, it just cannot be compared on detail.

For catalogues where specs live in prose, `extractSpecs()` turns a description into structured fields, and takes the keys already used in your store so it reuses `Core Thickness` rather than inventing `thickness`.

---

## What happens on each message

1. **Read** the catalogue through `listCatalogue()`. One read serves everything below, so the assistant can never answer from stale data.
2. **Map** it: categories, price ranges, brands, and the specification fields that vary. This goes into the system prompt.
3. **Guard**: decide in code whether the message is about this store. If not, return the fixed reply. No model call.
4. **Loop**: the model calls tools until it has what it needs, up to six rounds.
5. **Resolve**: the references it quoted become product cards. When it quotes none — which happens whenever it writes "tap the card below" and forgets the list — the products it opened this turn are used instead, then any reference quoted in the answer, then a product the answer names unambiguously. A reference, a slug or the product's name all resolve.

### The tools it gets

| Tool | Purpose |
| --- | --- |
| `list_categories` | What the store sells, with counts |
| `search_products` | Keywords plus category, price and stock filters. Matches **specification values**, so "16mm" or "Air Zoom" finds the right products |
| `get_product` | Full detail: every spec, every variant with its own price and stock |
| `compare_products` | A specification matrix across two to four products |
| `respond` | Ends the turn with a structured reply: text, quick-reply chips, product references and a reason for each |

Search runs over the in-memory snapshot rather than issuing more queries, so ranking is identical to what the store map saw. A name hit outranks a brand hit, which outranks a specification hit, which outranks a description hit.

Each product reference comes with a short reason — "16mm core, easiest on the arm" — which the widget prints under the product's name, so a card says why it is there instead of only what it costs. The reasons are used only when there is exactly one per product: a list that does not line up would put one product's reason under another's name, so a mismatch shows nothing at all.

---

## The off-topic guard

The requirement was blunt: unrelated questions must not cost anything. So the decision is made in code, before the model.

A message passes if it:

- names something in the catalogue, using a vocabulary built per request from category names, brands, product names and specification values,
- carries a standalone shopping intent such as *cheapest*, *do you ship*, *what size*, *help me choose*, including common Malay equivalents,
- is a greeting, or
- is a short follow-up in an ongoing conversation, or asked with a product page open, since "the first one" carries no keywords.

Chinese, Japanese and Korean are written without spaces between words, so every rule above would miss: they are matched by substring instead, against shopping words, question markers, greetings and their own deny list. A Chinese question reaches the model; *"今天天气怎么样"* ("how's the weather?") does not.

A deny list of clear non-commerce intents wins outright, so *"write me a poem about shoes"* is refused despite naming a product. Prompt-injection attempts such as *"ignore previous instructions"* are caught here too.

It is deliberately biased towards letting borderline questions through: a wrongly blocked customer sees a broken assistant, while a wrongly admitted one costs a fraction of a cent and the system prompt still holds the model to the catalogue.

**Two limits worth knowing before you promise a client "zero cost on off-topic".** The follow-up rule means the guard is strictest on the first message and looser once a thread is running — which is only safe if `history` is server-side, as above. And the vocabulary is built from your own product names, so a catalogue full of common words donates them to the allow-list: Nike's basketball range puts *book*, *cut*, *air* and *court* in scope, and *"how do I book a flight"* reads as on-topic. Both are deliberate trades in favour of not blocking real customers.

```ts
classifyMessage("do you have 16mm paddles?", vocab, { hasHistory: false });
// → { onTopic: true, reason: "catalogue-term" }
classifyMessage("what's the weather?", vocab, { hasHistory: false });
// → { onTopic: false, reason: "blocked-pattern" }
```

---

## Configuration

| Variable | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY` | Model credentials. Any OpenAI-compatible key works. |
| `AI_MODEL` | Defaults to `deepseek-v4-flash`. |
| `AI_BASE_URL` | Defaults to `https://api.deepseek.com`. Point it anywhere OpenAI-compatible. |

Or skip the environment entirely and pass `model: { client, modelId }` to `askConcierge`.

Extended thinking is switched off by default. Measured on the reference deployment it roughly doubled tokens and latency for these short, tool-grounded turns without improving tool-call accuracy.

---

## Design notes

**Why tools and not RAG.** For catalogues from a few hundred to a few thousand products, filtering plus keyword-and-specification matching is accurate, instant and free. There is no vector store to run, no embeddings to keep in sync, and isolation between stores is guaranteed by construction rather than by hoping an index was scoped correctly. Semantic search fits as a sixth tool if a client's catalogue ever needs it.

**Why the adapter is only two methods.** Anything more is a barrier to adoption. Search, ranking, comparison, category counts and product cards are all derived from the snapshot, so a business integrates by describing its products once.

**Scale ceiling.** `listCatalogue()` is called per message. That is comfortable into the low thousands of products. Beyond that, cache the snapshot and refresh it when the catalogue changes; nothing else in the design has to move.

---

## Tests

`pnpm test` runs the suite with no database and no network: the store map, the guard, search and ranking, the tool executor against an in-memory adapter, the model loop against a fake client, and specification parsing.

---

## Status

Working and deployed. Used in production by two storefronts in the `zy-commerce` app in this repository, serving a 192-product pickleball catalogue and a 104-product basketball catalogue from the same code.
