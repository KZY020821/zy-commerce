# Selling Catalog Concierge

**Draft. Not legal advice — have a lawyer read anything here before a client
signs it.** This is the engineering side of the question: what has to be true
of the package for money to change hands, and what each route costs to run.

Today the package cannot be used by anyone. `package.json` says
`"private": true`, which blocks `npm publish`, and `LICENSE` reserves all
rights: the repository is readable so that clients and employers can judge the
work, and that is all it permits. Everything below is about changing that
deliberately rather than by accident.

## Three ways to deliver it

### 1. Per-client source licence (simplest to start)

You hand over a tarball (`pnpm --filter catalog-concierge pack`) or add the
client's machine account to a private repository, under a licence that grants
one named business the right to use it on agreed domains.

- Nothing to publish, nothing to host, no registry account.
- Each client is a separate conversation, which suits consulting work where
  you are also doing the integration.
- Updates are manual: you send a new tarball, they bump it.

### 2. Private registry

Publish to a private npm scope (or GitHub Packages) and give each client a
read token.

- `pnpm add @yourscope/catalog-concierge` works like any dependency, which is
  what a client's own developers expect.
- Access is a token you can revoke.
- Costs a paid npm organisation, and a leaked token is a leaked package.

### 3. Public package, commercial licence

Publish publicly, licensed for evaluation, with production use requiring a
purchased licence — the model Sidekick, Tiptap Pro and others use.

- The widest reach and the easiest trial: a developer can install it in a
  minute.
- Enforcement is social, not technical. Assume some use goes unpaid.
- Needs `"private": false`, a licence that says exactly what a trial allows,
  and a CHANGELOG people can rely on (both exist now bar the licence).

## What to change when you decide

1. Replace `LICENSE` with terms that grant use. The draft below is a starting
   point for route 1.
2. For routes 2 and 3, set `"private": false` and add a scope to `name`.
3. Tag a release and fill in the `Unreleased` section of the package's
   `CHANGELOG.md`.
4. Keep `pnpm --filter catalog-concierge test:pack` green: it installs the real
   tarball into an empty project and is what proves an install works for
   someone who is not you.

## Draft licence for route 1

> Copyright (c) 2026 Khor Ze Yi. All rights reserved.
>
> **Grant.** Subject to payment of the agreed fee, Licensee is granted a
> non-exclusive, non-transferable, perpetual licence to use, modify and deploy
> this software as part of Licensee's own products or websites, on the domains
> agreed in writing.
>
> **Restrictions.** Licensee may not redistribute, sublicense, sell or publish
> this software, or any derivative of it, as a standalone product, a component
> library, a template, or any offering whose primary value is this software.
> Licensee may not remove or alter this notice.
>
> **Ownership.** All right, title and interest in the software remain with the
> copyright holder. Nothing here transfers ownership.
>
> **Warranty.** The software is provided "as is", without warranty of any kind,
> express or implied, including merchantability, fitness for a particular
> purpose and non-infringement.
>
> **Liability.** In no event shall the copyright holder be liable for any
> claim, damages or other liability arising from the software or its use,
> whether in contract, tort or otherwise. Total liability shall not exceed the
> fee paid.
>
> **Term.** This licence ends if Licensee breaches it and does not cure the
> breach within 30 days of written notice.

## What a buyer will ask for besides a licence

- **A sandbox on their own catalogue.** Export their products to JSON, run the
  assistant against it, read the answers. Worth more than any feature list.
- **What a conversation costs.** The reply carries token usage; nothing stores
  it yet.
- **Which models it works with.** DeepSeek is the default and any
  OpenAI-compatible endpoint should work, but only DeepSeek has been run in
  anger.
- **Support terms.** Response times, how long a version is maintained, what a
  bug fix costs after the project ends.
