# AB3 (AX4) — Multi-Warehouse Stock: Acceptance

*Batch AB3 of the E-Commerce Advanced Program. Design contract:
`docs/advanced-ab3-design.md` (committed first, `115c8a4`). Built
on branch `completion` over AB2 HEAD `d6a58e7`. LOCAL COMMITS
ONLY — nothing pushed; the migration has NOT run on any real
database.*

## Commits (9)
| Commit | Content |
|---|---|
| `115c8a4` | Design note (Step 0, before any code) |
| `4a29a00` | Schema + migration `20261017030000_ab3_multi_warehouse` + backfill script |
| `89e229a` | Bin layer: resolver, lazy seeding, backfill service, adjust/sync/reservation wiring (+ specs part 1) |
| `8546963` | Order-path allocation: placement/restore/edit/surgery/re-allocation (+ specs part 2) |
| `565cd24` | Warehouse surfaces: priority/serviceDistricts, stock-balances, stock-by-location (+CSV), bin-scoped counts, StockTransfersService |
| `ddf1429` | Allocation reads: order detail `allocations[]`, PickWave order-level allocation labels |
| `4239fd0` | Web: warehouse page (priority/districts editor, balances, transfers UI, count scope labels, by-location + CSV) |
| `d472780` | Web: order-detail allocations + re-allocation action, PickWave allocation chips |
| `c8f57ea` | Coordinator fix: reallocate endpoint response rows labelled (warehouseName/binCode) |

## What was built, per design item

