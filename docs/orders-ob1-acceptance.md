# Orders Next — Batch OB1 Acceptance (ON1 Command Center v2 + ON2 Timeline 360 & Collaboration)

Date: 2026-10-14 · Branch `orders-next` (base: released integration-3 tree `a3b62ed` = GitHub main `7443135` content) · **Local commits only — NOT pushed, NOT deployed.**

Commits (oldest → newest): `27be10a` schema · `fc7798a` ON1 API · `a44d665` ON1 bulk + courier invoicesPdf · `e82e350` ON2 API · `df88314` ON1 web lib · `6febffa` ON2 web · `c69a73f` ON1 web command center + ON2 wiring · this doc.

## Migrations (Orders Next range 20261013700000+)

| Migration | Contents |
|---|---|
| `20261013710000_on1_command_center` | `Order.tags Json?`, `Order.assigneeId String?` + index |
| `20261013720000_on2_collaboration` | `OrderSavedView` table; `OrderComment` table + `Order.orderComments` relation (onDelete Cascade) |

**Deploy notes:** neither migration has been run on any real database. Fresh-Postgres-16 verification (throwaway cluster, this batch): `prisma migrate deploy` over the full sequence — **157/157 applied clean, 0 unfinished/rolled back, 211 tables**; the two new columns and both new tables verified present via information_schema. At deploy time these two migrations must run with the rest of the pending set on the real DB (which is still at the 129 state per the integration-3 notes).

## ON1 — delivered

### Smart queues (`apps/api/src/orders/order-queues.ts` + `OrdersService.resolveQueueOrderIds`)
ONE code path resolves the id set for a queue; `GET orders/queues` counts and `GET orders?queue=` list both consume it, so count == list total by construction (spec-pinned on fixtures for every queue). All queues exclude practice orders. Exact predicates as implemented:

- **needs_confirmation** — `isCod = true` AND `codConfirmationStatus = "awaiting"` AND status ∈ {pending, on-hold, processing}.
- **ready_to_pack** — status ∈ {processing, on-hold} AND `codConfirmationStatus != "awaiting"` AND no active (non-terminal) CourierShipment AND **not fully covered**: coverage = per-item summed `quantity` over the lines of all non-cancelled Fulfillments; an order is covered only when every item's covered quantity ≥ ordered quantity. No fulfillments ⇒ included. (Documented interpretation: fulfillment line quantities count as committed/packed coverage; the per-line `packed` flag is not separately required — an order fully committed to a fulfillment is worked from the dispatch board, so "ready to pack" means packing work has not started. Partially covered orders stay in the queue.)
- **in_transit_stuck** — has a CourierShipment with status ∈ {in_review, picked_up, in_transit, out_for_delivery} AND shipment `updatedAt` older than **4 days** (`STUCK_DAYS = 4`, constant, not org-configurable in v1).
- **deliveries_today** — `deliveryDate` == today in Asia/Dhaka (the stored "YYYY-MM-DD" string compared against the Dhaka date; no out-for-delivery shipment status exists in the vocabulary, so deliveryDate is the sole signal) AND status ∉ {cancelled, failed, refunded, returned}.
- **due_collection** — status ∈ {completed, delivered} AND `totalMinor` > sum of APPROVED PaymentVerification amounts, computed with **one grouped raw SQL query** (`"Order"` LEFT JOIN `"PaymentVerification"` grouped by order) — no per-order queries, no silent truncation or recency cap.
- **returns_open** — has a ReturnRequest with status ∈ {requested, approved, return_shipped, received}.
- **all_open** — status ∉ {cancelled, refunded, failed, delivered, completed, returned}; **all** — every non-practice order.

### List v2 (backward compatible — all params optional, legacy shape/behaviour unchanged)
New params: `queue`, `dateFrom`/`dateTo` (placedAt, falling back to createdAt; S3-export-style Dhaka parsing), `district` (Customer.address Json district OR Order.address contains), `provider` (via shipment id set), `source`, `paymentState` (paid: approved sum ≥ total, incl. total 0 · partial: 0 < sum < total · due: sum = 0 AND total > 0; via ONE groupBy over the page candidates — never N+1), `minTotal`/`maxTotal`, `assigneeId`, `tag`, `search` (one OR group: order number / customer name / phone / customer phone / customer email, AND-composed with other filters), `sort` (placedAt_desc default · placedAt_asc · total_desc · total_asc). Rows additionally carry `tags`, `assigneeId`, and batch-computed `advancePaidMinor`/`amountDueMinor`.

