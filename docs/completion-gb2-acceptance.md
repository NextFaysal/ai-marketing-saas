# GB2 Acceptance — G2 Catalog & Inventory Completion (GC6 + GC7)

**Batch:** GB2 of the E-Commerce Completion Program (plan: `Ecommerce-Completion-Plan-2026-10-15.md`).
**Base:** branch `completion` at GB1 HEAD `ee5b2a6` (orders-next line). Local commits only — **no push**.
**Migration:** `20261013920000_gb2_catalog_inventory` (166th migration).

**Deploy notes:** this migration has NOT been run on any real database. Fresh-Postgres-16 verification WAS run by the coordinator (throwaway cluster): `prisma migrate deploy` over the full sequence — **166/166 applied clean, 228 tables**; the 2 new tables (`Brand`, `StockReservation`) and all 6 new columns (`Product.brandId/freeShipping/lastOosNotifiedAt`, `ProductVariant.lastOosNotifiedAt`, `InventorySetting.allowBackorder/reserveMinutes`) verified present via information_schema.

**New dependency (one, justified):** `exceljs@4.4.0` (pinned exact) added to `apps/api` ONLY. The dependency tree was checked first: the API had **no spreadsheet parser at all** (CSV via papaparse was the only tabular import path; `@fast-csv` exists only as a transitive node_modules entry of other tooling, not a declared dependency). exceljs is the widely-used, actively maintained xlsx reader/writer; it is imported by exactly one file (`apps/api/src/imports/xlsx.ts`) on the import path. Sandbox note: `pnpm add` cannot complete inside this worktree (the workspace mount rejects the chown pnpm performs on its lockfile temp file — EPERM); the declaration was produced by running pnpm against staged manifests in /tmp and copying back a verified purely-additive lockfile diff (0 lines removed/changed outside the exceljs closure).

---

## GC6 — Catalog completion

### §1 Brands — DELIVERED
- `Brand` model (org-scoped; `@@unique([organizationId, slug])`, logoUrl/description nullable) + `Product.brandId` (nullable FK, `onDelete: SetNull` as a second belt under the service behaviour).
- Staff CRUD under the products routes (`GET/POST products/brands`, `PATCH/DELETE products/brands/:brandId`), all writes audited (`product.brand.create/update/delete`). Slugs are unique per org with numeric suffixing; Bengali-only names fall back to a `brand-<base36>` slug (the codebase slugify is `\w`-based, same fallback as product slugs). A rename re-slugs **only when the name actually changed**, so shop brand URLs survive unrelated edits.
- **Delete semantics (chosen, as briefed): null-out with audit** — deleting a brand nulls `brandId` on its products (products are never deleted with a brand) and the audit metadata carries `unlinkedProducts`.
- Product create/update validate `brandId` in-org with the same 404 discipline as `categoryId`; `null` clears. Products list gains a `brandId` filter. Product form gains a brand picker; list gains a brand filter; a brands manager (create/edit/delete) lives on the products page.
- Shop: `shopHome` payload gains `brands` (only brands with ≥1 ACTIVE product, with ACTIVE counts); `?brand=<slug>` filters the listing (unknown slug → empty list, never an error); public brand page `GET public/shop/:orgSlug/brands/:brandSlug` (brand info + its ACTIVE products through the same serialize machinery; unknown slug 404s) + web route `shop/[orgSlug]/brands/[brandSlug]`. Serialized products carry `brand: { id, name, slug, logoUrl } | null`.

### §2 Product export — DELIVERED
- `GET products/export` (staff-guarded, declared before `:productId`) returns CSV in the **exact column shape the importer accepts** (verified against `imports/csv.ts` HEADER_ALIASES): `name, sku, price, compare_at_price, currency, cost, stock, category, description, image_url, brand, status, variant_name, variant_sku, variant_price, variant_stock, variant_cost`. Money is exported in **major units** (the importer's unit), one row per variant (variant-less products get one row with empty variant columns; product columns repeat — the importer's variant grouping rebuilds one product + variants). `cost` = current product-level cost; `variant_cost` = the variant's own recorded cost when present. Audited as `product.export` with counts only (no product data in the audit body). A spec round-trips an export through `parseProductsCsv` and asserts name/sku/brand/prices/costs/variant SKUs read back identically. Dashboard: export download button on the products page.

