# Milestone 37 — Admin Phase A1: Operator Visibility++ (Acceptance)

Built 2026-10-10 from `docs/admin-master-plan.md` Phase A1.
No schema change (AI cost rates ride the M26 SystemSetting store).

## What was built

### API (`apps/api/src/admin/`)
- `GET /admin/analytics/series?months=` (3–24, default 12) —
  monthly buckets computed from stored rows only: collections
  (Σ SaasPayment.amountMinor per month), new organizations,
  new users, new subscriptions, tenant orders and order revenue
  (cancelled/refunded excluded). Plus a `current` snapshot:
  MRR (Σ plan price over ACTIVE latest subscriptions, same
  definition as M27), active/trialing/past-due counts, paid
  organizations, and `paidSharePercent` — explicitly a current
  snapshot ratio, NOT a cohort conversion rate.
- `GET /admin/analytics/top-tenants?limit=` — per-org 30-day
  order count + revenue, 30-day AI tokens, all-time collected
  total, member count, latest plan/status; sorted by 30-day
  revenue then collections.
- `GET /admin/analytics/health-scores` — heuristic triage
  score per org (0–100) with **every deduction returned
  verbatim** (PAST_DUE −40, CANCELLED −60, no subscription
  −20, automation errors in 24h −8 each capped −24, idle
  7/14/30 days −8/−15/−25, no integration −10). Bands
  good ≥75, watch ≥45, risk below. Response carries
  `heuristic: true`; the UI labels it as such.
- `GET /admin/analytics/ai-cost` + `PATCH /admin/analytics/ai-rates`
  (SUPER only, audited `admin.ai_cost_rates_updated`) — 30-day
  usage grouped by (org, provider): real token counts, plus
  estimated-token counts kept separate. Money appears ONLY
  when the operator has set a per-provider rate (minor units
  per 1M tokens) and is computed from NON-estimated tokens
  only — the dev adapter never produces a cost.
- `GET /admin/orgs/:id/history` — one merged timeline per
  org: audit entries (org-scoped OR entity-matched), payments,
  and the current subscription state, newest first, cap 100.

### Admin UI (`apps/admin`)
- New `/analytics` page (nav: প্রধান → Analytics): KPI stat
  cards (MRR, paid orgs + paid share, trialing, past due),
  monthly collections bar chart (CSS bars over real payment
  rows) + full monthly table, Top Tenants table, Health Score
  cards with deduction chips, AI Cost table with per-provider
  rate inputs (taka per 1M tokens, converted server-side to
  minor units).
- Org detail page gained a History timeline card (audit +
  payments + subscription).

## Verification
- 4 new tests (`apps/api/src/admin/m37.spec.ts`): monthly
  bucketing sums + snapshot math; top-tenant ranking;
  health-score deductions verbatim (score 26 with all four
  deduction kinds, 100 for a healthy org); AI cost is null
  without a rate and exact with one (estimated tokens
  excluded); org history merges all three event kinds and
  404s for unknown orgs. **API suite: 364 pass (57 suites).**
  Monorepo build green.
- Live (sandbox, fresh seed DB): series/top-tenants/health/
  ai-cost/history all returned honest values from the seed
  rows (health score 70 = 100 − 20 no-subscription − 10
  no-integration, deductions shown). PATCH ai-rates without
  TOTP → 403 (M28 SUPER gate covers the new mutation); after
  API TOTP enrolment + confirm, the same PATCH saved rates
  and a follow-up PATCH cleared them back to `{}`.

## Known limits
- Paid-share and MRR are current snapshots; historical MRR
  reconstruction would need subscription-change history
  (Phase A1 deliberately does not invent it).
- Health score weights are operator heuristics, documented in
  code and shown with inputs — a triage aid, not a verdict.
- AI cost uses a single blended rate per provider (input +
  output tokens combined); per-direction rates can follow if
  the operator needs them.
