# Milestone 23 Acceptance — Phase K: Optimization Intelligence

Date: 2026-10-10. Schema: 81 models, migration
20261010230000_m23_phase_k applied. API tests 286 pass (8 new).

## K1 Breakdowns v2
Sync now also fetches device (impression_device), region and
hourly (advertiser timezone, key normalized to the hour) into the
same DailyAdBreakdown store; Analytics gained Device / Region /
Hourly panels next to Age-Gender / Placement.

## K2 Creative intelligence + rules v3
- Creative leaderboard (org-level, ad-level rows): spend, CTR,
  frequency, CPA per ad plus an HONEST fatigue flag — fatigued
  only when frequency >= 3.5 AND CTR fell >= 30% vs the previous
  equal window; single-signal ads are marked watch, not fatigued.
- Rules v3: metrics ad_frequency / ad_ctr_percent (per-ad, worst
  value governs) and month_spend (month-to-date, campaign-level
  rows only); action pause_ad pauses ONLY the breaching ads via
  CampaignsService.setAdStatus (Meta confirms; run evidence keeps
  the paused ad ids). Applied through the existing evaluation path
  with the same run/audit discipline.

## K3 Structured A/B tests
createAbVariant clones a plan into a test group (original joins as
variant A, clone as B; metric defaults to first-party CPA).
abTestResults puts platform and first-party numbers side by side
and names a winner ONLY when every variant spent >= 100 major
units and has the metric — otherwise verdict insufficient_data.
Builder button + Analytics board.

## K4 Dayparting
Per-ad-set weekly windows (day 0-6, hours, timezone, default
Asia/Dhaka). applyDayparting (dayparting scheduler job) computes
the desired state with tz-aware Intl formatting and calls Meta
ONLY on transitions; transitions are logged on the plan
(daypart_on/daypart_off) and the applied state is stored so ticks
are idempotent. Builder editor uses day,start,end lines.

## K5 Pacing + portfolio
pacing(): month-to-date spend from campaign-level rows only,
day pace vs an owner-supplied monthly budget, month-end
projection, per-campaign CPA table, and text suggestions (CPA gap
>= 2x between campaigns; projected overspend). Suggestions never
move money. Analytics Pacing card.

## K6 Product sets + catalog blueprint
ProductSet model: local filter definitions (category, max price,
in-stock) over the org's real products with member counts computed
live from the catalog — deliberately LOCAL in v1: Meta-side set
creation is not faked (catalog push now also sends each product's
category, which is what a future Meta filter needs). New
catalog_sales blueprint (OUTCOME_SALES structure) joins cod_sales /
ctwa / lead_form. Audiences page manages sets per catalog.

## Live verification performed (sandbox, demo org)
Leaderboard and pacing return honest zeros on the empty demo org;
A/B board empty; dayparting job created through the API; product
set endpoints answer 404 for a missing catalog; blueprint list
includes catalog_sales. Real Meta behavior needs the owner's
accounts (checklist section 19).
