# AB5 Acceptance — AX7 B2B Completion + AX8 Mix-and-Match Bundles + AX9 Digital Depth + AX10 Meta Catalog Sync Lifecycle

Batch AB5 of the E-Commerce Advanced Program, built in `~/workspace/ai-marketing-saas-gc`
(branch `completion`) on top of AB4 HEAD `d4ed322`. **Local commits only — NO push.**
Final HEAD is the docs commit that adds this file; the tree was clean at every handoff.

Migration: **`20261017050000_ab5_b2b_bundles_digital_catalog`** (additive only: 8 new
tables + nullable/defaulted columns). **NOT run on any real DB** — deploy requires it,
plus a per-org enablement of the new **`catalog_sync_sweep`** job template for orgs
that want change-driven catalog sync.

## Commits (21)

| Commit | Content |
|---|---|
| `5fc10c7` | Schema + migration (coordinator) |
| `2b1e30a` | AX7: PriceListsService + group pricing at all line-build paths |
| `8d558c0` | AX7: quotes — staff CRUD, token public page, send, conversion |
| `f05fac8` | AX7: net terms — creditDueDate snapshot, khata overdue, customer group/terms fields |
| `d46756c` | AX7 specs (35) |
| `7e4b497` | AX8: bundle slots CRUD + validation + pick-aware component resolution |
| `e08377b` | AX8: cart + quote wiring (picks stored, serializeCart labels, strict quote re-validation) |
| `31becff` | AX8 specs (46) |
| `0702eb8` | AX9: LicenseKeysService + staff routes + product digital-field validation |
| `6d2ad3d` | AX9: signed expiring downloads + reveal rework |
| `02f70a0` | AX9 specs (49) |
| `44f1167` | AX10: catalog payload builder (variants, UPDATE/DELETE) + enqueue + sweep |
| `9d49151` | AX10: product-write hooks + `catalog_sync_sweep` job wiring |
| `3ed7768` | AX10 specs (32) |
| `fd67de6` | Web: customers — groups + price-list editor, group/terms form fields, khata due dates + overdue filter |
| `edc0c0d` | Web: quotes dashboard + public quote page + commerce nav chip |
| `c5bf924` | Web: bundle slots — dashboard editor, shop slot pickers, cart viaSlot labels |
| `7fe103e` | Web: track page — signed download links, license-key reveal, shortage notice |
| `2d7383a` | Web: products — digital delivery type/expiry + license-pool panel |
| `8ea2755` | Web: audiences catalogs — autoSync toggle, Page/IG linkage, sync status |
| `52cf366` | Fix (coordinator): GB9 public-docs drift guard — digital-download route deliberately added to the frozen route inventory |

## AX7 — B2B completion

### Groups + price lists
- `CustomerGroup` (org-unique name) + `Customer.groupId` (scalar; group deletion nulls
  members in the service). `PriceList` (one per group) + `PriceListItem`
  (product-level or variant-specific explicit prices — **materialized only**; the
  bulk %-off helper writes floor-computed explicit rows for up to 500 products, it
  never computes anything at read time).
- **Group-price precedence rule (as built, spec-pinned):**
  1. Gift-card lines keep their chosen face value — never group-priced, never tier-priced.
  2. An explicit **price-list price replaces** the catalog/variant unit price
     (variant-specific row beats the product-level row) **and beats wholesale-tier
     math** — a negotiated per-group price is more specific than a quantity tier.
  3. Wholesale tier math applies only to lines with **no** list price.
  4. Otherwise the catalog/variant price stands.
  Promotions/coupon/referral/loyalty/gift-card evaluation still runs on top of the
  resulting lines — the evaluator core was not touched; group price is a PRICE
  SOURCE at line-build time.
- Applied at every price-resolving surface: shop cart quote/checkout
  (`StorefrontService.computeQuote` + post-placement `Order.priceListBreakdown`
  stamp, mirroring `wholesaleBreakdown`), single-product checkout, landing
  checkout (variant-aware), POS (phone-resolved customer). Guests never receive
  group prices. `PriceListsService.priceMapForCustomer` is failure-isolated
  (any error → null → pre-AB5 behaviour), and with the service absent every path
  is byte-identical to before (spec-pinned POS parity).
