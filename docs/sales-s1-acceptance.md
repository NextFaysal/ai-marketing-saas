# Sales & Data S1 — Inventory Movement: Acceptance

Package plan: `docs/sales-data-package-plan.md` (S1 of S1–S6).
Schema: `StockMovement` ledger model + `Product.lowStockThreshold Int?`.
Migration: `packages/db/prisma/migrations/20261010840000_s1_inventory_movement/migration.sql`
— applied with `prisma migrate deploy` and verified in the sandbox
database (`\d "StockMovement"` shows the table + both indexes;
`Product.lowStockThreshold` present); Prisma client regenerated.

Before S1, `Product.stockQuantity` was display-only: orders never
decremented it, manual edits left no trace, store syncs silently
overwrote it, and nothing alerted on low stock. S1 makes
`InventoryService` (`apps/api/src/inventory/`) the one writer of
order-driven stock changes, with a StockMovement row explaining
every change.

## Hook-point coverage

| Path | Hook | Covered? |
| --- | --- | --- |
| Woo sync + Woo webhook → `IntegrationsService.upsertOrder` (created branch, after items written) | `applyOrderPlaced(org, orderId, { status })` — items loaded from DB, variant via SKU rule | ✅ |
| Shopify sync + Shopify webhook → same `upsertOrder` | same hook | ✅ |
| Manual orders (`OrdersService.createManual`) → `upsertOrder` source `manual` | same hook | ✅ |
| Orders CSV import → `upsertOrder` source `csv` | same hook | ✅ |
| Chat orders → `InboxService.createChatOrder` (bypasses upsertOrder) | `applyOrderPlaced` right after items are created, with explicit lines incl. the in-scope internal `variant.id` | ✅ |
| Store order status change → `upsertOrder` update branch (`prevStatus` captured before the overwrite) | `cancelled`/`failed` → `applyOrderRestore(..., "order_cancelled")`; `returned` → `applyOrderRestore(..., "order_returned")` | ✅ |
| Courier return → `CourierService.syncShipment` status update | new status `returned` and pre-update status ≠ `returned` → `applyOrderRestore(..., "order_returned")`. The second `courierShipment.update` site (in `notifyCustomer`) writes only `lastNotifiedStatus`, never `status`; bulk sync (`syncAll`) funnels through `syncShipment`, so this one hook covers single + bulk sync exactly once | ✅ |
| Woo product sync → `IntegrationsService.upsertProduct` update branch | `recordSyncedStock(org, productId, null, existing.stockQuantity, incoming)` before the overwrite | ✅ |
| Woo variations → `IntegrationsService.upsertVariant` existing branch | `recordSyncedStock(org, productId, variantId, existing, incoming)` before the overwrite | ✅ |
| Shopify variants → `ShopifyService.upsertVariants` existing branch | same `recordSyncedStock` call | ✅ |
| Shopify product-level stock → `upsertProduct` (Shopify funnels here) | product-level hook above | ✅ |
| Manual product edit → `ProductsService.update` | branching — see below | ✅ |
| Manual stock correction (new) | `POST organizations/:organizationId/products/:productId/stock-adjustment` → `InventoryService.adjust` | ✅ |
| Movement history (new) | `GET organizations/:organizationId/products/:productId/movements` → `listMovements` | ✅ |

Every hook call is failure-isolated (try/catch + `Logger.warn`,
or `.catch`): an inventory failure NEVER breaks an order upsert,
a product sync, a chat order, or a courier sync. The trade-off is
deliberate and documented here: a failed hook leaves stock
temporarily unexplained (no movement) rather than losing the
order — the order is the revenue record; stock can be reconciled
with a manual adjustment, which itself writes a movement.

## Idempotency rules

- `order_placed`: at most one movement per
  `(orderId, reason="order_placed", productId, variantId)`.
  Re-running placement (sync retry, webhook redelivery, a second
  `applyOrderPlaced` call) skips lines that already have a placed
  movement — no double decrement.
- Restore: at most one restore per `(orderId, productId,
  variantId)` across BOTH restore reasons. `applyOrderRestore`
  first returns early if a movement with the same
  `(orderId, reason)` exists; per line it then checks restores
  under either reason — an order cancelled (restored) and later
  also reported returned restores nothing the second time.
- Restore replays the PLACED movements' exact quantities
  (`+|delta|`), never the order's current items: items are fully
  replaced on every store upsert, so by cancel time they may say
  anything (proven by spec: items edited to qty 99 after a qty-3
  placement restore exactly +3).

## Variant resolution rule

