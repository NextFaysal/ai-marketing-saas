# Milestone 65 — Order-Event Completeness (Acceptance)

Built 2026-10-11 from `docs/platform-hardening-plan.md`.
**No schema change.**

## Audit finding that reshaped the milestone
The plan assumed CSV/manual orders existed but skipped the
`order.created` event. Reality was worse and different:
- There was **no manual order entry and no order CSV import
  at all** — phone/counter orders (the daily reality for BD
  sellers) could never enter the system.
- **A live production bug**: `IntegrationsService` declared
  its EventsService dependency with an inline `import()`
  type. TypeScript emits `Object` for that in
  design:paramtypes, so Nest silently injected `undefined` —
  meaning `order.created` / `order.delivered` from
  WooCommerce/Shopify sync and webhooks **never fired in the
  real app** (unit specs inject fakes positionally, so tests
  never saw it). Chat orders were unaffected (InboxService
  uses a real import). Fixed with a real class import + a
  comment so it cannot regress unnoticed.

## What was built
- **Manual orders**: `POST /organizations/:id/orders`
  (OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT) with
  free-form item lines; totals computed server-side; the
  customer is keyed by phone (source-scoped externalId) so
  repeat buyers converge; an optional `externalRef` makes
  re-submits update instead of duplicating. Web form at
  `/dashboard/orders/manual` (Bengali) + a link from the
  orders page.
- **CSV order import**: `POST /organizations/:id/imports/orders`
  (same roles as product import), columns
  order_ref/customer_phone/item_name/unit_price + optionals,
  major-unit money like the products CSV, per-row errors,
  ImportJob accounting (created vs updated vs failed).
  One row = one order with one item line in v1 (upsert
  replaces items wholesale — documented in code + UI +
  `docs/examples/orders-sample.csv`).
- Both paths delegate to `IntegrationsService.upsertOrder`
  (sources `manual` / `csv`) — dedupe, the risk score,
  attribution, workflows, CAPI and offline conversions all
  inherit the single pipeline.

## Verification
- **API tests: 605 pass (87 suites)** incl. 6 new M65 tests
  (server-side totals + delegation shape + phone keying,
  random-ref behaviour, empty-items rejection, CSV parsing
  incl. per-row errors, import created/updated counting).
- **Live end-to-end**: with an `order_created` workflow
  armed, a manual order produced **exactly one WorkflowRun**
  (the first time store-pipeline events have verifiably
  fired in the running app); re-submitting the same
  externalRef returned `updated`, totals changed, and the
  run count stayed 1; the sample CSV imported 3/3 as new
  orders.

## Notes
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
