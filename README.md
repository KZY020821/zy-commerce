# Catalog Concierge · monorepo

**A product-aware chat assistant that businesses can drop into their storefront**, plus a full demo commerce platform built to show it working on real catalogues.

| Package | What it is |
| --- | --- |
| [`packages/catalog-concierge`](packages/catalog-concierge) | **The product.** A chat assistant that answers customer questions from a store's own catalogue and specifications. Any catalogue, any OpenAI-compatible model, two methods to integrate. |
| [`apps/zy-commerce`](apps/zy-commerce) | **The showcase.** A multi-tenant e-commerce platform that hosts two independent demo stores, both served by the assistant above. |

## See it working

| Store | Catalogue | Link |
| --- | --- | --- |
| Selkirk Demo | 192 pickleball products, MYR | https://zy-commerce-demo.vercel.app |
| Nike Demo | 104 basketball products, USD | https://zy-commerce-nike.vercel.app |

Both run the **same assistant code** against completely different catalogues, currencies and product types. That is the point: nothing about it is specific to one industry.

> Both stores are **demonstrations**, not shops. Nothing on them is for sale and no order can be placed. They are built from publicly available catalogue data and are not affiliated with, endorsed by, or connected to the brands shown; product names, images and specifications remain the property of their owners. Neither store is search-indexed.

Try asking either store something real, such as *"I'm a beginner, what should I get under 400?"*, then try something unrelated like *"what's the weather?"* — the second is refused in code before any model call, so it costs nothing.

## Why this exists

Most shop chatbots either recite a scripted FAQ or hallucinate product details. This one:

- reads the live catalogue on every message, so a product added a minute ago is answerable,
- looks products up through tools, so every price and specification it quotes is traceable to a record,
- works out which specification fields actually differ between products, so it asks the follow-up question a good shop assistant would ask,
- and refuses off-topic questions for free.

Full design notes and integration guide: **[packages/catalog-concierge/README.md](packages/catalog-concierge/README.md)**.

## Working on it

```bash
pnpm install
pnpm up            # starts the demo platform: Postgres in Docker, migrations, seed, dev server
pnpm check         # lint + typecheck + unit + integration across both projects
```

| Command | Scope |
| --- | --- |
| `pnpm test` | Every workspace |
| `pnpm --filter catalog-concierge test` | The assistant only — no database, no network |
| `pnpm --filter zy-commerce test:integration` | Tenant isolation and the catalogue adapter, needs Docker |

Decisions taken along the way are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md); the original build specification for the commerce app is in [`docs/`](docs).

## Licence

Source-available, not open source. Read it, clone it, run it locally to evaluate it — commercial use needs a licence. See [`LICENSE`](LICENSE). If you want the assistant in your own store, that is the thing I do; get in touch.