### §3 Excel import — DELIVERED
- One importer, two front-ends: `csv.ts` was refactored so the row pipeline is the exported `parseProductRecords(records)`; `parseProductsCsv` delegates to it — **CSV behaviour is unchanged** (the pre-existing imports suites pass untouched). `xlsx.ts` (exceljs) reads the first worksheet, normalizes headers exactly like the CSV front-end, and produces records for the same pipeline.
- New columns for BOTH front-ends: `brand` (resolve-or-create by case-insensitive name, per-import cache, failure-isolated per row), `status` (normalized to the enum; invalid values are row errors), and the variant columns (`variant_name/sku/price/stock/cost`). Rows carrying variant fields are grouped (key = product sku, else lowercase name); the group imports as one product with one `ProductVariant` per row (first row included); a group whose product sku already exists is skipped whole (the importer's existing duplicate-sku semantics — never a partial variant merge); a duplicate variant sku inside a group fails that row only.
- Endpoint `POST imports/products/xlsx` (base64 body, same size ceiling style as the CSV DTO) runs the SAME job pipeline (`importJob` + counts + row errors, partial-success semantics mirrored from CSV, not invented); audit action `import.products.xlsx` (CSV keeps `import.products.csv`). A malformed/unreadable file → one clear Bengali 400: “Excel ফাইলটি পড়া যায়নি — সঠিক .xlsx ফাইল আপলোড করুন”. Dashboard import page accepts .xlsx.
- Import counting note (documented choice): for variant groups, `success` counts rows whose variant was actually created (the first row's product creation is not double-counted); group-skip counts every group row as skipped.

### §4 Bulk delete — DELIVERED
- `POST products/bulk-delete { ids }` (OWNER/ADMIN, max 100 ids, deduped) with per-product outcomes:
  - referenced by ANY `OrderItem` → **ARCHIVED** via the existing `archive()` path (its audit + push hook fire) → `archived`;
  - never ordered → **hard-deleted** → `deleted` (+ `product.delete` audit + archive push hook). Schema reality verified: **every** Product child relation is `onDelete: Cascade` (variants, costs, images, tag assignments, listings, cart items, PO items, bin assignments, stock-count lines, subscriptions, bundle items on both sides), so the plain row delete cleans children with no forked cascade code; `StockMovement` / `StockReservation` / `OrderItem` carry plain ids without FKs, so the stock ledger and order history survive as records — by design.
  - foreign/missing → `not_found` per row (never a whole-batch 404).
- Batch audit `product.bulk_delete` carries counts only. Dashboard: multi-select bulk action labelled honestly (“মুছুন/আর্কাইভ” — the UI explains ordered products will be archived, not deleted, and shows the per-product outcomes).

### §5 Product-level free shipping — DELIVERED
- `Product.freeShipping` (default false). Semantics through the ONE resolver (`StorefrontService.resolveDeliveryCharge`, ctx gains optional `allFreeShipping`): when every product line is free-shipping the zone/rule charge returns 0 (reported separately from zone free-above — `zoneFreeShipping` stays false; the quote surfaces `productFreeShippingApplied`). Callers compute the weight population over **non-free lines only**: a free line's weight neither adds to the total nor makes it unknown (it leaves the “every line has weight” test population entirely).
- Paths wired: shop quote/checkout (`computeQuote`), landing checkout (resolver branch **and** its legacy fallback branch), single-product checkout (its flat BusinessProfile fee zeroes — its only line is the product), order-surgery recalculation (weight loop skips free lines; all-chargeable-lines-free passes the flag). The pickup branch never calls the resolver, so **pickup fees still apply**; gift wrap is added outside the resolver and is unaffected; free-above logic untouched.
- Specs pin: flags-off parity (weight rule sees ALL weight, zone total byte-identical), mixed cart (rule prices only the non-free weight), free line with unknown weight no longer poisons the cart weight, all-free cart → delivery 0. Product form toggle + PDP “ফ্রি ডেলিভারি” badge via new shop i18n keys (bn + en).

### §6 Product change history — DELIVERED
- `GET products/:id/history` (staff): AuditLog rows whose `entityId` is the product id (product.*, `inventory.adjusted`, the low-stock + new OOS alerts — those audit with entityType “Product” + the product id), its variants' rows, and cost rows (`product.cost.set` audits the cost row with `metadata.productId` — matched via a Json path query, failure-isolated). Bengali title map in the ON2 style; details carry only safe numbers (stock delta / balance) — never note bodies or payloads; actor names attached failure-isolated; newest first, capped at 200 + `truncated` flag. Dashboard product view gains a History tab/panel.
- **Coverage honesty:** history shows only what audits exist today. Verified by grep, product mutations DO audit today: create, update, archive, variant create/update/delete, `product.cost.set`, image create/delete/reorder, bundle add/delete, tag + category writes, and every stock movement's `inventory.adjusted`. NOT attributable to a product (and therefore absent): org-level audits without an entityId — e.g. `product.bulk_edit` records only a count — and anything that happened before those audits existed. Nothing is backfilled or fabricated.

---

## GC7 — Inventory completion

### §1 STOCK AUDIT FINDINGS (verified in code before building)
- **Shop cart/checkout DID enforce stock** — against ON-HAND — via `StorefrontService.assertStock` (called in `patchCartLine` and `computeQuote`; preorder bypasses). POS also enforces on-hand with the same Bengali message.
- **Single-product checkout (`ProductsService.placePublicOrder`) had NO stock check at all** — product-exists gate + preorder limit only; it could oversell tracked stock without bound. It also does not use `resolveDeliveryCharge` (BusinessProfile flat fees) and ignores `dto.variantId`.
- **Landing checkout (`LandingsService.placeOrder`) had NO stock check** (preorder limit only).
- **Manual orders:** no stock check (free-text lines, no productId at intake). **Chat orders:** no pre-placement stock check.
- **`InventoryService.applyOrderPlaced` decrements into NEGATIVE by design** (S1: negative balances are recorded truthfully, nothing clamps); idempotent per (order, product, variant); preorder lines skip decrement.
- **Pre-order session reality:** EC10's `AbandonedStoreCheckout` concerns CONNECTED stores. The native pre-order session is the **server cart `StoreCart`** (token-keyed, status open/converted, lines in `StoreCartItem` + `StoreCartBundle`) — reservations anchor there (§3).
- Adjustment-reason reality: `adjust()` callers use system reasons (`manual_adjustment` default, `ai_proposal`, `return_restock`, `purchase_receive`, `stock_count`) plus free-text in specs; **the merchant DTO had NO reason field at all** — merchant adjustments always landed as `manual_adjustment`. (This corrects the brief's premise slightly: the vocabulary constraint belongs on the merchant channel, which GB2 creates; `adjust()` itself must keep accepting system reasons, so no hard throw was added inside it.)

### §2 Checkout stock enforcement + backorder — DELIVERED
- ONE availability checker: `InventoryService.checkAvailability` (preorder → ok; untracked → ok; `InventorySetting.allowBackorder` ON → ok; otherwise quantity must fit on-hand minus other sessions' active reservations).
- **Shop:** `assertStock` became async + availability-aware (same Bengali refusal shape, citing the AVAILABLE count — identical to the old message when nothing is reserved and backorder is off). Call sites: cart line patch, quote main lines, quote bundle components.
- **Single-product + landing checkouts GAINED enforcement** (they had none): single is product-level (that path resolves no variant — documented); landing uses assert-stock semantics (variant stock wins when a variant is chosen). Neither creates reservations (no session exists — see §3 window).
- **Manual/staff orders: warn-not-block** — `createManual` appends `insufficient_stock` warnings (via the existing ON11 warnings channel, failure-isolated) when a SKU-matched line exceeds availability; the order is still created. POS unchanged (already enforces on-hand; it does not consult reservations/backorder — documented).
- `allowBackorder` default FALSE, surfaced in the inventory settings UI with copy that says oversell decrements into negative by the merchant's own choice.

### §3 Reserved stock — DELIVERED (on the real server cart)
- `StockReservation` (organizationId, sessionRef = StoreCart id, productId, variantId?, quantity, state active|consumed|released, expiresAt; plain product/variant ids — deliberately no FK to Product, so reservations never block a product delete and never fake a ledger entry).
- **Window:** created/reconciled on cart mutations (`patchCartLine`; `patchCartBundle` refreshes expiry) **only when `InventorySetting.reserveMinutes > 0`** (default 0 = OFF). A line reserves `min(quantity, on-hand)`; preorder + untracked lines never reserve; **bundle lines reserve nothing** (components are not cart lines — they remain availability-checked at quote/checkout). Expiry is **lazy** (reads count only `state=active AND expiresAt > now` — no sweep job; the window slides with cart activity). Checkout success settles the cart's rows to `consumed`; removed/trimmed lines are released/adjusted in place. Availability = on-hand − Σ active reservations, and **the converting cart's own reservations are excluded from its own checks** (spec-pinned end-to-end: cart A reserves → cart B refused beyond availability → cart A checks out → rows consumed).
- **Coverage window (honest):** reservations cover the server-cart lifetime only — from the first cart mutation with the setting on, until checkout conversion or lazy expiry. Single-product and landing checkouts have no cart session, so nothing reserves for them (they still enforce availability at placement). Nothing reserves for POS, manual, chat, or connected-store checkouts.
- Availability surfaces: shop listing + PDP serialization (`reservedQuantity` / `availableQuantity` per tracked row; per-variant on variant products), staff products list/detail (product-tracked rows), and `GET inventory/availability` (per-tracked-row onHand/reserved/available at the EC33 catalog's row granularity) + dashboard section.

### §4 Damaged/lost tracking — DELIVERED
- Merchant vocabulary enforced at the boundary: `StockAdjustmentDto.reason` gains `@IsIn([damaged, lost, expired, supplier_return, correction, other, manual_adjustment])` (the DTO previously had no reason field at all — see §1). `InventoryService.adjust` keeps accepting system reasons for internal flows (`purchase_receive`, `return_restock`, `stock_count`, `ai_proposal` exported as constants alongside); legacy free-text reasons already in the ledger stay readable. Writing a damage movement uses the EXISTING adjust path — no new stock semantics.
- `GET inventory/damage-report?from&to`: StockMovement rows with reason ∈ {damaged, lost, expired} (default range 30 days; bad dates → Bengali 400). Totals count stock-OUT movements only (a positive damage-reason adjustment is a correction: listed, never totalled). Cost value uses the **ON7 as-of rule** (variant cost beats product cost; latest `effectiveFrom` ≤ movement time, else earliest after); a movement with no recorded cost contributes nothing and is counted in `uncostedMovements` — never an invented value. Capped at 2000 rows + `truncated`. Dashboard section with per-reason totals.

### §5 Out-of-stock staff alert — DELIVERED
- When a stock write takes a tracked row from > 0 to exactly 0, ONE Bengali `AgentNotification` (`type: "out_of_stock"`) fires to the org's ACTIVE OWNER/ADMIN memberships — the low-stock alert's delivery pattern — and the stock row is stamped (`Product.lastOosNotifiedAt` / `ProductVariant.lastOosNotifiedAt`). The stamp suppresses repeats at/below zero; **any write landing the balance above 0 clears the stamp (re-arm)** — implemented as a conditional spread at every balance-write site, so unstamped rows' update payloads stay byte-identical to before GB2. Call sites mirror the low-stock alert exactly (placement product/variant/bundle components, edit deltas, restore phases incl. downward netting, adjust). Sync-driven corrections (`recordSyncedStock`) never fire it — same discipline as low-stock. Audited as `inventory.out_of_stock_alert` (surfaces in the product History tab). Failure-isolated end to end. Low-stock behaviour unchanged (EC33 + inventory suites green).
- Settings surface: `GET/PUT inventory/settings` now also carries `allowBackorder` + `reserveMinutes` (partial PUT; **EC33's pinned contract preserved** — leadTime key-presence validation + its exact Bengali message + audit metadata `{ leadTimeDays }` for lead-time-only updates; GB2 field changes are named in `metadata.changed`).

---

## Gates (coordinator-run, exit-code verified)

| Gate | Result | Baseline |
| --- | --- | --- |
| API jest (chunked, 6 chunks, `--runInBand`) | **346 suites / 3565 tests, ALL PASS** (chunk sizes 65/57/61/52/55/56) | 341 / 3511 |
| API tsc `--noEmit` | **exit 0** | 0 |
| Web vitest | **48 files / 343 tests PASS** | 343 |
| Web tsc (`pnpm lint`) | **exit 0** | 0 |
| Full build `pnpm -r build` (incl. Next build) | **exit 0** | green |
| `prisma validate` | **valid, exit 0** | valid |
| Fresh-DB full sequence (throwaway PG16) | **166/166 applied clean, 228 tables**, GB2 tables/columns verified | 165/165, 226 tables |

New GB2 tests: 54 (imports 16, inventory 14, catalog 11, storefront 7, intelligence 6) — the delta matches the totals exactly. Web test count is unchanged (343): the GB2 web work is UI against the pinned API contracts and adds no new vitest cases.

**Gate process notes (honest):** (1) A single-process full jest run **cannot complete in this sandbox** — the V8 heap (≈2.2 GB default) aborts around suite ~100–300 with zero test failures before the abort; the gate was therefore run as 6 sequential `--runInBand` chunks over the full sorted suite list (the same chunked approach other tracks in this program have used). (2) One pre-existing spec was updated: `commerce/ec24-preorder.spec.ts` unit-tested the private `assertStock` synchronously; GB2 made it async by design, so its two assertions became `resolves`/`rejects` with identical intent (preorder bypasses; normal zero-stock refused). No assertion was weakened or removed. (3) The first full attempt surfaced two real EC33 contract breaks in the widened settings update (audit metadata shape + invalid-leadTime message); both were fixed in the service to preserve EC33's pinned behaviour exactly, and EC33 + GB2 intelligence suites pass together.

## Honest limits
- **No live proof, no screenshot QA** — everything above is fixture/fresh-DB proven in the sandbox; nothing has run against the real Dokploy deployment or a real merchant account (M30/EC12 verification remains owner-owed, as for every prior batch).
- Reservations are **cart-window only** (see §3): they cannot cover single/landing/POS/manual/chat/connected-store checkouts, and bundle component stock is checked at quote/checkout but never reserved.
- Reservation correctness is **read-time, not transactional**: two carts racing the same final unit can both reserve up to on-hand (each reservation is capped by on-hand at sync time, not by on-hand-minus-others), but checkout enforcement still refuses the second conversion beyond availability — a reservation is a strong hint, the placement check is the guarantee.
- OOS alert exactly-once rests on the row stamp, not a DB lock: two perfectly simultaneous crossings could double-notify (the same documented posture as the low-stock alert's dedupe).
- History coverage is limited to audits that exist (see §6) — org-level bulk-edit audits cannot be attributed to a product and do not appear.
- The xlsx front-end reads the first worksheet only, consistent with the CSV importer's single-table shape; formulas read their cached results via exceljs.
- POS enforcement predates GB2 and remains on-hand-only (no reservation/backorder consultation) — unifying POS onto `checkAvailability` is a deliberate follow-up, not silently claimed here.
- `apps/web` brand page payload type declares a `pagination` field the API does not return (the page renders the full ACTIVE list from `products`); harmless drift, noted rather than hidden.