- **Manual/staff orders deliberately do NOT resolve group prices**: the manual
  path never resolves catalog prices at all — staff-entered prices are
  authoritative there by existing design. The customers UI shows group
  membership so staff see it while pricing. (Scoped decision, stated here per
  the brief's "document what you implement".)
- Shop PDP "your price" hint: NOT built (optional extra in the brief; the PDP
  payload does not expose a per-customer price today — group members see their
  price in the cart quote/checkout, where the customer is actually resolved).

### Quotes
- `Quote` + `QuoteCounter`: org-scoped numbers `QT-00001…` via the
  InvoiceCounter-style atomic transaction. Lines are **snapshots** (name,
  variant name, sku, qty, unit price as offered).
- **Quote-total honesty:** a quote is an OFFER document — `totalMinor =
  Σ lines + deliveryChargeMinor`, with **no tax and no promotion evaluation**.
  The public page and the dashboard state this. Conversion (staff action, only
  from `accepted`) goes through the real manual-order path
  (`OrdersService.createManual`, the one door) carrying the snapshot unit
  prices; the audit carries `{ quoteId, source: "quote_conversion" }` and
  non-quote manual orders are byte-identical (regression-pinned against the
  m65 harness). Because the manual path computes totals server-side from the
  same snapshot lines (and manual orders carry `taxMinor = 0` by existing
  design), the converted total equals the quote total **by construction** —
  but this is never promised silently: `GET quotes/:id/convert-preview`
  (plus an orders-side mirror) computes the resulting order totals by the
  manual path's own math without creating anything, and the dashboard
  convert flow fetches that preview and shows quote total vs order totals
  side by side — the confirm button stays disabled until the preview has
  loaded, with a warning line when the totals differ. A converted quote is
  terminal (second conversion refused).
- Send: token = 32 random bytes, stored as SHA-256 hash only; re-send rotates.
  Delivery mirrors the gift-card send discipline exactly (EmailProvider wins
  when configured; else tenant/platform SMS via the SmsProvider) and
  `sentVia` records only what actually happened (`email` | `sms` | `none`) —
  with `none`, staff still get the link to share manually.
- Public page (`/quote/[token]`, API `GET /public/quote/:token`): shop-branded
  minimal payload (org brand + quote facts only — no internal ids beyond the
  quote number); accept/decline transitions `sent → accepted|declined` with
  `respondedAt`; lazy expiry on both staff and public reads.
- Wiring note: conversion lives on the ORDERS side — `OrdersService`
  injects `QuotesService` as an optional dependency (OrdersModule already
  imports CommerceModule, so this is acyclic; no forwardRef, which the
  codebase never uses) and composes `QuotesService.buildConversionInput`
  (accepted-only, phone-resolution refusals) + `createManual` +
  `QuotesService.markConverted`. Staff route:
  `POST organizations/:id/orders/from-quote/:quoteId/convert`.

### Net terms
- `Customer.creditTermsDays` (default 0; UI vocabulary 0 | 7 | 14 | 30; API
  accepts 0..90).
- `Order.creditDueDate` is a **placement snapshot**: stamped once by the
  `upsertOrder` CREATE branch (the one door — so every native surface gets it
  identically; the update branch never restamps) when the resolved customer
  has terms > 0, the order total is positive, and the status is not
  cancelled/failed/refunded. Date base = `placedAt ?? now` + terms days.
  Later term edits never rewrite an existing order's due date.
- Khata (`getKhata`): each order row gains `creditDueDate` + `overdue`
  (due > 0 AND creditDueDate before the Asia/Dhaka calendar day — midnight
  computed via `Intl`, no tz library), `?overdue=1` filters the page to
  overdue orders, and the response carries the customer's `creditTermsDays`.
  ON7 aging buckets are unchanged — the terms layer is additive.

## AX8 — Mix-and-match bundles

- `BundleSlot` (label, chooseQty 1..20, sourceType `category` | `products`,
  sourceRef) — max 6 slots per bundle; bundle create/update accepts `slots`
  as replace-all-when-present. A bundle may have fixed items, slots, or both.
- **Bundle pricing rule (as built):** EC29 sells a set for ONE merchant-set
  `bundlePriceMinor`, so **the bundle price never changes with picks** — slots
  are choice-within-price. Each pick contributes ONE component unit to the
  existing `allocateBundle` expansion (weighted by its regular price, exactly
  like a fixed item), and the exactness identity (Σ allocated totals ==
  bundlePrice × qty) is spec-proven with picks included.
- Picks are **product-level** in v1 (variantSku always null — a pick names a
  product and resolves at the product price even when the product has
  variants; stated in code + here).
- Validation runs **twice**: at cart write (`patchCartBundle` stores the
  normalized picks on `StoreCartBundle.picks`: exact chooseQty per slot, no
  duplicates within a slot, every pick in the slot's CURRENT pool and ACTIVE)
  and again at quote/placement (a pick that went inactive refuses the quote
  with a Bengali message naming the bundle). `serializeCart` is lenient by
  design (invalid stored picks degrade to fixed-only display) — the quote
  path is the strict one. Pick components surface as ordinary bundle
  component OrderItems (bundleId stamp), so order detail + packing see
  exactly what to pack; the cart labels them with their slot (`viaSlot`).

## AX9 — Digital depth

### License keys
- `LicenseKey`: the full key exists ONLY as SHA-256 hash (dedupe) + AES-256-GCM
  sealed copy (`seal`/`unseal` from `common/platform-config`, the gift-card
  pattern). Canonical form = the exact trimmed string — **case-sensitive**,
  because vendor keys are case-sensitive (gift-card codes normalize; license
  keys deliberately do not).
- Staff import: paste one-per-line, max 500 non-empty lines per batch
  (501+ refuses the whole import), per-line report (imported count, duplicate
  count + last-4 samples, invalid line numbers). List/summary surfaces are
  masked — a spec asserts `keyHash`/`keySealed` appear NOWHERE in any staff
  response. Revoke is audited; revoking an ASSIGNED key removes it from the
  buyer reveal (reveal reads `status = "assigned"` only) — it cannot un-see
  a key a buyer already copied, and the code says so.
- Assignment is exactly-once per `(assignedItemId, unitIndex)` (unique pair =
  the claim, mirroring gift-card issuance), with an optimistic
  `updateMany(status = "available")` claim inside; double-assignment is
  proven impossible under forced interleaving. Assignment happens at the
  delivery-gated reveal (`digitalAccess`, after `digitalDelivered` passes) —
  there is no separate delivery event choke point for native digital orders;
  the gate IS the delivery proof, the same surface AB2's reveal lives on.
  Pool shortages are reported honestly (`licenseShortages`: needed/assigned)
  and never block the file reveal (assignment is failure-isolated there).
- `Product.digitalDeliveryType` (`file` default | `license` | `both`),
  validated at product save; default preserves pre-AB5 behaviour
  byte-identically for existing products.

### Signed expiring downloads
- The reveal no longer returns the raw stored file URL anywhere. For
  file/both lines it mints a per-item token and returns
  `downloadPath = public/shop/:orgSlug/orders/:orderId/digital-download?token=…`
  + `expiresAt`.
- **Token design:** `base64url(JSON {o, i, e}) + "." + base64url(HMAC-SHA256)`,
  mirroring `common/admin-token.ts` (same secret source:
  `JWT_SECRET ?? "dev-secret"` — a deployment without JWT_SECRET signs with
  the same dev fallback the admin token already uses; production sets
  JWT_SECRET). Lifetime = `Product.digitalLinkExpiryHours ?? 72` hours.
- `GET …/digital-download` re-validates everything at download time:
  signature + expiry (timing-safe), token↔order↔org match, the item still
  on the order, the product still digital with a file URL, and the order
  still delivered. **Per-item limit:** the item's own product
  `digitalAccessLimit` is enforced against the NEW per-item
  `OrderItem.digitalAccessCount` (incremented on each validated download) —
  items are independent (item A at its limit never blocks item B; spec).
  Semantics mapping: the pre-AB5 rule took the MINIMUM limit across the
  order's digital products against one order-level counter; AB5 enforces
  each product's limit against its own item counter, and the order-level
  counter keeps incrementing at reveal for legacy reads. On success the
  endpoint 302-redirects to the stored file URL — that redirect is the only
  place the raw URL leaves the server, at download time, to the entitled
  buyer only. Every failure (tampered, expired, cross-order, not delivered,
  limit) returns the same generic Bengali 403 page; no check is ever named.
- Side effect handled by the coordinator: the new public route tripped the
  GB9 public-docs **drift guard**; per the guard's own rule the route was
  deliberately added to the frozen inventory (`52cf366`), which also puts
  it in the introspection-built OpenAPI doc. The public quote routes live
  on a separate controller outside that guard's four-controller scope
  (unchanged from GB9's design).

## AX10 — Meta catalog sync lifecycle

- **API basis:** the existing manual push already posts to Meta's Catalog
  batch endpoint (`/{catalog_id}/batch`, `item_type: "PRODUCT_ITEM"`) with
  per-request `method: "CREATE"` and `retailer_id` identity. AX10 extends
  the SAME endpoint in kind: the builder also emits `UPDATE` and `DELETE`
  methods (DELETE carries `retailer_id` + empty `data`), commented in code.
  No endpoint was invented; no live Meta call was made (see limits).
- **Variant payloads:** a product with variants now pushes one item per
  variant — `retailer_id = variant.sku ?? <base>--v<variant.id>`,
  `item_group_id = <base retailer id>`, variant price/stock win over the
  product's. A variant-less product's CREATE payload is field-for-field
  the pre-AB5 shape (spec-pinned). The manual push keeps its button,
  refusal rules and summary shape (additively gains `items`), and writes
  NO sync records.
- **Change-driven sync:** `ProductsService` write choke points (create /
  update / archive / variant create-update-delete) call
  `CatalogsService.noteProductChanged` failure-isolated after success
  (direct optional injection, mirroring the EC3 CatalogPushService posture;
  module graph verified acyclic). Enqueue happens ONLY for catalogs with
  `autoSync = true` (new per-catalog flag, default FALSE — manual push
  stays the default behaviour). Pending rows collapse per (catalog,
  product) with a **delete-sticky** rule (a delete is never overwritten by
  a later update) and snapshot the retailer id at enqueue time so a DELETE
  still knows its external id after the row is gone.
- **Sweep:** job `catalog_sync_sweep` (per-org template, 10 min) drains
  pending records oldest-first (100/run/catalog): attempts increment up
  front; a create/update whose product is gone or no longer ACTIVE is
  converted to a DELETE; missing BusinessProfile website fails payload
  records with `website_missing` while DELETEs still proceed; after 3
  attempts a record is `failed` with the Meta error sample (≤ 500 chars)
  kept in `lastError`. Each drained catalog is stamped with
  `lastSyncAt`/`lastSyncSummary { via: "auto_sync", … }`.
- **Surfaces:** catalog PATCH (autoSync + staff-entered Page/IG id+name,
  null clears), register/create accept the same linkage fields, sync-status
  endpoint (pending/failed/done counts + last summary), per-product sync
  state endpoint (latest auto-sync record, or `never_queued`;
  `basis: "auto_sync_records"` — manual pushes remain catalog-level state,
  stated in the payload). The audiences-page catalog cards show the
  linkage or "সংযুক্ত পেজের তথ্য নেই" — nothing is looked up or invented.

## Gates (run by the coordinator personally, exit-code verified)

| Gate | Result |
|---|---|
| API jest (6 chunks, `--runInBand`) | **386 suites / 4,272 tests — all pass** (baseline 382/4,159; +162 AB5 tests: AX7 35, AX8 46, AX9 49, AX10 32). Two in-chunk failures resolved honestly: the known `cx3-debounce` timing flake (1 test; passes 3/3 standalone re-runs; AB5 touches zero inbox/AI lines — `git diff` over those paths is empty) and the GB9 drift guard (2 tests; real AB5-caused break, fixed in `52cf366`, re-run 7/7). |
| API tsc | exit 0 |
| Web vitest | **462/462** (baseline 462 — no web test regressions; no lib-signature changes required new tests) |
| Web tsc | exit 0 |
| Full build `pnpm -r build` | exit 0 (7/7 projects incl. both Next builds) |
| prisma validate | exit 0 |
| Fresh-DB (throwaway PG16 cluster) | **178/178 migrations applied clean, 269 public tables**; all 8 new AB5 tables + new columns verified via information_schema; post-deploy `migrate diff` contains **zero** AB5 identifiers (only the pre-existing historical artifacts remain, as in GB8). Cluster dropped after. |

## Deploy notes
- Run migration `20261017050000_ab5_b2b_bundles_digital_catalog` (additive; no
  backfill needed — new columns are nullable or defaulted).
- Enable the `catalog_sync_sweep` job per org for merchants who turn on a
  catalog's autoSync; nothing syncs anywhere until BOTH are on.
- Quote sends ride the existing Email/SMS provider configuration; the
  digital-download HMAC rides the existing JWT_SECRET.

## Honest limits
- **No live Meta call was made** — catalog sync (manual variant push +
  lifecycle sweep) is proven at client-stub/spec level only; Meta may
  still reject shapes in production (M30-style live verification owed,
  incl. one real catalog push with variants + one archive-delete).
- **No live quote send** — SMS/email delivery is provider-stub level;
  `sentVia` honesty is spec-proven, not live-proven.
- Variant deletions are not individually tracked: removing a variant
  enqueues a product UPDATE (the remaining variants re-push); a variant
  removed since the last sync can linger on Meta until a full manual
  push. Archived-product DELETEs cover base + all current variant ids.
- License assignment happens at the buyer's first post-delivery reveal,
  not at the delivery transition itself (no such choke point exists for
  native digital orders) — staff pool counts therefore show keys as
  available until the buyer opens the reveal.
- Stock movements (inventory writes) do not enqueue catalog sync — Meta
  availability refreshes on the next product/variant write, sweep of a
  queued change, or manual push.
- Group price lists do not apply inside manual staff orders (staff prices
  are authoritative there) and are not shown as a PDP "your price" hint;
  both are scoped decisions documented above, not oversights.
- Nothing in AB5 is deployed: the migration has never run on a real DB
  and no AB5 surface is live-proven.
