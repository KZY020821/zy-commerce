# ZY Commerce

Multi-tenant product catalog, storefront and order-management platform. One codebase and one deployment host many independent client stores ("tenants"), each on its own subdomain with its own catalog, customers and orders, fully isolated at the data layer.

The build specification lives in [`docs/crm-platform-build-spec.md`](docs/crm-platform-build-spec.md). Decisions taken while implementing it are logged in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Foundation: scaffold, schema, tenant routing, auth, base layouts, isolation test | **Done** |
| 1 | Product & category management, image upload | Next |
| 2 | Public storefront: catalog, search, filters, product page | Planned |
| 3 | Cart & Stripe Checkout, webhook-driven orders | Planned |
| 4 | Order management, tracking timeline, notification emails | Planned |
| 5 | Tenant provisioning UI, settings/branding, deployment docs, E2E | Planned |

## Stack

Next.js 16 (App Router, TypeScript strict, Server Actions) · Prisma 7 + PostgreSQL · Auth.js v5 (credentials) · Zod 4 · Tailwind CSS 4 + shadcn/ui · Vitest 5 · Playwright · Stripe, Resend and Vercel Blob are wired in later phases behind environment variables.

## Local setup

Prerequisites: Node 22+, pnpm 9+, Docker Desktop.

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
src/components/         ui/ (shadcn), auth/, storefront/, admin/, shared/
tests/unit              pure logic (no DB)   tests/integration  tenant isolation (DB)
tests/e2e               Playwright
```

## Deployment (outline — finalised in Phase 5)

- **App:** Vercel. Add the project's environment variables from the table above. `pnpm build` runs `prisma generate` first.
- **Database:** Neon or Supabase Postgres. Run `pnpm db:deploy` against it from CI or a one-off job before the first deploy.
- **DNS:** point the apex and a wildcard (`*.your-domain`) at Vercel and add both as project domains; each tenant is then live at `<slug>.your-domain` as soon as its row exists.
- **Stripe webhook:** register `https://<apex>/api/webhooks/stripe` in the Stripe dashboard and copy the signing secret into `STRIPE_WEBHOOK_SECRET` (Phase 3).

## Provisioning a tenant today

The super-admin UI for creating tenants ships in Phase 5. Until then, insert a `Tenant` row (via `pnpm db:studio` or SQL) with a valid slug (lowercase, 3–63 chars, not reserved — see `RESERVED_SLUGS` in `src/lib/tenant/resolve.ts`) and a `User` with `role = STORE_ADMIN`, `tenantId` set, and a bcrypt password hash. `prisma/seed.ts` shows the exact shape.
