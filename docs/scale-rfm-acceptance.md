# Scale Package — Acceptance (SC1–SC2: RFM without caps)

Status: **DELIVERED & LIVE-PROVEN at scale in the
sandbox** (2026-10-11). Plan:
`docs/scale-rfm-plan.md`.

## What changed (SC1, 2666f74)
`computeRfm` (messaging/rfm.ts) no longer loads
customers and their orders into memory. Two
`order.groupBy` partitions on placedAt nullability
(count + sum + max per customer) are merged in
memory; customer display fields are fetched by id
in chunks of 1,000. Quintile scoring and segment
rules are untouched, as is the function signature —
the three consumers (broadcast audiences, RFM
report, Meta custom audiences, AI tools) needed
no changes.

Removed, concretely:
- the 2,000-customer cap (past it, customers were
  invisible AND the quintile base was truncated,
  so visible customers could be scored wrong);
- the 1,000-orders-per-customer cap (an arbitrary
  subset decided frequency and monetary);
- the N+1 query pattern and all raw order rows in
  memory.

Preserved exactly: cancelled excluded; only
customers with ≥1 counted order appear; merged
customers excluded; per-order time is
`placedAt ?? createdAt` (the two partitions exist
precisely so a synced order's fresh createdAt
cannot fake recency).

## Proof (SC2)
- New spec: 2,500 customers all scored via exactly
  2 groupBy calls and zero order.findMany; a
  1,500-order customer counts all 1,500; partition
  semantics (synced/local/mixed) verified;
  cancelled-only and merged customers absent.
- Two pre-existing consumer harnesses (ai/tools,
  inbox/phase-f M17 tests) gained a groupBy fake —
  assertions unchanged.
- **Live**: 2,100 customers + orders seeded via
  SQL; GET messaging/rfm returned
  totalCustomers 2100 (segments summing to 2100)
  in ~0.28s end-to-end.
- Full API suite at close: **1406/1406, 170
  suites.**

## Reviewed and deliberately left
The analytics/cohort `take: 20000` raw scans are
a different class (row-level reports, 10x higher
bound) — noted in the plan for a future package,
not silently ignored.
