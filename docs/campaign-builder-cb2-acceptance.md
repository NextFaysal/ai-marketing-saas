# Campaign Builder CB2 — Acceptance (Readiness++)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan:
`docs/campaign-builder-advanced-plan.md`. Schema
**116** (migration `20261010860000_cb2_plan_budget_cap`:
CampaignPlan.dailyBudgetCapMinor).

## What was built
- **Unified readiness** (POST plans/:id/readiness,
  read-only): structure (the existing validatePlan) +
  policy pre-flight findings + ad-account state from
  the AD package (platform status bucket; missing API
  connection called out) + schedule sanity (end ≤
  start or end in the past = error; start in the past
  = warning) + landing-page reachability (real fetch
  from the server, labelled as such — a bot-blocked
  page reads as a warning, never a fake pass) +
  budget totals. One verdict: ready = no error rows.
- **Meta delivery estimate**: a real
  `delivery_estimate` client call for the first ad
  set's targeting; the result is labelled Meta's
  modelled estimate. Any failure (no connection, bad
  token, Meta refusing) returns available:false WITH
  the reason — never an invented range.
- **Plan budget cap**: dailyBudgetCapMinor settable
  via plan PATCH (taka string; empty clears);
  submit AND publish refuse when the ad sets' daily
  budgets sum above it, with both numbers in the
  error. Budget totals (per ad set + plan) are
  computed by one shared helper.
- Web: budget totals + cap in the plan header, a cap
  editor, and the readiness checklist card with the
  estimate line.

## Verification
- API jest: 4 new CB2 specs (composition, disabled
  account + expired schedule as errors, cap blocking
  and clearing, totals math). Campaign suites stay
  green.
- **Live proof**: readiness on a real plan returned
  every section — structure/policy ok, account
  warnings for the unconnected fixture account,
  landing honestly "unreachable from our server",
  estimate unavailable WITH the true reason; a ৳400
  cap against ৳500/day made submit refuse with the
  exact totals in the message.
