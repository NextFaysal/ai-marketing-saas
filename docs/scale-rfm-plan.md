# Scale Package — Plan (SC1–SC2): RFM without caps

Written 2026-10-11 after a code audit. Local commits
only (the GitHub push rule is unchanged).

## Audit findings (verified in code)
`computeRfm` (apps/api/src/messaging/rfm.ts) feeds
three consumers: broadcast segment audiences and
the RFM report (messaging), Meta custom audiences
(audiences.service), and the AI assistant's tools.
Today it:
- loads at most **2,000 customers** (`take: 2000`) —
  every customer past that is invisible, and the
  quintiles are computed on the truncated base, so
  even the visible customers can be scored wrong;
- runs **one order query per customer** (N+1), each
  capped at **1,000 orders** with no orderBy — a
  customer with more orders gets frequency and
  monetary from an arbitrary subset;
- holds every raw order in memory to sum BigInts.

Semantics to preserve EXACTLY: cancelled orders
excluded; only customers with ≥1 non-cancelled
order appear; merged customers (mergedIntoId set)
are excluded entirely; per-order time is
`placedAt ?? createdAt`, recency is days since the
latest such time; quintile scoring + segment rules
unchanged.

## SC1 — Aggregate in the database
- Replace the row scans with TWO `order.groupBy`
  calls partitioned on `placedAt` nullability
  (partition A: placedAt NOT NULL → count, sum,
  max(placedAt); partition B: placedAt NULL →
  count, sum, max(createdAt)). Frequency and
  monetary add across partitions; the last-order
  time is the max of the two partition maxima —
  exactly the current per-order semantics, with no
  raw order rows leaving the database. (A single
  groupBy with max(createdAt) would overstate
  recency for store-synced orders, whose createdAt
  is the sync time — the partition avoids that.)
- Customer display fields are fetched by id in
  chunks (1,000/chunk), filtered to mergedIntoId
  null — merged customers drop out as today.
- Quintiles/segments computed in memory over the
  full aggregate rows (small), unchanged code.
- Signature `computeRfm(prisma, organizationId)`
  is unchanged — no consumer changes.

## SC2 — Proof at scale
- Specs: a fake groupBy proves (a) no customer or
  order cap (2,500 aggregate customers all scored),
  (b) no per-customer queries (order.findMany is
  never called), (c) partition semantics — a synced
  order (old placedAt, fresh createdAt) scores by
  placedAt, a local order by createdAt, (d)
  cancelled-only and merged customers absent.
- Live: seed 2,100 customers with orders via SQL
  in the sandbox, call the RFM report endpoint,
  and show all 2,100 counted with sane timing.

## Exclusions
The analytics/cohort `take: 20000` raw scans are a
different class (10x higher, row-level reports);
they are noted here as reviewed and deliberately
left for a future package. No caching layer is
added — compute-on-read stays, it just stops
being wrong.
