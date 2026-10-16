# AB3 (AX4) — Multi-Warehouse Stock: Design Note

*Written and committed BEFORE any schema/code work, per the batch
brief. Everything in §1 was verified by reading the code at HEAD
`d6a58e7` (175 migrations). Where reality differs from the brief's
assumptions, the deviation is named and the design follows the
REALITY.*

## 1. Current stock reality (code-verified)

### 1.1 The counters and the ledger
- The org-global truth today is `Product.stockQuantity Int?` and
  `ProductVariant.stockQuantity Int?`. **Null = untracked**: order
  placement skips untracked rows entirely, with NO product↔variant
  fallback (a tracked product with an untracked variant does not
  fall back, and vice versa). Negative balances are recorded
  truthfully (COD oversell is real); nothing clamps at zero.
- `StockMovement` is the explanatory ledger: (organizationId,
  productId, variantId?, delta, balanceAfter = the GLOBAL balance
  after, reason, orderId?, actorUserId?, note?). It has **no binId**
  today.
- `InventoryService` (apps/api/src/inventory/inventory.service.ts)
  is the ONE writer of order-driven stock changes (its own header
  says so, and the call-site census confirms it). Its mutation
  methods:
  - `applyOrderPlaced` — deducts at placement; idempotent per
    (orderId, reason="order_placed", productId, variantId);
    preorder lines skipped; bundle components decremented one
    level under reason "bundle_component" by
    `decrementBundleComponents`.
  - `applyOrderRestore` — Phase A replays the placed movements
    exactly (never the order's current items); Phase B
    (`applyRestoreNetting`) nets "order_edit" movements against
    the placed family per (product, variant) key.
  - `applyOrderEditDelta` (+ `editBundleComponents`) — ON3 item
    edits, reason "order_edit".
  - `recordStockTransfer` — **DEVIATION FROM BRIEF**: this name is
    already taken. It is ON3 order-surgery bookkeeping (split /
    merge): it writes PAIRED ledger movements (+qty on the source
    order under "order_edit", −qty on the target under
    "order_placed") and **changes no balance** — the deduction
    stays attributed to whichever bins the original placement
    used; only the claiming order changes. AB3 does not rename or
    repurpose it; warehouse transfers use NEW movement reasons
    ("transfer_out" / "transfer_in") and a NEW `StockTransfer`
    model.
  - `adjust` — the single choke point for manual adjustment
    (incl. the GB2 damage/lost vocabulary), purchase-order
    receive ("purchase_receive"), stock-count close
    ("stock_count"), return restock ("return_restock") and AI
    proposals. Callers: inventory.controller, products.service
    (tracked-row stock edits — product update already routes
    stock changes on tracked rows through `adjust(setTo)`),
    purchasing.service, returns.service, warehouse.service,
    ai/proposals.service.
  - `recordSyncedStock` — ledger-only "sync_correction" when an
    external store sync overwrites a tracked balance; the CALLER
    writes the synced global value itself (the store is the
    source of truth). Baseline rule: null→value or value→null
    writes no movement (establishing/removing tracking is not a
    delta).
- **DEVIATION FROM BRIEF — transactions**: `InventoryService`
  contains NO `$transaction` anywhere; every mutation is a
  straight-line sequence of awaits on the root Prisma client
  (global write, then movement create, then failure-isolated
  alerts/push). The `$transaction` pattern DOES exist in this
  codebase (AB1 loyalty `postEntry` uses
  `(prisma as any).$transaction(async (tx) => …)`). AB3 adopts
  the loyalty pattern for the writes it adds/touches (§3) rather
  than retrofitting ambient transactions into the whole service —
  and says so plainly instead of claiming a property the S1
  service never had.

### 1.2 Deduction timing — uniform, at placement
Every order path funnels through `IntegrationsService.upsertOrder`,
whose S1 hook calls `applyOrderPlaced` on create and
`applyOrderRestore` on transition to cancelled/failed/returned:
native shop checkout (storefront.service), single-product
(products.service), landing (landings.service — which ALSO calls
`applyOrderPlaced` directly for its upsell line), POS
(pos.service), staff manual orders (orders.service), subscription
orders, CSV order import, WooCommerce/Shopify sync. Inbox chat
orders call `applyOrderPlaced` directly (inbox.service). Returns
restock additionally flows through `returns.service` →
`adjust("return_restock")` for received items and
`courier.service` → `applyOrderRestore(..., "order_returned")`.
**There is exactly one deduction moment — placement — and AB3
preserves it on every path.** Fulfillment (EC9 PickWave in
fulfillment-excellence.service, shipments in fulfillment.service)
moves NO stock; it only reads orders. Allocation therefore
attaches at placement, and re-allocation (§5.3) is a
balance-attribution move, never a second deduction.

### 1.3 Warehouses, bins, assignments, counts (EC21)
- `Warehouse` (name, address?, isDefault, active) — **no priority,
  no serviceDistricts today**. `BinLocation` (warehouseId, code —
  unique per warehouse). `ProductBinAssignment` — the ONE primary
  bin of a (product, variant) inside ONE warehouse;
  @@unique([warehouseId, productId, variantId]); **carries NO
  quantity** — it is a pointer, not a balance.
- `StockCountSession` is already warehouse-scoped
  (warehouseId required) with an OPTIONAL binLocationId scope.
  Lines snapshot `systemQty` = the GLOBAL counter at creation;
  closing applies counted lines through `adjust` (reason
  "stock_count"). Uncounted lines are skipped, never zeroed.
- Warehouse CRUD + bins + assignments + counts live in
  apps/api/src/warehouse/ (controller routes under
  `commerce/warehouses…`, `commerce/bin-assignments`,
  `commerce/stock-counts…`); dashboard UI at
  apps/web/src/app/dashboard/commerce/warehouse/page.tsx.

### 1.4 Reservations (GB2)
`StockReservation` (organizationId, sessionRef = StoreCart id,
productId, variantId?, quantity, state active|consumed|released,
expiresAt) — **no binId**. Written only by
`InventoryService.syncCartReservations` (on cart mutation, only
when the org's `reserveMinutes > 0`; a line reserves
min(quantity, on-hand)) and settled by `settleCartReservations`
(checkout → consumed). Expiry is LAZY: readers
(`reservedQuantity`, `activeReservationTotals`,
`checkAvailability`) count only rows with expiresAt > now; there
is no sweep. `checkAvailability` — the ONE availability verdict
for shop cart, single-product and landing — is org-global:
on-hand − OTHER sessions' active reservations; allowBackorder ON
short-circuits to ok; preorder/untracked always ok.

### 1.5 Readers that must keep working untouched
Storefront `stockStateOf` (from global counters via
`effectiveStock`), EC33 inventory intelligence (velocity from
StockMovement deltas + OrderItem reads), ON7 profit/costing, the
GB2 damage report (movements filtered by DAMAGE_REASONS), product
feeds, catalog push (EC4 absolute-balance push on local changes).
None of these read bins; AB3 changes none of their inputs'
meanings. New movement reasons ("transfer_out", "transfer_in",
"reallocation_out", "reallocation_in") are chosen to be OUTSIDE
every existing reason family (restore replays only
order_placed/bundle_component; netting adds order_edit; damage
report only DAMAGE_REASONS; EC33 velocity keys off the
order_placed family) — §7 pins this with a spec.

### 1.6 Absolute writes that bypass the movement choke point
- Product/variant CREATE with an initial stockQuantity
  (products.service, imports.service) — establishes tracking; no
  movement by design (same baseline rule as sync).
- External catalog sync (integrations/shopify) overwrites the
  global counter and calls `recordSyncedStock` for the ledger.
- Product EDIT on a tracked row already routes through
  `adjust(setTo)` (products.service S1 branching); edit on an
  untracked row establishes tracking directly.
AB3 handles all three via seeding (§4.3), never by rewriting
those flows.

## 2. Target model (schema)

- `StockBalance` — (id, organizationId, productId, variantId?,
  binId, onHand Int, reserved Int @default(0), timestamps).
  The per-location truth. Uniqueness per
  (organizationId, productId, variantId, binId) is enforced by
  **two partial unique indexes in the migration SQL** (one WHERE
  variantId IS NOT NULL, one WHERE variantId IS NULL), because
  SQL treats NULLs as distinct in a plain unique index — the
  AB1 partial-index precedent. Prisma declares no @@unique for
  it (a plain one would be wrong); the service always goes
  through find-then-write inside a transaction.
- `StockAllocation` — (id, organizationId, orderId, orderItemId?,
  productId, variantId?, binId, warehouseId, qty Int,
  status: active | settled, timestamps). The CURRENT claim state
  of an order's deduction: which bins its already-deducted units
  are attributed to. Bundle-component allocations carry
  orderItemId = null (components are not order items).
  Allocations are settled when the order is restored; they move
  (never duplicate) on split/merge and on staff re-allocation.
- `StockTransfer` — (id, organizationId, fromBinId, toBinId,
  status: draft | in_transit | received | received_with_variance
  | cancelled, createdById, dispatchedAt?, receivedAt?, note?,
  timestamps) + `StockTransferLine` (transferId, productId,
  variantId?, qtySent, qtyReceived?). In-transit quantities live
  ONLY on the transfer lines — in neither balance.
- `StockMovement.binId String?` — the bin a movement's delta is
  attributed to (null for pre-AB3 rows and for movements whose
  flow has no bin attribution). balanceAfter keeps its existing
  meaning: the GLOBAL balance after.
- `StockReservation.binId String?` — the bin the reservation
  holds against (resolved at reserve time).
- `Warehouse.priority Int @default(0)`,
  `Warehouse.serviceDistricts Json?` (array of BD district names,
  the ON11/BD_DISTRICTS vocabulary).
- Migration: `20261017030000_ab3_multi_warehouse` (AB1 took
  17010000, AB2 17020000). Additive only, plus the §4 backfill.

## 3. The consistency invariant

For every organization and every TRACKED stock row
(product-level: variantId null; variant-level: that variant):

    Σ StockBalance.onHand over all bins  ==  the global counter

- **Writers**: every mutation that changes a global counter ALSO
  changes balances by the same net delta, inside ONE Prisma
  interactive transaction (loyalty pattern) covering
  {global write, balance writes, movement writes, allocation
  writes} for that line/operation. Failure-isolated side effects
  (low-stock / out-of-stock alerts, catalog push, EC28 event)
  stay OUTSIDE the transaction, after it, exactly as today.
- **Untracked rows** (counter null) never have balance rows and
  are skipped by every bin path — the same no-fallback rule as
  S1 (a variant-level deduction never touches product-level
  balances, and vice versa).
- **Missing-table tolerance**: the bin layer follows this
  service's existing pattern (see `reservedQuantity`): if the
  StockBalance table is absent (pre-migration fakes, older spec
  constructions), the bin layer no-ops and behaviour is
  byte-identical to today. With the migration applied the layer
  is fully active. This is stated, not hidden: the invariant is
  a property of the migrated system, proven by the AB3 spec
  suite (§8) whose fake implements the bin tables.
- **reserved** on StockBalance is a maintained counter, NOT part
  of the onHand invariant: it is recomputed per bin from the
  active, unexpired reservation rows at every reservation
  mutation (create/adjust/release/settle) for the affected bins
  and lazily corrected on balance reads — because expiry is
  lazy, a stored counter without recompute would drift; the
  recompute is the design, and the spec asserts
  reserved == Σ active unexpired reservations per bin after
  every reservation operation.

## 4. Default-bin resolution + backfill

### 4.1 The one resolver
`resolveDefaultBin(orgId, productId?, variantId?)`:
1. The ProductBinAssignment for (product, variant) — prefer the
   assignment in the org's default warehouse, else the earliest
   assignment — → its bin.
2. Else the org's default warehouse (isDefault, else earliest
   active warehouse) → its earliest-created bin.
