# Milestone 56 Acceptance — Cohort Analysis + Historical LTV + Churn Risk (labelled heuristic)

- [x] **Real data only, caller's org only.** Both endpoints read the
      org's own `Order` rows (same fetch pattern as AnalyticsService,
      `take: 20000`) and `Customer` rows of that org. No cross-tenant
      data can enter: every query is `organizationId`-scoped and the
      tenant-isolation test + live check prove another org's customers
      and orders never appear.
- [x] **Revenue semantics — matched to the existing analytics code.**
      A "revenue order" = an order whose status is NOT in
      `REVENUE_EXCLUDED_STATUSES = ["cancelled", "refunded", "failed"]`
      (the constant exported by `analytics.service.ts`, also used by
      attribution and the AI tools — imported, not redefined). Effective
      order date = `placedAt ?? createdAt`, exactly as in
      `AnalyticsService.computeRange`. The excluded set is returned in
      the API response and shown on the page.
- [x] **Cohort matrix** (`GET /organizations/:id/analytics/cohorts`).
      Pure aggregation in `apps/api/src/analytics/cohorts.ts`
      (`buildCohortReport`, framework-free, unit-tested with
      hand-computed fixtures): rows = first-order month (UTC `YYYY-MM`),
      columns = month index 0..N with N capped at `MAX_MONTH_INDEX = 11`
      (and never beyond the latest observed order month); a cell whose
      month has not happened yet for that cohort is `null` ("—" in the
      UI), never a fake zero. Each row carries cohort size, total revenue
      (BigInt minor, string), `retentionPercent[m]` = % of the cohort
      with ≥1 revenue order in that month (1 decimal), and
      `cumulativeLtvMinor[m]` = cumulative revenue of the cohort up to
      month m ÷ cohort size (BigInt integer division) — the historical
      LTV per customer. Orders without a `customerId` cannot belong to a
      cohort; their count is returned as `ordersWithoutCustomer` and
      shown on the page instead of being silently dropped.
- [x] **Churn risk — a labelled heuristic, never claimed as ML.**
      (`GET /organizations/:id/analytics/churn-risk`, pure
      `computeChurn`.) Rule, stated verbatim in the API response
      (`rule` field, `CHURN_RULE_TEXT`), on the page, and here:
      "নিয়ম: শেষ কেনার পর কত দিন কেটেছে, তা তুলনা করা হয় কেনার স্বাভাবিক
      ব্যবধানের সঙ্গে — গ্রাহকের নিজের অন্তত ৩টি অর্ডার থাকলে তার নিজের
      অর্ডারগুলোর মাঝের ব্যবধানের মধ্যমা, না থাকলে পুরো দোকানের সব
      গ্রাহকের ব্যবধানের মধ্যমা। অনুপাত ১-এর কম = কম ঝুঁকি, ১ থেকে ২-এর
      কম = মাঝারি ঝুঁকি, ২ বা তার বেশি = বেশি ঝুঁকি। ব্যবধানের কোনো
      তথ্যই না থাকলে ফলাফল 'তথ্য নেই'। ব্যবধান হিসাব হয় পূর্ণ দিনে
      (একই দিনের পুনঃঅর্ডারে ব্যবধান ন্যূনতম ১ দিন)।"
      Every surface carries the label "আনুমানিক হিসাব (heuristic) —
      মেশিন লার্নিং নয়" (API `label` field + amber banner on the page).
      When no gap reference exists at all (e.g. every customer has a
      single order) the band is `unknown` ("তথ্য নেই") — never a guessed
      band. The signal is READ-ONLY: no automation, campaign, or message
      is wired to it, and the page footer says so.
- [x] **UI** (`/dashboard/analytics/cohorts`, linked from the Analytics
      page): retention heat-table (emerald intensity by %), historical
      LTV table, churn table (customer, order count, last order +
      days ago, reference gap + its source — own vs org, ratio, band
      badge) with summary chips. Customer names link to
      `/dashboard/customers` (Customer 360) — that page selects customers
      by internal state only (no deep-link parameter exists), so the
      link is to the page itself; no route was invented. An org without
      data gets an honest empty state ("এখনো পর্যাপ্ত ডেটা নেই —
      গ্রাহকদের অর্ডার এলেই এখানে Cohort বিশ্লেষণ দেখা যাবে।") — no
      zero-filled matrix is presented as insight.
- [x] **Tests.** 11 new tests (`cohorts.spec.ts`): hand-computed cohort
      fixture (2026-01: size 2, total "400000", retention [100, 50, 50],
      LTV ["150000", "175000", "200000"]; 2026-02: size 1, retention
      [100, 100, null], LTV ["300000", "400000", null]); hand-computed
      churn fixture (own-median customer ratio 7 → high; org-median
      customers 0.1 → low and 5.9 → high; org median from pooled gaps
      [10, 10, 30] = 10); all-single-order org → median null, all bands
      unknown; median() edge cases; service-level tenant isolation
      (org-2 excluded, cancelled org-1 order excluded, customerless
      order counted separately, empty org → `hasData: false`). Full API
      suite: **562 pass / 79 suites** (baseline 539/77). Full monorepo
      build green (route `/dashboard/analytics/cohorts` 4.16 kB).
- [x] **Live-proven on the sandbox** (seeded orders Jul–Sep 2026,
      absolute months): the cohorts response matched the hand-computed
      matrix EXACTLY (Jul: size 2, "400000", [100, 50, 50],
      ["150000", "175000", "200000"]; Aug: size 1, [100, 100, null],
      ["300000", "400000", null]; `ordersConsidered` 7 = 9 seeded −
      1 cancelled − 1 other-org; `ordersWithoutCustomer` 1). Churn:
      org median gap 31 days; customers returned high (ratio 2.65, org
      reference), medium (1.26, org), medium (1.13, own reference) with
      summary {low 0, medium 2, high 1, unknown 0}; the second org saw
      only its own cohort ("2026-07", size 1, "500000"); an empty org
      returned `hasData: false` with empty cohorts and an all-zero churn
      summary. Page serves 200 with the UI present in the built chunk.

## Honest limits
- Churn bands are a deterministic rule of thumb over recency vs. the
  customer's/org's median purchase gap. They are a triage signal for a
  human, not a prediction; the label says so everywhere it appears.
- Cohort/LTV figures are computed over at most the first 20,000 orders
  of the org (the same bound AnalyticsService uses); month columns are
  capped at index 11 (12 months) — older cohorts' later months are
  outside the matrix by design and the cap is documented in the code
  (`MAX_MONTH_INDEX`).
- Revenue uses the order total as recorded (`totalMinor`), consistent
  with the rest of analytics; partially-refunded-but-not-`refunded`-
  status orders count at their recorded total, exactly as the existing
  overview does.
- No pixel QA / real-browser click-through (build + chunk markers +
  page-serves + API behaviour verified).
