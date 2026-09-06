# ZY Commerce

Multi-tenant product catalog, storefront and order-management platform. One codebase and one deployment host many independent client stores ("tenants"), each on its own subdomain with its own catalog, customers and orders, fully isolated at the data layer.

The build specification lives in [`docs/crm-platform-build-spec.md`](docs/crm-platform-build-spec.md). Decisions taken while implementing it are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Live

| What | URL |
| --- | --- |
| Platform (landing + super admin) | https://zy-commerce.vercel.app · https://zy-commerce.vercel.app/platform/login |
| Demo store ("Selkirk Demo", full Selkirk Sport catalogue) | https://zy-commerce-demo.vercel.app |
| Demo store admin | https://zy-commerce-demo.vercel.app/admin/login |

Hosted on Vercel (team `kzy02`, project `zy-commerce`, functions in Singapore) with a Supabase Postgres (`zy-commerce-db`, Singapore) provisioned through the Vercel Marketplace. Every push to `main` deploys production; the build applies migrations and runs the idempotent seed. Additional tenants on `*.vercel.app` need an alias domain added to the project and listed in `TENANT_HOST_ALIASES`; with a custom domain, wildcard subdomains work automatically.

## Product assistant

Every storefront ships with a chat assistant (bottom-right) that answers customer questions from the **structured specifications** of the products in that store and, when a request is vague, asks one focused follow-up question at a time — the way a good in-store fitter would. It is product-type agnostic: it reads a per-store *catalogue profile* (categories, price ranges, and the spec attributes that actually differ between products) and uses tools to search, fetch and compare products, so it works for paddles today and for coffee machines or furniture tomorrow. Products added later are understood automatically; `src/lib/ai/extract-specs.ts` turns a free-text description into structured specs for products that arrive without any.