3. Else lazily create "Main Warehouse" (isDefault) + "Main Bin"
   for the org and use that bin.
Every bin-aware entry point that lacks an explicit bin uses this
resolver and nothing else.

### 4.2 Warehouse ordering for allocation (§5)
Candidate warehouses = the org's ACTIVE warehouses, ordered:
(1) district match first — the warehouse whose serviceDistricts
contains the order's district (§5.1); (2) priority ASC (lower
number = served first); (3) isDefault first; (4) createdAt ASC.
Within a warehouse, bins are drawn: assignment bins for this
(product, variant) first (createdAt ASC), then other bins by
onHand DESC (draw from the fullest — consolidation), then code
ASC for determinism.

### 4.3 Backfill rule
For every tracked product row: one StockBalance at the resolved
default bin with onHand = the product counter. For every tracked
variant row: one StockBalance at the variant's resolved default
bin with onHand = the variant counter. reserved starts 0 (live
reservations pre-date bin attribution; their rows keep
binId = null and keep counting in the org-global availability
math exactly as today — the first post-deploy
syncCartReservations for a cart stamps bins going forward).
Implemented TWICE, same rule: (a) in the migration SQL (CTEs
implementing §4.1; creates Main Warehouse/Main Bin for orgs that
have tracked stock but no warehouse/bin at all; safe on an empty
DB — zero rows in, zero rows out); (b) as an idempotent service
method `backfillStockBalances(orgId?)` + a runnable script
(apps/api/scripts/), so a deploy can re-run it post-migrate and
the sandbox gate can fixture-prove the rule even where the SQL
itself cannot be executed. Seeding also happens lazily: the
first bin-aware mutation for a tracked row with NO balance rows
seeds the default bin with the PRE-mutation global counter
before applying its delta — so products created by imports or
catalog sync (§1.6) join the invariant at their first inventory
mutation even if the backfill never ran for them.

