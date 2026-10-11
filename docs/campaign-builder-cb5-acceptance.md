# Campaign Builder CB5 — Acceptance (Performance Loop)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan:
`docs/campaign-builder-advanced-plan.md`. Schema
gains CampaignPlan.publishAt (migration
`20261010880000_cb5_scheduled_launch`).

## What was built
- **Per-plan performance** (GET plans/:id/performance):
  spend, impressions, clicks, reach, CTR, CPM, CPA,
  first-party attributed revenue/orders and ROAS —
  from DailyAdMetric using the platform's established
  semantics (campaign/ad-set level rows only; ad-level
  rows would double-count), with a per-ad-set join
  and a daily series. Unpublished plans and missing
  data return honest empties — nothing is estimated.
- **Promote the winner**: one call takes the existing
  A/B verdict (CPA-based, spend threshold) and
  duplicates the winning plan into a fresh draft
  named "— বিজয়ী সংস্করণ". No verdict → an honest
  refusal. The loser is NOT auto-paused.
- **Scheduled launch**: an APPROVED plan can carry a
  publishAt (≥30s ahead); a leader-claimed 60-second
  scan claims each due plan by clearing publishAt
  first (exactly one attempt), publishes it (PAUSED,
  as always) and notifies the creator; failures are
  audited + notified, never silently retried.
  Unapproved-at-launch plans are skipped with the
  reason recorded.
- Web: performance card, launch schedule/cancel
  controls on approved plans, the scheduled banner,
  and the winner-draft button on A/B plans.

## Verification
- API jest: 4 new CB5 specs; campaign suites 66/66.
- **Live proof**: seeded metric rows returned exact
  totals (spend 20000, CPA 5000, CTR 5%), the
  per-ad-set join and daily series; schedule set →
  publishAt visible → cancel → cleared.
- **Live-caught data bug, fixed everywhere**: the
  metric column is `platformConversions` — the A/B
  aggregation (M23) and the CB3 past-performance
  reader were reading a nonexistent `conversions`
  field (always 0), so platform-CPA verdicts could
  never fire. All five read sites now read the real
  column (with a legacy fallback), and the CB5 spec
  fixtures model the real shape.
- Sandbox note: the scan's publish attempt against a
  tokenless account fails honestly (spec-proven);
  the happy path needs a real Meta connection (M30).
