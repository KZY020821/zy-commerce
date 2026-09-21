# Changelog

All notable changes to Catalog Concierge. Dates are the day the change was
merged. Versions follow semantic versioning: the public surface is everything
exported from `catalog-concierge` and `catalog-concierge/react`, plus the
`CatalogAdapter` contract and the shape of a reply.

## Unreleased

### Added

- `catalog-concierge/styles.css`: a prebuilt stylesheet, so a host that does
  not run Tailwind — or would rather not scan a dependency — gets a styled
  widget from one import. It contains the widget's own classes and nothing
  else: no reset, no preflight, nothing that touches the surrounding page.
- Progress reporting: `askConciergeStream` yields an event per tool call and
  returns the reply, and the widget's `onSendStream` shows it ("Searching the
  catalogue…"). `askConcierge` is the same turn drained to its end.
- A reason per product: `respond` takes `productNotes`, and the card prints it
  under the name. Used only when there is exactly one per product.
- Conversation restore (`loadHistory`), ratings (`onFeedback`), a handover to a
  person (`handoff`), a privacy line (`privacyNote`), and `labels` for every
  fixed string in the widget.
- `store.policies`: the shop's own delivery, returns and opening-hours text,
  and the only non-product facts the assistant may state.
- `viewing`: the product the customer has open, which tells the assistant what
  "this one" means and lets the guard admit a question about it.
- `toProductCard`, so a host renders a restored card exactly like a live one.

### Changed

- The off-topic guard reads scripts written without spaces between words, so a
  Chinese question reaches the model instead of being refused.
- The opening chips no longer offer a sale: the catalogue contract has no sale
  price, so it was a question the assistant could only decline.
- On a phone the widget is a modal dialog: focus stays inside it and it sizes
  to the visual viewport, so the send button is never under the keyboard.

## 0.1.0 — 2026-09-07

- First extraction from the ZY Commerce codebase: the tool loop, the zero-token
  off-topic guard, the catalogue profile, the search tools, the widget, and the
  two-method `CatalogAdapter` that is the whole integration surface.
