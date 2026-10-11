# CX1 — Customer Courier Record — Acceptance

**Status: DELIVERED (local commit only — NOT pushed).**

## What was built

`RiskService.courierRecordForCustomer(orgId, customerId)` (apps/api/src/orders/risk.service.ts) — compute-on-read, no schema change, no new table. It builds the SAME history set as M50's `forCustomer()` (the customer's own orders + any org orders sharing the customer's phone, deduped by id) and classifies every order with the EXACT M50 helpers (`summarizeHistory` / `classifyOutcome` from orders/risk-score.ts) — there is no second classifier.

Payload:

- `decided, delivered, returned, cancelledOrFailed, refunded` — the M50 buckets; `decided` = delivered + returned + cancelledOrFailed + refunded.
- `successRatePct` = delivered / decided × 100, rounded; **null when decided = 0** (never a fake 0).
- `perCourier[]` = `{ provider, decided, delivered, successRatePct|null }`. Each decided order is attributed to the provider of its **latest** shipment (by createdAt). Shipments stored without a provider group as **"অন্যান্য"** (the bucket exists only when such rows exist). Orders with no shipment count in the totals only — they are never attributed to a courier.
- `lastDeliveryAt` — the newest `updatedAt` among the history's shipments whose stored status is delivered/partial_delivered. There is no `deliveredAt` column in the schema; this is honestly the last time a delivered status was recorded, and the doc/UI never claim more.
- `totalShipments` — shipment rows across the history orders.
- `riskBand` / `riskScore` — M50's band/score from the same `scoreRisk()` pass, riding along so surfaces can show both numbers.

`loadOrgData`'s shipment select was extended additively (`provider, createdAt, updatedAt`) — the same single org-scoped load every risk surface uses.

## Label discipline (the two numbers are different things)

- **ডেলিভারি সফলতার হার** (delivery success rate) = delivered share of decided orders. 
- **রিটার্ন ঝুঁকি** (return risk, M50) = a weighted risk score where returned/cancelled/refunded count against the customer, with thin-history rules.

The success rate is **NOT** `100 − risk score`. The spec fixture proves they diverge on the same history (success 57% vs risk score 43). Both UIs label them distinctly, and the Customer 360 section spells out "(এই হারটি রিটার্ন ঝুঁকির স্কোরের উল্টো নয়, দুটি আলাদা হিসাব)".

## Surfaces

- **(a) Customers detail API** — `GET organizations/:id/customers/:customerId` response gains a top-level `courierRecord` sibling next to the existing `risk` block (additive; same try/catch degrade-to-null discipline as the risk block).
- **(b) Customer 360 (web customers page)** — a "🚚 Courier Record" card under the risk card: success % prominent, counts line (returned / cancelled-failed / refunded / total shipments / last delivery date), and a per-courier mini-table. decided = 0 renders "এখনো কোনো ডেলিভারি ইতিহাস নেই" instead of any percentage.
- **(c) Inbox context panel** — `InboxService.getConversation` adds `context.courierRecord` (same service call, failure-isolated — a record error never breaks the thread view); the panel renders a compact card: success % + decided/delivered counts + রিটার্ন ঝুঁকি band/score from the same payload. The panel's existing P2 per-shipment widget is untouched.

## Tests

`apps/api/src/orders/cx1-courier-record.spec.ts` (6 tests, all passing; the neighbouring M50 suite passes unchanged):

- Classification reuse: record counts equal `summarizeHistory` over the identical fixture.
- % math: decided 7 / delivered 4 → 57; risk score on the same history is 43 (distinctness asserted).
- Per-courier split: latest-shipment attribution (an order shipped RedX then Pathao counts under Pathao only), provider-less shipment → "অন্যান্য", shipment-less decided orders excluded from every bucket but included in totals; totalShipments and lastDeliveryAt exact.
- decided = 0 → `successRatePct: null`, empty perCourier, band "unknown", score null.
- Tenant isolation: another org's cancelled orders on the same phone never enter the record (loadOrgData is org-scoped; asserted via counts).
- Customers detail payload shape: `courierRecord` present next to `risk`, JSON-serializable.

## Evidence ceiling (stated plainly)

The sandbox has **no Postgres**, so there was no live HTTP run of the customers/inbox endpoints for this item. Evidence = the spec suite above (fake Prisma at the service seam, the codebase's established pattern), the full API suite, web tests, and the monorepo build at the batch gate. The computation is pure over rows the fake supplies in the same shape Prisma returns; nothing here claims a live database was touched.