## 5. Allocation (order deduction)

### 5.1 When and how
Inside `applyOrderPlaced`, for each line that actually deducts
(tracked, non-preorder, not already placed): the deduction is
planned across bins BEFORE the writes: candidates per §4.2,
with the order's district derived exactly the way fulfillment
already derives it (structured address district, else
`parseBdAddress` over the address text — fulfillment-excellence
`districtOf` is the pattern; the order row is loaded alongside
its items). The plan draws each bin down to zero before falling
through to the next warehouse. If ALL bins together still lack
stock (backorder/oversell — a real posture in this codebase),
the remainder draws the FIRST candidate warehouse's resolved
default bin negative. The global write, one StockMovement per
(line × bin drawn) with binId set, the balance writes and the
StockAllocation rows all land in the line's transaction.
**Idempotency is unchanged**: the existence check stays keyed
(orderId, "order_placed", productId, variantId) WITHOUT binId —
a re-run skips the line exactly as today; in the single-bin
world (every existing spec, every org before it creates a
second warehouse) the movement count is identical to today.
Bundle components: drawn by the same rule (their own candidate
walk), allocations with orderItemId = null, movements as today
plus binId.

### 5.2 Restore, edits, split/merge
- `applyOrderRestore`: the GLOBAL replay/netting math is
  untouched. The BIN side returns each key's restored quantity
  across the order's CURRENT active StockAllocation rows for
  that key (in allocation order) — current, because re-allocation
  and split/merge may have moved the claim since placement —
  falling back to the default bin for any remainder (pre-AB3
  orders have no allocations). The order's allocations are then
  settled. Netting diffs: a positive diff returns across the
  same allocation rows; a negative diff draws by the §5.1 rule.