### Tags & assignment
`POST orders/:orderId/tags` (replace semantics; max 10 tags, trimmed 1–30 chars, deduped; audit `orders.tags_updated` with count only), `PATCH orders/:orderId/assign` (assignee must hold an ACTIVE org membership, else Bengali 400; audit `orders.assigned`). Write roles: OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT; the whole controller stays behind TenantGuard + RolesGuard + `@PermissionArea("orders")`.

### Saved views
`OrderSavedView` CRUD scoped to (organizationId, userId) — another user's view id ⇒ 404. Filter keys validated against a whitelist (`status, isCod, queue, dateFrom, dateTo, district, provider, source, paymentState, minTotal, maxTotal, assigneeId, tag, search, sort, pageSize`); unknown key ⇒ Bengali 400.

### Bulk actions — `POST orders/bulk`
Hosted in **FulfillmentModule** (`orders-bulk.controller/service`) on the same route prefix — deliberately NOT in OrdersModule, because InboxModule imports OrdersModule and CourierModule imports InboxModule, so an Orders→Courier import would close a module cycle; FulfillmentModule already depends on Orders + Courier + Inbox. 1–100 order ids (deduped), per-order try/catch with the underlying services' **verbatim** error messages, `{results, succeeded, failed, print?}`, one summary audit `orders.bulk`. Actions: `set_status` (through `OrdersService.updateOrder` — transition rules per order), `add_tag`/`remove_tag`/`set_tags`, `assign` (assignee validated once up front), `book_courier` (through `CourierService.bookShipment` with the EC22 resolution untouched; DTO composed from the order — missing phone/address fail per-order with Bengali reasons), `print_labels` (newest shipment per order; none ⇒ per-order error) and `print_invoices` (existence check), returning shipment/order id lists the web turns into the existing combined-PDF endpoints.

### Courier invoices PDF
`CourierService.invoicesPdf(ids)` added as the exact mirror of `labelsPdf` (single-order `invoicePdf` refactored onto a shared page helper; ≤50 ids, one combined PDF via the existing `courier/pdf.ts` builder) + `GET courier/invoices.pdf?ids=` mirroring the labels route. No new PDF library.

### Live feed
`GET orders/feed?since=<ISO>` (missing/invalid ⇒ 400): orders created OR updated after `since`, newest first, capped at 50, minimal row shape with `changeKind` created|updated. Web polls **every ~25 s only while the tab is visible**; new orders surface as a "Nটি নতুন অর্ডার" pill + toast — the visible list is **never auto-replaced**; the pill click applies the refresh. The mechanism is labelled honestly in the UI ("স্বয়ংক্রিয় হালনাগাদ" — it is polling, not a push channel).

### Web Command Center (`/dashboard/orders`)
Left queue rail with live counts (desktop rail / mobile chips; the API `all` count rides the existing "সব অর্ডার" button — no duplicate "সব" chip), full v2 filter bar, saved views (save/apply/delete), dense table + mobile cards with row checkboxes and a sticky bulk bar (status change confirmed; per-order errors shown verbatim), row quick actions: `tel:` call link, inbox link **only when the row actually carries a conversation id** (no fabricated WhatsApp links), Confirm-COD (when a request is outstanding it deep-links to the inbox conversation flow; otherwise it sends the real COD-confirmation request through the existing inbox endpoint), book courier, print label. The order detail remains the existing in-page action panel (there is no separate detail route in this codebase) and keeps every pre-existing feature (verified zero-loss: status actions, refund, internal note, EC19 advance, EC18 slots, EC30 pickup, risk chip, EC5 draft/note/invoice/return-link, CSV export, practice toggle, courier booking + EC22 suggestion, CX8 label scan, CX12b reviews, CX7 chases, courier rules/performance/riders, EC31 installments, legacy bulk booking + labels PDF).

## ON2 — delivered

### Timeline — `GET orders/:orderId/timeline` (`OrderInsightsService`)
Server-merged from **real records only**, each source failure-isolated, sorted desc, capped at 200 with a `truncated` flag: order created · AuditLog rows for the order (internal-note content audits and manual-created markers excluded per existing policy; PaymentVerification-entity audits deliberately NOT used — payments come from the PaymentVerification rows themselves, so nothing double-counts) · PaymentVerification rows (requested/approved/rejected with amounts) · Fulfillments (created + current status at updatedAt) · CourierShipments (booked + current status; a COD-collected entry when `codCollectedAt` is set) · ReturnRequests (each status step that carries a timestamp, incl. restock) · OrderReview (requested/received) · InstallmentPlan + items (plan created, item paid at `paidAt`) · DeliveryAssignments (assigned/picked-up/delivered/returned stamps). Actor names batch-resolved. Entries: `{at, kind, title (Bengali), detail?, actor?, actorId?}`. **Shipment intermediate statuses are not historied anywhere in the data model, so the timeline shows booked + current state only — nothing is reconstructed or invented.**

