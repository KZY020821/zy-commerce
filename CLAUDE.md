@AGENTS.md

# ZY Commerce — working notes for coding agents

Read `docs/crm-platform-build-spec.md` (the spec) and `docs/DECISIONS.md` (what has been decided and why) before changing anything structural. `README.md` explains setup and architecture.

## Non-negotiable rules

- **Tenant isolation first.** Feature code reads and writes through `getTenantDb()` (`src/lib/tenant/current.ts`). Never import `unscopedDb` outside `src/lib/tenant`, `src/lib/auth`, `src/app/(root)/platform`, webhooks, seed and tests.
- **Every new model needs a decision.** Add `tenantId` + `tenant` relation and list it in `TENANT_SCOPED_MODELS` (`src/lib/db/tenant-scope.ts`), or allow-list it in `UNSCOPED_MODELS`. `tests/unit/schema-invariants.test.ts` enforces this.
- **Authorise in every page and every Server Action** with `requireStoreAdmin()` / `assertStoreAdmin()` / `requireSuperAdmin()` — never only in a layout.
- **Validate all input with Zod** at the Server Action / route handler boundary.
- **Order status changes** go through `assertTransition()` in `src/lib/orders/status.ts` and always append an `OrderStatusEvent`.
- **Money is integer minor units**; use `src/lib/money`.
- **Product assistant** (`src/lib/ai`): tools must use the tenant-scoped client passed in `ToolContext`; the model must finish with the `respond` tool; never call the model from client components. Model client via `getAiClient()` only. Structured product data lives in `Product.specs` / `ProductVariant.attributes` — keep keys Title Case (`normalizeSpecKey`).
- Work phase by phase (spec §12). Commit at the end of each phase.

## Commands

`pnpm dev` · `pnpm check` (lint + typecheck + unit + integration) · `pnpm db:migrate` after schema edits · `pnpm db:seed`.

Integration tests need the Docker database (`pnpm db:up`). Unit tests do not.

## Conventions

- Next.js 16: `proxy.ts` (not middleware), async `params`/`headers()`, Server Actions for mutations, Route Handlers only for webhooks and Auth.js.
- Prisma 7: schema in `prisma/schema.prisma`, config in `prisma.config.ts`, generated client in `src/generated/prisma` (git-ignored; `pnpm db:generate`).
- shadcn/ui components live in `src/components/ui`; add more with `pnpm dlx shadcn@latest add <name>`.
- Tenant storefront links are root-relative (`/products/x`); the proxy adds the slug internally.