- `applyOrderEditDelta`: positive deltaQty draws more by the
  §5.1 rule (allocations extended); negative releases back into
  the order's allocation bins in REVERSE allocation order
  (allocations shrunk). Bundle-component edits mirror this.
- `recordStockTransfer` (ON3 split/merge): balances — global AND
  per-bin — do not move (the stock never moved; the claim did).
  The StockAllocation rows for the transferred lines are
  re-pointed to the target order (split) or merged (merge), and
  the paired ledger movements it already writes gain the binId
  of the allocation rows they move. Its counts and global
  behaviour are unchanged.

### 5.3 Staff re-allocation
Staff can re-allocate an order's active allocations to a chosen
warehouse (order detail / fulfillment surface). Mechanics: for
each active allocation row of the order, the qty is credited
back to its current bin and drawn from the target warehouse by
the §4.2 within-warehouse bin order (falling to negative in the
target warehouse's resolved default bin if it lacks stock —
same oversell honesty), allocation rows are re-pointed, and a
paired movement set (reason "reallocation_out" / 
"reallocation_in", delta ∓/± qty, balanceAfter = the unchanged
global) explains the attribution move. NO global counter moves;
NO order_placed/order_edit movement is touched, so restore
math (which reads only those families) is unaffected — restore
reads the CURRENT allocations (§5.2), which is exactly why
re-allocation is safe. Refused for orders with no active
allocations or already restored/settled claims; audited.

