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

Then render the widget and hand it a transport, usually a Next.js Server Action:

```tsx
import { ConciergeWidget } from "catalog-concierge/react";

<ConciergeWidget
  assistantName="Acme Fit"
  greeting="Hi! Tell me how you run and I'll find the right shoe."
  starterSuggestions={["Help me choose", "Show me trail shoes"]}
  onSend={askAssistantAction}
/>
```

The widget has no design-system dependency. It uses Tailwind utility classes and the CSS variables most Tailwind setups already define (`--primary`, `--background`, `--muted`, `--input`, `--ring`), so it inherits your theme automatically.

> **One required step with Tailwind v4.** Tailwind only generates classes it can see, and it does not scan your dependencies. Point it at the package or the widget will render unstyled — most visibly, it will lose its fixed positioning and appear in the top-left corner:
>
> ```css
> /* app.css, next to your @import "tailwindcss" */
> @source "../node_modules/catalog-concierge/src";
> ```
>
> In a monorepo, use the relative path to the package instead, e.g. `@source "../../../../packages/catalog-concierge/src";`.

### Specifications are what make it good

`specs` is a flat map of strings. The richer it is, the better the assistant performs: it powers the follow-up questions, the comparisons and the spec-value search. A product with no specs is still found and recommended by name and price, it just cannot be compared on detail.

For catalogues where specs live in prose, `extractSpecs()` turns a description into structured fields, and takes the keys already used in your store so it reuses `Core Thickness` rather than inventing `thickness`.

---

## What happens on each message

1. **Read** the catalogue through `listCatalogue()`. One read serves everything below, so the assistant can never answer from stale data.
2. **Map** it: categories, price ranges, brands, and the specification fields that vary. This goes into the system prompt.
3. **Guard**: decide in code whether the message is about this store. If not, return the fixed reply. No model call.
4. **Loop**: the model calls tools until it has what it needs, up to six rounds.
5. **Resolve**: the references it quoted become product cards.

### The tools it gets

| Tool | Purpose |
| --- | --- |
| `list_categories` | What the store sells, with counts |
| `search_products` | Keywords plus category, price and stock filters. Matches **specification values**, so "16mm" or "Air Zoom" finds the right products |
| `get_product` | Full detail: every spec, every variant with its own price and stock |
| `compare_products` | A specification matrix across two to four products |
| `respond` | Ends the turn with a structured reply: text, quick-reply chips, product references |

Search runs over the in-memory snapshot rather than issuing more queries, so ranking is identical to what the store map saw. A name hit outranks a brand hit, which outranks a specification hit, which outranks a description hit.

---

## The off-topic guard

The requirement was blunt: unrelated questions must not cost anything. So the decision is made in code, before the model.

A message passes if it:

- names something in the catalogue, using a vocabulary built per request from category names, brands, product names and specification values,
- carries a standalone shopping intent such as *cheapest*, *do you ship*, *what size*, *help me choose*, including common Malay and Chinese equivalents,
- is a greeting, or
- is a short follow-up in an ongoing conversation, since "the first one" carries no keywords.

A deny list of clear non-commerce intents wins outright, so *"write me a poem about shoes"* is refused despite naming a product. Prompt-injection attempts such as *"ignore previous instructions"* are caught here too.

It is deliberately biased towards letting borderline questions through: a wrongly blocked customer sees a broken assistant, while a wrongly admitted one costs a fraction of a cent and the system prompt still holds the model to the catalogue.

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
