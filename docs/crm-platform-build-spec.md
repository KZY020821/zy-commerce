# [PROJECT_NAME] — Multi-Tenant Product Catalog & Order Management Platform

**Build specification for an AI coding agent (Claude Code).**
Read this entire document before writing any code. Where a decision is marked `[DECIDE]`, propose your recommended approach and proceed — don't block on it unless it materially changes the data model. Where something is marked `[ASK]`, stop and ask the human before proceeding.

---

## 1. What this is

A **multi-tenant, resellable e-commerce and order-management platform**, built as a reusable template. A single codebase and deployment will host multiple independent client stores ("tenants"). Each tenant has their own product catalog (with SKU-level inventory), their own customers, and their own order pipeline — fully isolated from every other tenant. The end goal is a codebase that can be customized (branding, minor feature toggles) and deployed for a new freelance client in hours, not weeks.

This is **not** a traditional sales-pipeline CRM (leads/deals/contacts). It is a product catalog + storefront + order tracking system. Do not add lead/deal/pipeline features unless explicitly asked.

---

## 2. Goals and non-goals

### Goals (v1 scope)
- Tenant admins can upload and manage products, each with a unique SKU, price, stock quantity, category, and images.
- Customers can browse a tenant's storefront, search/filter products, add to cart, and check out.
- Orders are created, payment is captured, and the order enters a trackable status pipeline.
- Customers can view their order history and current status/tracking for each order.
- Tenant admins can view and manage all orders for their store, updating status as fulfillment progresses.
- The whole system is multi-tenant from the data layer up — this is a hard architectural requirement, not a nice-to-have.
- Codebase is clean and documented enough that a new tenant can be provisioned and reskinned quickly.

