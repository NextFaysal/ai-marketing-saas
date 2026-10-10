# Milestone 2 Acceptance Checklist - Business Data

- [x] Prisma models: Product, ProductVariant, ProductCost, BusinessPolicy,
      KnowledgeDocument, ImportJob + migration 20261010010000_milestone2
- [x] Money as integer minor units everywhere; shared parser/formatter in
      @repo/contracts (`parseMoneyToMinor`, `formatMinor`) with tests
- [x] Products API: create, list (search/category/status, pagination),
      get, update, archive (soft, via status) - all tenant-scoped
- [x] Variants API: create per product, tenant-checked through the product
- [x] Costs API: append-only cost history; product responses include
      current cost, margin (minor), margin % and markup % - all null
      (never invented) when cost is unknown
- [x] CSV import: documented columns + header aliases, quoted commas,
      per-row error report, duplicate SKU inside the same org is SKIPPED
      (never overwritten), ImportJob records totals and up to 200 errors,
      audit log entry written
- [x] Sample file: docs/examples/products-sample.csv
- [x] Policies API: create/list/update/delete (shipping, delivery,
      refund, return, cancellation, payment, custom)
- [x] Knowledge documents API: FAQ/note/claim/template create/list/delete
- [x] Onboarding v2: 2 steps (organization, then industry/website/
      description/goals/brand voice + shipping & refund policies)
- [x] Web: Products page (create with optional cost, search, margin
      table, archive), CSV Import page (result counters + row errors),
      Knowledge page is a real editor (profile, policies, FAQ)
- [x] Tests: 25 total passing (API 17, contracts 7, worker 1)
- [x] Builds: all packages + API + Next.js production build pass
- [ ] Verified against live Postgres (pending Docker on dev machine,
      same open item as Milestone 1)

## Known limitations
- CSV transport is browser-read text up to 2 MB, processed synchronously.
  S3 upload + worker processing is scheduled for the orders-import phase.
- Product images are URL-only; media upload/library arrives later.
- Orders and store sync are Milestone 3 (WooCommerce), not part of this
  milestone.