- Engine: [DeepSeek](https://platform.deepseek.com) via its OpenAI-compatible API and the official `openai` SDK (`src/lib/ai/assistant.ts`), tool loop over `search_products`, `get_product`, `compare_products`, `list_categories`, ending in a structured `respond` call that carries the answer, quick-reply suggestions and the product cards to show.
- Credentials: set `DEEPSEEK_API_KEY` to your own [DeepSeek API key](https://platform.deepseek.com/api_keys). No Vercel AI Gateway, no Anthropic billing, no card on file required — usage is billed directly to whoever's key it is, at DeepSeek's own rates. Without a key the widget shows an "offline" state and the rest of the store works normally.
- Model: `deepseek-v4-flash` by default (cheapest current model with tool calling and JSON mode); override with `AI_MODEL=deepseek-v4-pro` for higher-quality, pricier answers.
- Guard rails: tenant-scoped queries only, rate-limited per IP and session, every conversation logged under Admin → Conversations.
- Per-store settings on `Tenant`: `assistantEnabled`, `assistantName`, `assistantGreeting`.

## Importing a catalogue

`scripts/import-shopify-catalog.ts` pulls any Shopify store's public catalogue (names, options, variants, prices, images, and the specification block from each product page) into a seed file the platform loads for a tenant. The demo uses Selkirk Sport:

```bash
pnpm tsx scripts/import-shopify-catalog.ts --store www.selkirk.com --currency MYR
```

The seed applies it idempotently (a fingerprint on the tenant skips unchanged files). Descriptions are generated from extracted facts; images link to the source CDN. For a paying client, replace it with their own product data and media.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundation: scaffold, schema, tenant routing, auth, base layouts, isolation test | **Done** |
| — | Catalogue importer, product assistant (chatbot), storefront catalogue preview, admin conversations | **Done** |
| 1 | Product & category management, image upload | Next |
| 2 | Public storefront: cart-ready catalogue, filters (grid, search and product pages already live) | Planned |
| 3 | Cart & Stripe Checkout, webhook-driven orders | Planned |
| 4 | Order management, tracking timeline, notification emails | Planned |
| 5 | Tenant provisioning UI, settings/branding, deployment docs, E2E | Planned |

## Stack

Next.js 16 (App Router, TypeScript strict, Server Actions) · Prisma 7 + PostgreSQL · Auth.js v5 (credentials) · Zod 4 · Tailwind CSS 4 + shadcn/ui · Vitest 5 · Playwright · Stripe, Resend and Vercel Blob are wired in later phases behind environment variables.

## Local setup

Prerequisites: Node 22+, pnpm 9+, Docker Desktop (open it once so the daemon is running).

**Quick start — one command:**

```bash
pnpm up
```

This creates `.env` if missing (generating `AUTH_SECRET` and the seed passwords), starts Postgres in Docker, applies migrations, seeds the super admin and demo tenant, and runs the dev server. Re-run it any time; every step is idempotent. `pnpm down` stops the database. Your local login passwords are the `SEED_*_PASSWORD` values in `.env`.

**Step by step (same thing, manually):**

```bash
pnpm install                 # also runs `prisma generate`
cp .env.example .env         # then set AUTH_SECRET (see below)
openssl rand -base64 32      # paste into AUTH_SECRET in .env
pnpm db:up                   # Postgres 17 in Docker (creates zy_commerce + zy_commerce_test)
pnpm db:migrate              # apply migrations to zy_commerce
pnpm db:seed                 # super admin + "demo" tenant; prints generated passwords once
pnpm dev
```

Then open:

| URL | What |
| --- | --- |
| http://localhost:3000/ | Platform landing page |
| http://localhost:3000/platform/login | Super-admin login (tenant list) |
| http://demo.localhost:3000/ | Demo tenant storefront |
| http://demo.localhost:3000/admin/login | Demo tenant store-admin login |

Chrome, Firefox and Edge resolve `*.localhost` to 127.0.0.1 without configuration. Safari does not: add `127.0.0.1 demo.localhost` to `/etc/hosts` or use another browser.

To set seed passwords explicitly instead of accepting generated ones, fill in `SEED_SUPER_ADMIN_PASSWORD` and `SEED_DEMO_ADMIN_PASSWORD` in `.env` before running `pnpm db:seed`. The seed never overwrites existing accounts.

## Environment variables

Every variable is documented in [`.env.example`](.env.example). Summary:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | Auth.js JWT signing secret (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | yes | Must be `true`; tenants are served from many hosts |
| `NEXT_PUBLIC_ROOT_DOMAIN` | yes | `localhost:3000` locally, your apex domain in production |
| `SEED_*` | seed only | Super-admin / demo-tenant credentials and locale settings |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Phase 3 | Stripe Checkout + webhooks |
| `RESEND_API_KEY`, `EMAIL_FROM` | Phase 4 | Transactional email |
| `BLOB_READ_WRITE_TOKEN` | Phase 1 | Product image storage |

`.env` is git-ignored. `.env.test` is committed on purpose: it only points at the local test database and carries a dummy secret.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server / production build / serve build |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` (alias `test:unit`) | Vitest unit tests, no database needed |
| `pnpm test:integration` | Migrates `zy_commerce_test` then runs the tenant-isolation suite |
| `pnpm test:e2e` | Playwright against the dev server (run `pnpm exec playwright install chromium` once) |
| `pnpm check` | lint + typecheck + unit + integration |
| `pnpm db:up` / `db:down` | Start / stop the Docker database |
| `pnpm db:migrate` | Create & apply a migration in development |
| `pnpm db:deploy` | Apply pending migrations (production / CI) |
| `pnpm db:seed` / `db:studio` / `db:reset` | Seed / Prisma Studio / drop and recreate the dev database |

## Architecture

### Multi-tenancy

Shared database, shared schema, `tenantId` on every tenant-scoped table (spec §4). Isolation is enforced in one place, not per query:

1. **Routing** — [`src/proxy.ts`](src/proxy.ts) reads the `Host` header. `acme.<ROOT_DOMAIN>/path` is rewritten to `/acme/path`, served by `src/app/[tenant]/…`. The apex (and `www.`) serve `src/app/(root)/…`. The browser never sees the slug segment; [`src/app/[tenant]/layout.tsx`](src/app/[tenant]/layout.tsx) re-derives the slug from the host and 404s if the URL segment disagrees, so `<root>/acme/…` is not a back door.
2. **Data access** — [`src/lib/db/tenant-client.ts`](src/lib/db/tenant-client.ts) wraps Prisma in a client extension. For every operation on every tenant-scoped model it appends `AND: [{ tenantId }]` to `where` and forces `tenantId` on `create`/`createMany`/`upsert`. The `Tenant` model is pinned to the current tenant and cannot be created or deleted through it. Feature code gets this client from `getTenantDb()` in [`src/lib/tenant/current.ts`](src/lib/tenant/current.ts). The unscoped client (`src/lib/db/prisma.ts`) is reserved for tenant resolution, auth, super-admin screens, webhooks, seed and tests.
3. **Guard rails** — `tests/unit/schema-invariants.test.ts` parses `schema.prisma` and fails if a model is added without `tenantId` and without being allow-listed. `tests/integration/tenant-isolation.test.ts` creates two tenants with a row in every table and proves that a client scoped to one can never read, update, delete or create rows for the other through any Prisma operation, including search, unique lookups, includes, aggregates, transactions and upserts.

Known limits, by design: nested relation writes are not rewritten (the NOT NULL `tenantId` column makes the caller supply it explicitly, so the failure is loud, never a leak), and raw SQL bypasses extensions (keep it in the unscoped client with an explicit filter). Postgres Row Level Security is a v2 defence-in-depth option.

### Roles and auth

| Role | Lives on | Logs in at | Guard |
| --- | --- | --- | --- |
| `SUPER_ADMIN` (tenantId NULL) | apex domain | `/platform/login` | `requireSuperAdmin()` |
| `STORE_ADMIN` | its tenant's subdomain | `/admin/login` | `requireStoreAdmin()` |
| `CUSTOMER` | its tenant's subdomain | Phase 4 | `getCustomerUser()` |

Auth.js issues JWT session cookies that are host-only, so a session on one subdomain is invisible on any other. `authorize` resolves the tenant from the request host, so credentials can only match that tenant's users. Passwords are bcrypt (cost 12). Login is rate-limited per IP and per IP+email inside `authorize`, which also covers the built-in Auth.js endpoint. Guards in [`src/lib/auth/guards.ts`](src/lib/auth/guards.ts) re-read the user from the database on every request, so role or tenant changes take effect immediately; they are called in every admin page and Server Action, never only in layouts.

### Money and settings

All amounts are integers in the currency's minor unit; tax rates are basis points. Each tenant has one currency, country and locale, a flat shipping rate and a tax rate (spec §7.7). Pure helpers in [`src/lib/money`](src/lib/money/index.ts) compute totals; the order status state machine is in [`src/lib/orders/status.ts`](src/lib/orders/status.ts).

## Project layout

```
prisma/                 schema, migrations, seed
src/app/(root)/         apex domain: landing + /platform super-admin
src/app/[tenant]/       tenant subdomains: (storefront) + /admin
src/app/api/auth/       Auth.js route handler
src/proxy.ts            subdomain → tenant rewrite
src/lib/db/             unscoped client, tenant-scoped client, scoping rules
src/lib/tenant/         host → slug resolution, request context, branding
src/lib/auth/           Auth.js config, guards, actions, password, rate limit
src/lib/orders/         status state machine
src/lib/money/          integer money helpers
src/lib/ai/             product assistant: client, catalogue profile, tools, agent loop, spec extraction
src/lib/catalog/        stock status, spec parsing
scripts/                dev-up, vercel-build, import-shopify-catalog
prisma/seed-data/       imported catalogues (selkirk.json)
src/components/         ui/ (shadcn), auth/, storefront/, admin/, shared/
tests/unit              pure logic (no DB)   tests/integration  tenant isolation (DB)
tests/e2e               Playwright
```

## Deployment (Vercel + Supabase)

Production runs on Vercel with a Supabase Postgres. Pushing to `main` deploys production; every production build runs [`scripts/vercel-build.sh`](scripts/vercel-build.sh): `prisma generate` → `prisma migrate deploy` → `prisma db seed` (idempotent) → `next build`. Preview deployments only build, so a branch can never migrate the live database.

### One-time setup

1. **Sign in to Vercel from this machine** so the CLI can act for you:
   ```bash
   npx vercel login
   ```
2. **Create / link the Vercel project** (GitHub repo `KZY020821/zy-commerce`):
   ```bash
   npx vercel link
   ```
   or import the repository from the Vercel dashboard. Connecting the Git repo makes every push to `main` a production deploy.
3. **Add Supabase** — Vercel dashboard → your project → *Storage* → *Create Database* → **Supabase** (Marketplace, free plan) → connect to all environments. This injects `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` and friends; the app reads them directly.
   *Manual alternative:* create a project at supabase.com and set `DATABASE_URL` to the **Transaction pooler** URL (port 6543, append `?pgbouncer=true`) and `DIRECT_URL` to the **Session pooler** URL (port 5432).
4. **Environment variables** (Project → Settings → Environment Variables, all environments):

   | Variable | Value |
   | --- | --- |
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `AUTH_TRUST_HOST` | `true` |
   | `NEXT_PUBLIC_ROOT_DOMAIN` | `<project>.vercel.app` until you have a custom domain |
   | `TENANT_HOST_ALIASES` | `demo=<project>-demo.vercel.app` (see below) |
   | `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | your platform login; the seed creates it on the first production build |
   | `SEED_DEMO_TENANT` / `SEED_DEMO_ADMIN_EMAIL` / `SEED_DEMO_ADMIN_PASSWORD` | `true` plus the demo store admin login |

   Do **not** set `NODE_ENV`; Vercel manages it, and the build needs dev dependencies.
5. **Tenant hostnames.** `*.vercel.app` cannot nest subdomains, so a tenant is served from an alias domain instead: add `<project>-demo.vercel.app` under Project → Settings → Domains and list it in `TENANT_HOST_ALIASES`. With a custom domain, add the apex and `*.yourdomain.com` as project domains (wildcards need Vercel nameservers), set `NEXT_PUBLIC_ROOT_DOMAIN=yourdomain.com`, and every tenant is live at `<slug>.yourdomain.com` automatically.
6. **Deploy**: `git push`, or `npx vercel --prod`.
7. **Stripe webhook** (Phase 3): register `https://<root>/api/webhooks/stripe` in the Stripe dashboard and set `STRIPE_WEBHOOK_SECRET`.

## Provisioning a tenant today

The super-admin UI for creating tenants ships in Phase 5. Until then, insert a `Tenant` row (via `pnpm db:studio` or SQL) with a valid slug (lowercase, 3–63 chars, not reserved — see `RESERVED_SLUGS` in `src/lib/tenant/resolve.ts`) and a `User` with `role = STORE_ADMIN`, `tenantId` set, and a bcrypt password hash. `prisma/seed.ts` shows the exact shape.