### 5.4 POS and other paths
POS, manual, chat, subscription and synced orders all deduct
through the same `applyOrderPlaced`, so all get §5.1 allocation
with no per-path code. POS terminals have NO per-terminal bin
configuration in AB3 (explicitly future); POS orders allocate
by the same rule as every other order (district from the POS
order's address if any, else priority order). This sharpens the
brief's "POS draws from the default bin": with one warehouse —
the default state — the rule's result IS the default bin.

## 6. Movements, counts, transfers, reservations

- `adjust` gains an optional explicit binId (validated to belong
  to the org). Without one, the delta (or setTo difference) posts
  to the resolved default bin. With one (the damage/lost UI
  picker, bin-scoped counts), it posts there. The setTo semantics
  stay global (the counter is set; the ADDRESSED bin absorbs the
  difference so Σ holds).
- `recordSyncedStock`: the sync delta posts to the resolved
  default bin (the external store has no bin concept; its delta
  lands in the default bin and the distribution otherwise
  survives). Baseline rule unchanged (no movement, no bin write
  when tracking is established/removed or values are equal —
  establishment is covered by lazy seeding, §4.3).
- Stock counts: a session WITH binLocationId becomes truly
  bin-scoped — its lines are the products with balances (or
  assignments) in that bin, `systemQty` snapshots the BIN's
  onHand, and closing posts the variance through `adjust` with
  that binId (reason "stock_count"). A session WITHOUT a bin
  keeps today's exact behaviour (global snapshot; variance via
  adjust to the default bin). Bin-scoped is the recommended norm
  in the UI; warehouse-wide counts remain possible because the
  EC21 model already allows them — documented, not removed.
- Warehouse transfers (NEW `StockTransfer` service in the
  warehouse module, writing through InventoryService so the
  ledger stays single-writer): create (draft; no stock moves) →
  dispatch: per line, the fromBin balance is decremented and a
  "transfer_out" movement written (global counter UNCHANGED —
  transfers never touch Product.stockQuantity; the invariant is
  per-bin: Σ onHand drops by the in-transit qty while in transit
  and the transfer lines carry that qty — stated plainly: while
  a transfer is in_transit, Σ balances + Σ in-transit ==
  global). The §3 invariant is therefore asserted for a system
  with no in-transit transfers, and the acceptance spec asserts
  the extended form with one. → receive: qtyReceived (≤ qtySent,
  partial allowed) increments toBin with "transfer_in"; the
  variance (sent − received) is recorded on the line and, when
  received with variance outstanding, the transfer closes as
  received_with_variance — the variance units are GONE (lost in
  transit) and are NOT silently returned to any bin; they are
  visible on the transfer and in the stock-by-location report's
  in-transit/variance figures. Cancel: from draft (nothing to
  undo) or from in_transit BEFORE any receive (quantities return
  to fromBin, "transfer_in" movement back into fromBin with the
  transfer as its reference). All transitions audited;
  dispatch/receive refuse untracked rows and over-draws beyond
  the fromBin balance (a transfer is a physical claim — unlike
  order oversell it may NOT drive a bin negative).