**Model (§2) — as designed.** `StockBalance` (per-bin onHand +
reserved), `StockAllocation` (an order's current bin claims),
`StockTransfer` + `StockTransferLine`, `StockMovement.binId`,
`StockReservation.binId`, `Warehouse.priority` +
`serviceDistricts`. Balance uniqueness is enforced by the two
partial unique indexes from the design (NULL-variant semantics),
proven to reject duplicates on real PG16.

**Invariant (§3) — proven at spec level + real-DB backfill
level.** Every global-counter mutation now also moves balances
by the same net delta inside the loyalty-pattern `$transaction`
(fake-harness fallback keeps pre-AB3 spec constructions
byte-identical). The new suite asserts **Σ balances == global
after every operation type**: adjust +/−/setTo/damage (incl.
explicit-bin and foreign-bin refusal), sync correction, order
placement (single-bin, district-routed, spanning two warehouses,
oversell over-draw, bundle, variant), restore (cancel, return,
spanning, pre-AB3 order without allocations), restore AFTER
re-allocation (into the CURRENT bins — the §1.5 pin), edit delta
+/− (reverse-order release), ON3 surgery transfer (claims move,
balances don't), reservations (create/adjust/release/expire —
reserved counter == Σ active unexpired holds per bin), backfill
(idempotent). Transfers assert the extended form from §6:
**Σ balances + in-transit == global** while in transit, and
**Σ == global − variance** after a variance receive (the
variance units are gone from every balance by design and are
recorded on the transfer lines).

**Backfill (§4) — proven three ways.** (1) Migration SQL on a
fixture DB (slice 1: 8/8 placements exact — assignment-in-default
beats earlier non-default assignment, variant assignment's exact
bin in a multi-bin warehouse, default-bin fallback, Main
Warehouse/Bin creation, untracked-only org untouched); (2) the
runnable script twin (`apps/api/scripts/backfill-stock-balances
.mjs`, dry-run default) produced placements identical to the SQL
and seeded 0 on a second run; (3) the coordinator re-verified
independently at the final gate on a fresh PG16 cluster:
pre-AB3 chain (175 migrations) + fixtures → AB3 SQL → product
balance 20 at the default warehouse's earliest bin, variant
balance 7 at its assignment bin. The idempotent service method
`InventoryService.backfillStockBalances(orgId?)` ships too, and
lazy seeding covers post-migration creations (product/variant
create hooks + seed-on-first-mutation + seed-on-transfer
pre-check).

**Allocation (§5) — as designed, on the preserved timing.**
Deduction stays at placement on EVERY path (the map below is
unchanged from the design note §1.2 — AB3 added bin attribution
inside the one choke point, `InventoryService.applyOrderPlaced`,
so shop cart, single-product, landing (+ its direct upsell call),
POS, manual, chat, subscription, import and Woo/Shopify sync
orders all allocate identically with zero per-path code). The
rule: district-matching warehouse (ON11 parse of the order's
address, the fulfillment `districtOf` pattern) → priority ASC →
default → createdAt; within a warehouse assignment bins first,
then fullest-first; fall-through across warehouses; oversell
remainder over-draws the first candidate's resolved bin
negative (the codebase's truthful-negative posture). Restore
credits the order's CURRENT allocations; edit deltas extend /
release in reverse order; split/merge moves claims only.
Re-allocation (§5.3) is live on
`POST commerce/orders/:orderId/reallocate` with the paired
`reallocation_out/in` movements and audit
`inventory.reallocated`.

**Movements/counts/transfers/reservations (§6) — as designed,
with two code-reality corrections (below).** `adjust` accepts a
validated optional binId; sync corrections post their delta to
the default bin; bin-scoped stock counts snapshot the bin and
post the variance as a bin-addressed delta; warehouse transfers
run the full lifecycle (draft → dispatch with whole-transfer
over-draw pre-check and mid-apply compensation → receive with
per-line received quantities and recorded variance → cancel
returning units), writing stock ONLY through
`InventoryService.applyBinOnlyDelta`; cart reservations resolve
one bin, cap at that bin's promise-able stock, and maintain the
per-bin reserved counter by recompute.

**Surfaces (§9) — delivered.** Warehouse dashboard: priority +
service-district editor (the API validates against the real BD
district vocabulary and stores canonical names), stock-balances
tab (with an honest "বণ্টন হয়নি" badge on synthesized,
not-yet-distributed rows), transfers tab (full lifecycle UI,
Bengali status labels), bin/warehouse count scope labels,
stock-by-location section + authenticated CSV download. Order
detail: allocations grouped per item (bundle components
separately), settled rows labelled, re-allocation action.
PickWave board: per-order allocation chips.

## Deviations from the brief/design (all named in the slices)
1. **Transactions**: `InventoryService` had NO ambient
   transactions (S1 posture). AB3 wraps each mutation's write
   group (global + balances + movements + allocations) in the
   loyalty-pattern interactive transaction rather than claiming
   a service-wide property that never existed. Design note §1.1
   recorded this before code.
2. **`recordStockTransfer`** was already ON3 surgery
   bookkeeping; it keeps its name and global behaviour and only
   gained allocation-claim moves + binId stamps. Warehouse
   transfers are the new `StockTransfer` model with new movement
   reasons (`transfer_out/in`, `reallocation_out/in`) — all
   outside the restore/netting/damage/velocity reason families
   (spec-pinned).
3. **Stock-count close was already delta-based**, not `setTo` as
   the brief assumed: the no-bin path is byte-identical legacy;
   the bin path posts the variance as a bin-addressed delta.
4. **Default-warehouse resolution** (slice-1 SQL + script +
   service resolver all agree): isDefault first, else earliest
   createdAt — WITHOUT the design §4.1 parenthetical "active"
   filter for seeding. Allocation candidates remain active-only
   (§4.2). Only differs for orgs whose earliest warehouse is
   inactive.
5. **PickWave allocations ride at order level** (the wave
   payload carries no per-line items today — the design's
   sanctioned fallback), with orderItemId + (product, variant)
   match keys for line-level consumers.
6. **Balances read** uses a read-only resolver for synthesized
   rows (a read never creates Main Warehouse/Bin rows); the
   stored `reserved` counter is live-corrected and persisted on
   read, failure-isolated.
7. Slice-2 restore groups Phase A per (product, variant) KEY
   (one global write per key, one restore movement per bin
   portion) instead of per-placed-movement replay — required to
   keep the external {restored, skipped} counts identical to
   the single-bin world; the reasoning is in code comments.

## Deduction-timing map (verified unchanged)
| Path | Deduction moment | Route |
|---|---|---|
| Shop cart checkout | placement | upsertOrder hook → applyOrderPlaced |
| Single-product | placement | upsertOrder hook |
| Landing (+upsell line) | placement | upsertOrder hook + direct applyOrderPlaced for the upsell |
| POS | placement | upsertOrder hook |
| Staff manual | placement | upsertOrder hook |
| Inbox chat | placement | direct applyOrderPlaced |
| Subscription orders | placement | upsertOrder hook |
| Woo/Shopify sync | placement (on create) | upsertOrder hook; restores on status transitions |
| Returns (received items) | restock at receipt | returns.service → adjust(return_restock) |
No path deducts at fulfillment; PickWave/shipments move no
stock (they now DISPLAY allocations).

## Final gate (coordinator-run, exit-code checked)
- **API jest, full suite in 8 chunks, all exit 0: 376 suites /
  4,067 tests, ALL PASS.** Baseline AB2 was 374/4,024 → +2
  suites / +43 tests, exactly the two new AB3 suites
  (ab3-multi-warehouse 31, ab3-transfers 12). All legacy suites
  (inventory, gb2-inventory, on3-delta, ec21-board,
  ec-cp4-restock, on3-surgery, …) pass UNMODIFIED.
- **API tsc** (`--noEmit`) exit 0; **API build**
  (`tsconfig.build.json`) exit 0.
- **Web vitest 431/431** (419 baseline + 12 new warehouse-ab3
  specs), **web tsc** exit 0, **web next build** exit 0,
  **admin next build** exit 0; contracts/db/ui builds exit 0 —
  **7/7 packages**.
- **prisma validate** exit 0.
- **Fresh-DB (PostgreSQL 16, throwaway cluster, dropped
  after): full chain migrate deploy on an empty DB — 176/176
  migrations applied, exit 0**; the 4 AB3 tables + both partial
  unique indexes present; backfill no-op (0 balances).
  Populated-DB backfill re-verified by the coordinator (see
  Backfill above).

## Deploy notes
- Migration `20261017030000_ab3_multi_warehouse` is additive +
  backfill; it has run ONLY on sandbox PG16 (empty chain +
  fixture DBs) — **never on a real DB**. On the real DB the
  backfill will distribute each org's current global counters
  into its resolved default bins; the script twin can be re-run
  safely afterwards (idempotent) for any stragglers.
- No new per-org job. No feature flag: orgs with one warehouse
  see identical behaviour (allocation lands in the default bin);
  multi-warehouse behaviour activates as merchants create
  warehouses/bins and set priority/serviceDistricts.
- Plan limits/usage untouched (GC22 storage is bytes, not
  stock).

## Honest limits
- **No live proof**: no real Postgres transaction has executed
  the bin layer under concurrency — the find-then-write balance
  pattern relies on the interactive transaction for race safety
  on a real DB, and the invariant is proven at fake-Prisma spec
  level + migration-SQL fixture level, not against the deployed
  database (the Advanced Program's standing M30 debt).
- No screenshot QA of the new web surfaces (type/test/build
  level proof only).
- Transfer dispatch is pre-checked + sequentially applied with
  compensation, not one multi-line database transaction (the
  inventory primitive transacts per line); a crash exactly
  mid-dispatch can leave a compensated-but-audited partial
  state, never a silent one.
- Reservations hold against ONE resolved bin per stock row (the
  cart has no delivery district yet); org-global availability is
  unchanged, so a cart can still be refused at checkout by the
  org-global verdict even when its hold bin had stock — same
  semantics as GB2, now bin-attributed.
- Per-terminal POS bin configuration is explicitly future work
  (design §5.4); POS orders allocate by the standard rule.
