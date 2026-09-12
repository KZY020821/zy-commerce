@AGENTS.md

# Monorepo — working notes for coding agents

Two projects, and the distinction matters:

- `packages/catalog-concierge` is **the product**: a reusable, store-agnostic chat assistant. It must never import from the app, know about Prisma or tenants, or depend on a design system. Its only route to product data is the two-method `CatalogAdapter`. Its tests run with no database and no network.
- `apps/zy-commerce` is **the showcase**: a multi-tenant commerce platform that consumes the package. The whole integration is `src/lib/ai/prisma-adapter.ts` plus one Server Action.

Adding a capability to the assistant? It belongs in the package, behind the adapter. Adding a store feature? It belongs in the app.

# ZY Commerce — app-specific notes

Read `docs/crm-platform-build-spec.md` (the spec) and `docs/DECISIONS.md` (what has been decided and why) before changing anything structural. `README.md` explains setup and architecture.

## Non-negotiable rules

- **Tenant isolation first.** Feature code reads and writes through `getTenantDb()` (`src/lib/tenant/current.ts`). Never import `unscopedDb` outside `src/lib/tenant`, `src/lib/auth`, `src/app/(root)/platform`, webhooks, seed and tests.
- **Every new model needs a decision.** Add `tenantId` + `tenant` relation and list it in `TENANT_SCOPED_MODELS` (`src/lib/db/tenant-scope.ts`), or allow-list it in `UNSCOPED_MODELS`. `tests/unit/schema-invariants.test.ts` enforces this.
- **Authorise in every page and every Server Action** with `requireStoreAdmin()` / `assertStoreAdmin()` / `requireSuperAdmin()` — never only in a layout.
- **Validate all input with Zod** at the Server Action / route handler boundary.
- **Order status changes** go through `assertTransition()` in `src/lib/orders/status.ts` and always append an `OrderStatusEvent`.
- **Money is integer minor units**; use `src/lib/money`.
- **Product assistant**: the app supplies a `CatalogAdapter` built on the tenant-scoped Prisma client (`src/lib/ai/prisma-adapter.ts`) and calls `askConcierge`. Never call the model from a client component. Structured product data lives in `Product.specs` / `ProductVariant.attributes` — keep keys Title Case (`normalizeSpecKey`, exported by the package).
- Work phase by phase (spec §12). Commit at the end of each phase.

## Commands

From the repo root: `pnpm up` (starts the demo platform), `pnpm check` (lint, types, and every test that needs no browser), `pnpm test:coverage` (every suite against the coverage floor). Inside `apps/zy-commerce`: `pnpm db:migrate` after schema edits, `pnpm db:seed`, `pnpm test:e2e` (Chromium), `pnpm db:drift`. Inside `packages/catalog-concierge`: `pnpm test` needs nothing running.

## Shipping changes

- **Every change goes through a pull request.** `main` is protected: the check "CI passed" must be green on the commit being merged, and direct pushes are refused for everyone. Vercel builds production from `main` only.
- **New code comes with tests, in the right suite:** `tests/unit` (Node; mock `next-auth`, `next/headers` and the database as the existing files do), `tests/component` (React in jsdom), `tests/integration` (real Postgres — the setup refuses any database whose name does not end in `_test`), `tests/e2e` (Chromium against a production build), `tests/live` (read-only checks of the live site; never write to production).
- **Coverage floors are a ratchet.** They live in each `vitest.config.mts`; raise them when coverage rises, never lower them to get a change through.
- **A schema change ships with its migration in the same pull request.** CI fails on drift between `schema.prisma` and `prisma/migrations`.
- **The seed must stay idempotent.** Every production deploy re-runs it, and CI runs it twice and fails if the second run imports or creates anything.
- **The slug prefix `e2e-` is reserved** for the end-to-end suite's throwaway stores, which it deletes along with their Blob files. It refuses to run against a database that is not local.
- The health check's `SELECT 1` lives in `src/lib/db/health.ts`, so `unscopedDb` still never leaves `src/lib/db`.

Integration tests need the Docker database (`pnpm db:up`). Unit tests do not.

## Conventions

- Next.js 16: `proxy.ts` (not middleware), async `params`/`headers()`, Server Actions for mutations, Route Handlers only for webhooks and Auth.js.
- Prisma 7: schema in `prisma/schema.prisma`, config in `prisma.config.ts`, generated client in `src/generated/prisma` (git-ignored; `pnpm db:generate`).
- shadcn/ui components live in `src/components/ui`; add more with `pnpm dlx shadcn@latest add <name>`.
- Tenant storefront links are root-relative (`/products/x`); the proxy adds the slug internally.