- Reservations: `syncCartReservations` resolves ONE bin per
  stock row (assignment → default resolver) and stamps it on the
  reservation rows it creates/updates; the reserved counter of
  that bin is recomputed (§3). A reservation caps at
  min(quantity, that bin's onHand − other sessions' reservations
  on that bin) — never promising stock the bin does not have;
  org-global availability (`checkAvailability`) is UNCHANGED
  (it still reads reservation rows org-wide, bins or not), and
  shop availability display stays org-global. Lazy expiry
  "releases the bin" via the §3 recompute (no sweep added).

## 7. What does NOT change
- Deduction timing on every path (§1.2); S1 idempotency keys,
  counts ({decremented, skipped}, {restored, skipped}) and the
  no-fallback untracked rules.
- All readers in §1.5 — storefront stockState, EC33, ON7, feeds,
  damage report, catalog push (absolute GLOBAL balances pushed,
  as today).
- Plan limits / usage (GC22 storage is bytes, unrelated).
- `checkAvailability` semantics and every checkout's behaviour.
- The ON3 surgery flows' global behaviour; EC21 warehouse/bin/
  assignment CRUD shapes (fields only added).
- No new per-org job. No push (owner-gated, as always).

## 8. Proof plan (specs)
New suite `apps/api/src/inventory/ab3-multi-warehouse.spec.ts`
(fake-Prisma makeTable harness, extended with the new tables +
a `$transaction` passthrough) asserting, after EVERY operation
type: Σ balances == global (and the §6 extended form while a
transfer is in transit):
receive (adjust +), manual adjust −, damage adjust, setTo
adjust, order placement (single-bin AND district-routed AND
spanning-two-warehouses), bundle placement, order restore
(cancel + return, incl. after a re-allocation), edit delta +/−,
split transfer (recordStockTransfer), sync correction,
reservation create/adjust/release/expire (reserved counter),
warehouse transfer dispatch/partial-receive/variance/cancel,
stock-count close (bin-scoped + warehouse-scoped), backfill
(service form) on a seeded fixture, resolver pinning
(assignment → default warehouse → lazy Main), re-allocation
refusals + audit. Plus: new movement reasons are outside the
restore/netting/damage/velocity families (§1.5 pin), and the
legacy inventory suites (inventory, gb2-inventory, on3-delta,
ec21-board, ec-cp4-restock) pass UNMODIFIED — the single-bin
world is byte-identical.

## 9. Surfaces
- Warehouse dashboard page: per-warehouse/bin balances table
  (product × bin onHand/reserved, org-global total beside it),
  transfers list + create/dispatch/receive/cancel UI, warehouse
  priority + serviceDistricts editor, stock-count bin picker
  (already in the EC21 DTO; the page gains the balances-driven
  line source), assignment UI unchanged.
- Order detail + PickWave board: per-line allocation
  (warehouse + bin code) from StockAllocation; re-allocation
  action (warehouse picker) on the order detail.
- Stock-by-location report: a section in the warehouse area —
  per product × warehouse onHand/reserved/in-transit totals,
  CSV export (the finance/reports exporter pattern is
  orders-side; this one is a simple CSV download from the
  warehouse endpoint, stated as such).
- API additions (all org-scoped, WRITE_ROLES-guarded, audited):
  warehouse PATCH gains priority/serviceDistricts; GET
  commerce/stock-balances; transfers CRUD + dispatch/receive/
  cancel under commerce/stock-transfers; POST
  commerce/orders/:orderId/reallocate; GET
  commerce/stock-by-location + .csv. Order detail payload gains
  per-item allocations; PickWave order payload gains per-line
  allocation labels.
