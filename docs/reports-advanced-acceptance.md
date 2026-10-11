# Reports Advanced Package — Acceptance (RP1–RP6)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/reports-advanced-plan.md`.
All commits LOCAL only.

## RP1 Report Center (c151fd6)
GET reports/center — catalog of all 10 built-in
reports, recent AI reports, active share count,
report jobs, and data freshness from real rows
(Integration.lastSyncAt, latest DailyAdMetric date,
latest order). Absent sources are null, stated
plainly. The web reports page renders the hub.
Live-caught: the AIReport delegate is `aIReport`.

## RP2 Custom Report Builder (fce1bb5)
SavedReport (migration 20261011010000). Honest
metric matrix — day: order-side metrics over
DailyMetricAggregate with coverage ensured via the
existing recompute path; platform/campaign:
campaign-level DailyAdMetric grouping. Derived
metrics (profit, AOV, CTR, CPM, CPA) are null on
zero denominators; unsupported combinations 400
with the allowed list. Builder UI + saved CRUD.
LIVE: forbidden combo 400; seeded 210 orders
matched exactly; save + recipient filtering +
saved run verified.

## RP3 Export Engine (e47e292)
Saved report → CSV (UTF-8 BOM, money as major
units, totals row), overview → CSV, saved report →
branded print HTML (M59 brandName/primaryColor).
Live-caught: Bengali report names break Latin-1
Content-Disposition headers — fixed with an ASCII
fallback filename + RFC 5987 filename*. No xlsx
claim: the file is CSV and is labelled CSV.

## RP4 Scheduled Delivery++ (b7550d9)
Job types monthly_report (AI) + saved_report_
delivery (target = SavedReport). Recipients =
report list ∪ OWNER/ADMIN ∪ billing contacts
(deduped); sends count only on provider
confirmation; no recipients = honest job failure.
Builder UI creates the ScheduledJob in one step.
LIVE end-to-end: job created via API, executed,
and the REAL EmailProvider delivered the report
(text + HTML table) to 2 recipients via a local
SMTP sink. (A 45s hang during proof was the sink's
own escaped CRLF, not the app — fixed and re-proven
in 0.25s.)

## RP5 Comparison + Goals (746c8fe)
Overview gains previous-period comparison (same
computeRange over the preceding equal window);
delta is null when the previous value is 0 and
current is not — never a fabricated percentage.
ReportGoal (migration 20261011020000): monthly
revenue/orders/spend targets with progress vs pace
(the elapsed share of the month). Goals card on
the analytics page; delta chips on KPI cards.
LIVE: seeded windows matched (49 vs 49 orders;
October pace 35.48%; goal progress exact).

## RP6 Executive Summary + Share (1044c90)
GET reports/executive: sales (+profit internally),
ads (+top campaigns), customers (new + RFM segment
headlines), operations (order status mix + top
products). ReportShare.kind (migration
20261011030000): an executive share's public
rendering strips profit/costs — verified live by
key scan (zero profit/cogs keys). Tenant executive
card + public executive layout + kind picker.
LIVE: 210 orders / revenue matched RP2's totals;
RFM segments summed to 2,100.

## Close-out totals
Reports/analytics/automation suites at close:
103/103 (18 suites). The repository-wide suite is
green per the parallel AA track's AA7 close on the
same tree (1521 tests / 184 suites). Web build
green throughout.

## Honest limits
Exports are CSV + print-HTML (no xlsx binary — no
library in the codebase); scheduled delivery is
email-only (no general WhatsApp/Telegram report
channel exists yet); top-products uses effective
order dates via the order relation; comparison
doubles the overview's compute cost (compute-on-
read, as designed).
