# Reports Advanced Package — Plan (RP1–RP6)

Written 2026-10-11 after a code audit (owner asked
what Reports is missing; approved the full package
the same evening). Local commits only.

## Audit (verified in code)
EXISTS: Analytics overview (computeRange: revenue,
orders, spend, contribution profit, MER/ROAS/CPA,
platform split, daily series), cohorts + churn,
attribution, ads breakdowns, AI reports
(daily/weekly/monthly with previous-period
comparison + recommendations + anomalies),
shareable client links (no costs/profit, expiring),
domain reports (CRM funnel, product sales, courier
performance, per-plan campaign performance, agency
portfolio), weekly_ads_report email job.
MISSING: any saved/custom report (only AIReport +
ReportShare models exist); any report export
(CSV/PDF endpoints: none); previous-period deltas
in the overview UI path; a monthly report job;
delivery of tenant-built reports; a unified report
hub (reports live on 6+ pages); goal/target
tracking; an executive cross-domain report; data
freshness on report surfaces.

## RP1 — Report Center
GET reports/center: the built-in catalog, the
org's recent AI reports, active share links,
report-type scheduled jobs with last runs, and
data freshness (latest ad sync / store sync /
metric dates — from real rows, absent = stated).
The web /dashboard/reports page becomes the hub:
catalog cards + freshness + the existing AI
reports/recommendations/anomalies sections.

## RP2 — Custom Report Builder + SavedReport
SavedReport model (name, metrics[], dimension,
rangePreset, createdBy). Engine runs from the
SAME sources as the product's own numbers:
- dimension "day": DailyMetricAggregate with
  ensure-fresh (missing coverage recomputes via
  the existing recompute path first). Metrics:
  orders, revenue, refunds, cogs, ad spend, plus
  derived profit and AOV.
- dimensions "platform" / "campaign":
  DailyAdMetric rows for the range, grouped in
  memory (daily rows — bounded). Metrics: spend,
  impressions, clicks, platform conversions, plus
  derived CTR, CPM, CPA. NO revenue per campaign
  (the platform does not provide it and
  attribution is a separate model — the matrix
  refuses unsupported combos with a clear 400).
CRUD + run endpoints; builder UI with metric
checkboxes, dimension, range presets, preview
table + totals row.

## RP3 — Export Engine
GET exports return real files:
- saved report → CSV (text/csv, attachment);
- analytics overview daily series → CSV;
- saved report → branded print HTML (the
  invoice mechanism — browser print to PDF; org
  brand name/color from white-label settings).
No xlsx library exists; CSV is labelled plainly
as CSV (opens in Excel) — no fake "Excel" claim.
Numbers come from the same run path as the
preview — one computation, two renderings.

## RP4 — Scheduled Delivery++
- New job type `saved_report_delivery` (target =
  SavedReport): runs the report for its preset
  range, emails an HTML summary (AP4's html
  channel) + the CSV attached as the body table,
  to the report's recipients (default: org
  OWNER/ADMIN + billing contacts). A send counts
  only on provider confirmation; failures surface
  as job failures, as always.
- New job type `monthly_report` (AI monthly
  generation) + a gallery template.
- Builder UI: schedule a saved report in one
  step (creates the ScheduledJob).

## RP5 — Comparison + Goals
- Overview gains a `previous` block: the same
  computeRange over the preceding equal-length
  period + percentage deltas (null when the
  previous value is 0 — never a fabricated %).
  Analytics page renders delta chips.
- ReportGoal model (org, month YYYY-MM, metric
  revenue|orders|spend, target): progress from
  computeRange against the month, with pace
  (actual % vs elapsed-days %) labelled plainly.
  Goals card on the analytics page with set/edit.

## RP6 — Executive Summary + Share
GET reports/executive: one payload — sales
(computeRange totals), ads (platform KPIs),
customers (new count + RFM segment headlines via
computeRfm), operations (order status mix +
attention counts), top products, top campaigns.
ReportShare gains kind (overview|executive);
the public rendering of an executive share
STRIPS costs/profit exactly like the overview
share does today. Center gains the executive
card + a print view.

## Exclusions
No new charting library (existing in-house
charts); no xlsx binary export (CSV, labelled);
no scheduled WhatsApp/Telegram report delivery
(the alert dispatcher is competitor-alerts
scoped — report delivery stays email until a
general channel exists); payment links and
wallet stay postponed as decided.