OrderItem carries NO internal variantId column (only
`externalVariationId`). For store-order items loaded from the DB:
if the item has an `externalVariationId` OR a `sku`, and the sku
is non-null, resolve
`productVariant.findFirst({ where: { productId: item.productId, sku: item.sku } })`.
Found → the movement is variant-level; not found → product-level.
Chat orders skip resolution: `createChatOrder`'s DTO lines already
carry the internal product + variant objects resolved in scope,
and the hook passes `variant.id` explicitly. (The created
OrderItem still does not persist an internal variantId — unchanged
from before S1; the movement records it instead.)

## Untracked semantics

`stockQuantity === null` means NOT TRACKED, at whichever level:

- Placement: an untracked product line is skipped (no movement).
  A line with a variant whose `stockQuantity` is null is skipped
  and does NOT fall back to the product row (the product row may
  aggregate other variants); a product-level line never touches
  variants.
- Restore: if the target row's stock has become null since the
  sale, that line is skipped — there is no honest balance to add
  back onto.
- Manual adjust: adjusting an untracked product/variant is a 400
  ("এই পণ্যের স্টক ট্র্যাক করা হচ্ছে না — আগে পণ্যের স্টক সংখ্যা
  বসান") — set a stock count first (product edit), which is a
  baseline, then adjust.

## sync_correction decision + baseline rule

Store sync remains the source of truth for synced products: the
caller (upsertProduct / upsertVariant / Shopify upsertVariants)
still writes the synced value itself. `recordSyncedStock` only
EXPLAINS the jump: when both the previous and incoming values are
non-null and differ, it writes
`{ delta: incoming − previous, balanceAfter: incoming, reason: "sync_correction", note: "store sync", actorUserId: null }`.

Baseline rule: `previous == null` (stock becomes tracked),
`incoming == null` (stock becomes untracked), or equal values
write NO movement — establishing or removing tracking is not a
stock delta, and inventing one would corrupt the ledger.
Sync corrections never fire low-stock alerts (the merchant's own
store manages its stock; an alert per sync would be noise).

## Low-stock rule

- Threshold: `product.lowStockThreshold ?? 5`
  (`DEFAULT_LOW_STOCK_THRESHOLD = 5`).
- CROSSING ONLY: an alert fires only when
  `prevBalance > threshold && newBalance <= threshold`.
  Stock already below the threshold staying below never alerts.
- Dedupe: at most one alert per product per Dhaka day, via an
  AuditLog marker — `auditLog.findFirst({ organizationId,
  action: "inventory.low_stock_alert", entityType: "Product",
  entityId: productId, createdAt >= dhakaDayStartUtc(now) })`
  (the CRM C1 dedupe discipline, with `dhakaDayStartUtc` imported
  from `apps/api/src/crm/lead-followups.ts`). The marker audit row
  is written with `userId: null` and metadata
  `{ productId, variantId, balanceAfter, threshold }`.
- Recipients: ACTIVE memberships with role OWNER or ADMIN — one
  `AgentNotification` each, `type: "low_stock"`,
  title `স্টক কম: ${product.name}`, body naming the variant when
  the movement was variant-level, the remaining count and the
  threshold.
- Checked after every placement decrement and every manual
  adjustment. The whole helper is failure-isolated: an alert
  problem never throws into the stock write that triggered it.

## Negative-stock rule

Balances may go negative and are recorded truthfully
(`balanceAfter` can be < 0). COD commerce oversells in reality —
clamping at zero would make the ledger lie and restores would
then over-restore. Nothing in S1 clamps a placement or a delta
adjustment; only `setTo` is validated `>= 0`.

## Manual adjustment rules

`InventoryService.adjust`: exactly one of `delta` / `setTo`
(neither or both → 400, Bengali message). The product must belong
to the org (404 otherwise); a given variant must belong to the
product (404). Writes the row, a `manual_adjustment` movement
(with `actorUserId` + optional note), and an
`inventory.adjusted` audit entry (metadata: productId, variantId,
applied delta, balanceAfter). Runs the low-stock crossing check.

## ProductsService.update branching (verbatim behaviour)

For a `stockQuantity` change in `ProductsService.update`:

- Inventory present AND existing product tracked
  (`existing.stockQuantity != null`) AND value actually changes →
  INVENTORY owns the stock write: `stockQuantity` is excluded
  from the `product.update` data and, after the rest of the
  update, `inventory.adjust(org, actor, id, { setTo, note:
  "পণ্য সম্পাদনা থেকে স্টক হালনাগাদ" })` writes the value +
  movement + audit. (Calling adjust after a plain write would
  double-apply, because adjust computes from the current value.)
- Existing stock is null (untracked → tracked) → plain write:
  a BASELINE, no movement.
- Inventory absent (positional spec constructions) → plain
  write, exactly as before S1.
- `lowStockThreshold` always writes plainly (create + update
  DTOs carry it; it is a setting, not a stock change).

## Web (Products page)

- Stock cell: null → muted "ট্র্যাক হয় না"; otherwise the number
  plus an amber "কম স্টক" badge when
  `stockQuantity <= (lowStockThreshold ?? 5)`. The list serializer
  returns raw rows (`toPublicProduct` spreads the row), so
  `lowStockThreshold` arrives with no serializer change.
- Row action "স্টক সমন্বয়" opens a dialog: current stock,
  variant selector (from the product detail, shown only when the
  product has variants), delta OR setTo input, note, threshold
  input; submits `POST stock-adjustment`; on success the list
  refreshes and the resulting balance is shown.
- The same dialog carries the "স্টক ইতিহাস" section (the page
  has no separate detail/expand area): `GET movements` rendered
  compactly with Bengali reason labels (order_placed = অর্ডারে
  বিক্রি, order_cancelled = বাতিলে ফেরত, order_returned =
  রিটার্নে ফেরত, manual_adjustment = হাতে সমন্বয়,
  sync_correction = স্টোর sync সংশোধন), signed delta,
  balanceAfter, variant name and note.
- The create form gains the threshold input
  ("কম স্টকের সতর্কতা (খালি = ৫)"); the page has no separate edit
  form, so threshold EDITING lives in the stock dialog (PATCH).

## Honest NOT-covered list

- Orders created BEFORE S1 have no `order_placed` movements, so
  their later cancel/return restores nothing (restore replays
  movements; there is nothing to replay — by design, rather than
  guessing from current items).
- `Order.status = "returned"` does not occur from Woo/Shopify in
  practice ("returned" is a CourierShipment status): returns
  restore via the courier shipment sync hook. The upsertOrder
  `returned` branch exists for completeness/other sources.
- Orders whose status moves to `refunded` on update do NOT
  auto-restore: refunds are handled by S2 (order actions /
  refund recording); S1 restores on cancelled/failed and
  returned only, per the package plan.
- A status transition that happens entirely outside
  `upsertOrder` (there is none today — it is the only writer of
  `Order.status`) would not restore.
- Failure isolation means a crashed hook is a warning log, not a
  retry queue: a movement missed during an outage is reconciled
  by a manual adjustment, not replayed automatically.
- Sync corrections record the NET jump between two syncs; stock
  changes the store made and then un-made between syncs are
  invisible (the store only ever reports its current number).
- The low-stock dedupe marker is per PRODUCT, not per variant:
  two different variants of one product crossing on the same
  Dhaka day produce one alert.
- Live HTTP verification is the coordinator's step (not run by
  the implementing agent): evidence here is the service/hook
  specs, the full suites, and the builds below.