### Explicit non-goals for v1 (do not build these unless asked)
- Lead/deal/sales-pipeline CRM features.
- Marketing automation, email campaigns, abandoned-cart sequences.
- Advanced analytics/BI dashboards (basic order/revenue counts are fine; nothing beyond that).
- Subscription billing / recurring orders.
- Multi-currency support (single currency per tenant is fine for v1).
- Native mobile apps.
- In-person/POS sales.
- Custom domain support (subdomain-based tenant routing is sufficient for v1; note it as a future extension point, don't build it).

---

## 3. Tech stack (fixed — do not substitute without asking)

| Layer | Choice |
|---|---|
| Framework | Next.js 15+, App Router, TypeScript (strict mode) |
| Data mutations/fetching | Server Actions + Server Components as the default; Route Handlers only where required (webhooks, anything needing a raw HTTP endpoint) |
| ORM | Prisma |
| Database | PostgreSQL (target a hosted provider such as Neon or Supabase; must also run via local Docker for development) |
| Auth | Auth.js (NextAuth v5) — credentials provider at minimum; OAuth optional stretch |
| Payments | Stripe (Checkout Sessions + webhooks) |
| Validation | Zod, with schemas shared between client and server where practical |
| Styling/UI | Tailwind CSS + shadcn/ui |
| Image/file storage | Vercel Blob (or an S3-compatible bucket if self-hosting) |
| Email | Resend (or an equivalent transactional email API) for order notifications |
| Testing | Vitest for unit/integration tests, Playwright for end-to-end |
| Deployment target | Vercel for the app; managed Postgres for the database |

`[ASK]` if any of these are unavailable or restricted in the target environment (e.g., no Stripe account, no Vercel access) — do not silently swap in an alternative.

---

## 4. Multi-tenancy architecture — read this section carefully

This is the single most important architectural constraint in this build. Get it wrong and the whole product is unsellable.

- **Strategy:** shared database, shared schema, tenant isolation via a `tenantId` column on every tenant-scoped table. Do not use schema-per-tenant or database-per-tenant for v1 — it doesn't scale operationally for a reseller with many small clients.
- **Hard invariant:** every query that touches tenant-scoped data must be filtered by `tenantId`. This must be enforced at the data-access layer (a shared query/repository helper), not left to individual route handlers to remember. `[DECIDE]` the exact mechanism — a Prisma middleware/extension that injects the tenant filter automatically is preferred over manual filtering in every query, since manual filtering will eventually be forgotten somewhere and leak data across tenants.
- **Tenant resolution:** subdomain-based routing — `{tenant-slug}.yourplatform.com` resolves to that tenant's storefront. Middleware resolves the tenant from the subdomain and makes it available throughout the request (e.g., via headers or a request-scoped context) before any data access happens.
- **Provisioning:** a new tenant is created via an internal/admin-only flow (not public self-signup for v1) — a platform super-admin creates the tenant record, an initial store-admin user, and the tenant is immediately live at its subdomain.
- **Testing requirement:** write an explicit integration test that proves tenant isolation — create two tenants with products/orders, and assert that a query scoped to tenant A never returns tenant B's rows under any code path (including admin list views, search, and order lookups). This test is not optional.

---

## 5. Roles and auth

Three role tiers:

1. **Platform Super Admin** — not tied to a tenant; can create/suspend tenants. One or a small handful of these accounts; you (the platform owner) hold this role.
2. **Store Admin / Staff** — belongs to exactly one tenant; manages that tenant's products, categories, and orders. (Staff and Admin can be a single role for v1; split into permission levels later if needed.)
3. **Customer** — belongs to exactly one tenant (a customer of Tenant A is a distinct account from the "same person" being a customer of Tenant B, even if they share an email — `[DECIDE]` whether to allow a shared login across tenants or keep accounts fully separate per tenant; separate-per-tenant is simpler and safer for v1).

Guest checkout (no account required to place an order) should be supported — capture a customer record from the checkout email/address even without a password, and optionally prompt to "create an account to track this order" after purchase.

Auth requirements:
- Passwords hashed via Auth.js's standard mechanism (bcrypt/argon2 under the hood).
- Server Actions are the primary mutation path, which gives CSRF protection by default via Next.js — confirm this is correctly configured, don't assume.
- Rate-limit login and account-creation endpoints.
- Every role check happens server-side. Never rely on hiding a UI element as the only access control.

---

## 6. Data model (core entities)

Design the Prisma schema around these entities. Field lists below are the minimum required fields — add supporting fields (timestamps, soft-delete flags, etc.) as good practice, but don't gold-plate beyond what's needed for v1.

- **Tenant** — id, name, slug (unique, used for subdomain), status (active/suspended), createdAt.
- **User** — id, tenantId (nullable only for Super Admin), email, passwordHash, role (SUPER_ADMIN / STORE_ADMIN), createdAt.
- **Customer** — id, tenantId, email, name, phone (optional), linked userId (nullable — supports guest customers), createdAt.
- **Address** — id, customerId, type (shipping/billing), line1, line2, city, state, postalCode, country.
- **Category** — id, tenantId, name, slug, parentCategoryId (nullable, supports nesting).
- **Product** — id, tenantId, name, description, sku (unique per tenant), price, currency, categoryId, active (boolean), createdAt.
- **ProductImage** — id, productId, url, sortOrder.
- **ProductVariant** *(if variants are needed — otherwise treat SKU/stock at the Product level)* — id, productId, sku, attributes (JSON — e.g. size/color), priceOverride (nullable), stockQuantity.
- **InventoryLevel** — either folded into Product/ProductVariant as a `stockQuantity` field, or a separate table if you anticipate multi-location inventory later. Default to a simple `stockQuantity` field on Product/Variant for v1.
- **Cart** — id, tenantId, customerId (nullable for guest/session-based carts), sessionToken (for guests), createdAt.
- **CartItem** — id, cartId, productId/variantId, quantity, priceAtAdd.
- **Order** — id, tenantId, customerId, status (see status enum below), subtotal, shippingCost, tax, total, currency, shippingAddressId, createdAt.
- **OrderItem** — id, orderId, productId/variantId, skuSnapshot (capture the SKU/name/price at time of purchase — never rely on a live join back to Product for historical orders), quantity, unitPrice.
- **OrderStatusEvent** — id, orderId, status, note (optional), createdAt. This is the append-only log that powers the customer-facing tracking timeline — do not just overwrite a single `status` field on Order without also logging the transition here.
- **Payment** — id, orderId, stripePaymentIntentId, status, amount, createdAt.

### Order status enum (use this exact set unless there's a strong reason to deviate — flag it if so)
`PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED`, with `CANCELLED` and `REFUNDED` as terminal states reachable from most points before `DELIVERED`.

---

## 7. Feature requirements, by area

### 7.1 Product & SKU management (Store Admin)
- Create/edit/deactivate products: name, description, SKU (validate uniqueness per tenant), price, category, stock quantity, one or more images.
- Category management: create/edit categories, optionally nested.
- Product list view with search and filter (by category, active status, low stock).
- `[DECIDE]` whether CSV bulk-upload for products is in v1 scope or a fast-follow — recommend fast-follow unless the human says otherwise, to keep v1 shippable.

### 7.2 Storefront (customer-facing, public)
- Home/catalog view: browse by category, paginated product grid.
- Search by product name.
- Filter by category and price range.
- Product detail page: images, description, price, stock status (in stock / low stock / out of stock), add-to-cart.
- Storefront branding should read from tenant settings (store name, logo, primary color at minimum) so each tenant's storefront looks distinct without code changes.

### 7.3 Cart and checkout
- Cart persists across page loads for both guests (via a session token) and logged-in customers.
- Checkout flow: shipping address entry, order summary/review, handoff to Stripe Checkout for payment.
- On successful payment (confirmed via Stripe webhook, not just the client-side redirect), create the Order, decrement stock, and log the initial `OrderStatusEvent`.
- Handle the failure/abandonment path: if payment fails or the session expires, the cart should remain intact and no Order should be created.

### 7.4 Order management (Store Admin)
- List all orders for the tenant, filterable by status and date range.
- Order detail view: items, customer, shipping address, payment status, full status-event history.
- Update order status (with an optional note) — this writes a new `OrderStatusEvent` and should trigger a customer notification email.

### 7.5 Order tracking (customer-facing)
- Customer order history: list of past orders with current status.
- Order detail/tracking view: a timeline built from `OrderStatusEvent` records, showing each transition with timestamp.
- Guests who checked out without an account should still be able to look up order status via order ID + email, without needing to create an account.

### 7.6 Notifications
- Transactional emails on: order placed/paid, status change (especially "shipped" and "delivered"), and order cancellation/refund.
- Triggered server-side from the same code path that writes the `OrderStatusEvent` — don't duplicate this logic in the client.

### 7.7 Tenant settings (Store Admin)
- Store name, logo, primary brand color, contact email, currency (single currency, chosen at tenant setup).

---

## 8. API / route structure (indicative — adjust as needed, but keep this shape)

- Storefront pages: `app/[tenant]/...` resolved via subdomain middleware, not a literal URL segment in production — the `[tenant]` here refers to the resolved tenant context, not a route param the customer sees in the URL.
- Admin pages: `app/admin/...`, gated by Store Admin/Super Admin auth, scoped to the authenticated user's tenant.
- Mutations (create product, update order status, add to cart, etc.): Server Actions colocated with the relevant page/feature.
- `app/api/webhooks/stripe/route.ts`: Route Handler for Stripe webhook events (payment succeeded, payment failed) — this must exist as a real HTTP endpoint since Stripe calls it directly; verify the webhook signature on every request.

---

## 9. Security requirements

- Tenant isolation enforced at the data-access layer, per Section 4 — this is the top-priority security requirement in this entire spec.
- All Stripe webhook events must have their signature verified before being trusted.
- All user input validated with Zod at the point it enters the system (Server Action inputs, webhook payloads, form submissions) — do not trust client-side validation alone.
- Role checks happen server-side on every admin action, re-checked per request, not cached from a prior page load.
- No secrets (Stripe keys, DB credentials, Auth secrets) committed to the repo — use environment variables and provide a `.env.example` documenting every required variable.

---

## 10. Testing requirements

- Unit tests: stock decrement logic, order total calculation (subtotal + shipping + tax), order status transition rules (e.g., can't go from `DELIVERED` back to `PENDING_PAYMENT`).
- Integration test: tenant isolation, as specified in Section 4 — non-negotiable.
- End-to-end (Playwright) happy path: browse storefront → add to cart → checkout → pay (Stripe test mode) → order appears in admin → admin updates status → status change reflected in customer tracking view and triggers a notification.

---

## 11. Deployment

- App deployed to Vercel.
- Database on a managed Postgres provider (Neon or Supabase), reachable from Vercel.
- Document every required environment variable in `.env.example` and in the README: database URL, Auth.js secret, Stripe secret/publishable/webhook-signing keys, email API key, blob storage credentials.
- Stripe webhook endpoint must be registered against the deployed URL — note this as a manual setup step in the README, since it can't be automated from within the codebase.

---

## 12. Suggested build phases

Work through these in order. Confirm the Prisma schema (Section 6) is solid before writing feature code against it — schema changes get expensive once features are built on top.

1. **Phase 0 — Foundation:** Next.js scaffold, Prisma schema + migrations, tenant-resolution middleware, Auth.js setup, base layout for storefront vs. admin.
2. **Phase 1 — Product management:** Store Admin CRUD for categories and products, image upload, product list/detail admin views.
3. **Phase 2 — Storefront:** public catalog browsing, search/filter, product detail page.
4. **Phase 3 — Cart & checkout:** cart persistence, Stripe Checkout integration, webhook-driven order creation.
5. **Phase 4 — Order management & tracking:** admin order list/detail/status-update, customer order history/tracking view, notification emails.
6. **Phase 5 — Tenant provisioning & polish:** super-admin tenant creation flow, tenant settings/branding, README + deployment docs, the tenant-isolation integration test and E2E happy-path test if not already written alongside their features.

---

## 13. Definition of done for v1

- [ ] A Super Admin can create a new tenant and an initial Store Admin account for it.
- [ ] A Store Admin can log in and manage products (with SKU, price, stock, category, images) for their tenant only.
- [ ] A customer can browse that tenant's storefront, search/filter products, and see accurate stock status.
- [ ] A customer can complete checkout via Stripe and receive an order confirmation email.
- [ ] The resulting order appears in the tenant's admin order list, with correct items and totals.
- [ ] A Store Admin can update order status, and the customer sees the updated tracking timeline and receives a notification.
- [ ] Two tenants can operate simultaneously with zero data leakage between them, proven by an automated test.
- [ ] The codebase includes a README covering local setup, environment variables, and deployment steps sufficient for provisioning a new tenant.

---

## 14. Instructions to the coding agent

- Work phase by phase per Section 12. Don't jump ahead to later phases before earlier ones are functional and tested.
- Treat Section 4 (multi-tenancy) as non-negotiable — if a shortcut would compromise tenant isolation, don't take it, even if it's faster.
- Write tests alongside each phase, not as a separate pass at the end.
- Where this document says `[DECIDE]`, make a reasonable choice, implement it, and note what you chose and why in a comment or the README — don't stall waiting for input.
- Where this document says `[ASK]`, or where you hit an ambiguity not covered by this spec that would meaningfully change the data model or tenant-isolation guarantees, stop and ask before proceeding.
- Commit and push at the end of each completed phase with a descriptive commit message, so progress is checkpointed and reviewable.