### Customer 360 — `GET orders/:orderId/customer-360`
Definitions (all from real rows): `orderCount` = all orders of the customer · `lifetimeValueMinor` = Σ totalMinor over the EC33 sold bucket (status ∉ {cancelled, refunded, failed} AND (status ∈ {completed, delivered} OR has a delivered/partial_delivered shipment)) · `deliveredCount` = sold-bucket orders in {completed, delivered} · `cancelledCount`, `returnedCount` (status returned OR a ReturnRequest in {received, restocked, refunded}) · `reliabilityPercent` = delivered / (delivered + cancelled + returned) × 100, 1 decimal, **null when the denominator is 0** (labelled in the UI as computed from these counts) · `openDueMinor` = Σ amountDue over orders with status ∉ {cancelled, failed, refunded}, due = total − APPROVED verification sum (one grouped query) · `openReturns` count · `lastOrders` = 10 most recent summaries. Guest/walk-in orders (no customer) return `{customer: null}` with zeroed figures and `reliabilityPercent: null` — never an error.

### Internal comments — `OrderComment`
Staff-only create/list/delete under the orders permission area. Body 1–2000 chars. Delete: the author, or a user whose ACTIVE membership role is OWNER/ADMIN; otherwise Bengali 403. Audits (`orders.comment_added` / `orders.comment_deleted`) carry `{orderId}` only — **comment bodies are never written to audit metadata**. No public or customer-facing surface reads OrderComment (storefront, tracking, and public APIs untouched); the web thread is labelled "অভ্যন্তরীণ — গ্রাহক দেখবে না".

## Gates — coordinator's own final run (exit-code verified, no piped output)

| Gate | Result | Baseline |
|---|---|---|
| API jest (5 chunks, `--runInBand`) | **327 suites / 3282 tests PASS**, every chunk exit 0, zero FAIL lines | 323 / 3243 (+4 suites / +39 tests = the OB1 specs: on1-queues, on1-list, on1-bulk, on2-insights) |
| API `tsc --noEmit` | exit 0 | — |
| Web vitest | **267/267 PASS**, exit 0 | 255 (+12 orders-on1 lib tests) |
| Web `tsc --noEmit` | exit 0 | — |
| Full build `pnpm -r build` | exit 0 (7/7 packages incl. next build web + admin) | — |
| `prisma validate` | exit 0 | — |
| Fresh-DB migration sequence | **157/157 applied clean** (155 + ON1 + ON2), 211 tables | 155 |

No flakes appeared in this run (the known cx3-debounce flake did not trigger; chunk-00 printed jest's cosmetic "did not exit one second after…" open-handle notice with exit 0). Note: an earlier automated summary of the jest run produced numbers that did not match the chunk logs; the table above is taken from the per-chunk log files themselves, which the coordinator read directly.

## Honest limits

- **Live feed is polling (~25 s, visible tab only), not websockets/SSE.** Labelled as such in the UI.
- **Timeline shows only what is recorded.** Shipment intermediate statuses, and any transition whose timestamp does not exist in data, are absent by design — booked + current state only.
- **Due-collection / paymentState cost:** one grouped SQL/groupBy per queue-count or list call over the org's candidate orders — correct and N+1-free, but not indexed-materialized; on very large orgs this is a grouped scan, accepted for v1 and stated here rather than hidden.
- **ready_to_pack coverage** counts fulfillment line quantities as coverage (see the definition above) — a fully-committed-but-not-yet-packed order leaves this queue and is worked from the dispatch board.
- **Comments are staff-only by construction** — no customer surface reads them; there is no comment edit in v1 (delete + repost).
- **No live proof:** nothing in OB1 has been exercised against a real database with real orders, a real courier provider, or real users — verification is fixture/spec-level plus the fresh-DB migration proof. M30-style live verification remains owed, as does the owner's Dokploy redeploy and running these migrations on the real DB.
- Process note: both original builder agents and one coordinator gate run were interrupted by sandbox daemon restarts; all work was recovered from on-disk state and every number in this document was re-verified by the coordinator personally.