## Verification

- `apps/api/src/inventory/inventory.spec.ts`: 27 tests — placement
  (product/variant/untracked/SKU-resolution/negative/dead-status),
  idempotency, restore exactness + cross-reason idempotency +
  untracked skip, low-stock crossing + Dhaka-day dedupe +
  threshold, adjust (delta/setTo/400s/404/audit),
  recordSyncedStock (differ/equal/null transitions), listMovements
  pagination + variant names, and the IntegrationsService hook
  spec (create → decrement, cancel → restore exactly once,
  re-upsert → still once, product sync → sync_correction).
- Full API suite, web tests and the monorepo build: see the
  delivery report accompanying this milestone (run after all
  wiring landed).

## Live verification (coordinator, sandbox, real HTTP + Postgres)

Built API booted on :4100 against the sandbox database; scripted
HTTP run, 17/17 checks PASS:

- register → login → org → product (stock 20, SKU S1-LIVE).
- Manual order (externalRef, SKU-matched item, qty 2) → stock 18;
  movements list shows exactly one `order_placed` (−2, balance 18).
- Same order re-submitted → `updated`, stock still 18 (no double
  decrement).
- Same order re-submitted with status `cancelled` → stock restored
  to 20 with exactly one `order_cancelled` (+2, balance 20);
  a second cancelled re-submit changed nothing.
- `POST stock-adjustment` setTo 7 → 7; delta −3 → 4 (crosses the
  default threshold 5); delta −10 → −6 recorded truthfully
  (negative balance, no clamping); delta+setTo together → 400.
- The 7→4 crossing produced exactly one `low_stock`
  AgentNotification ("স্টক কম: S1 Live Product") and exactly one
  `inventory.low_stock_alert` AuditLog marker in the database;
  the subsequent −6 adjustment (already below threshold) fired
  no second alert.
- Coordinator re-ran the full API suite after integration:
  125 suites / 888 tests PASS; monorepo build green.
