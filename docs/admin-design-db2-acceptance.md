# Admin Design DB2 Acceptance — FIX-0 + ADX4 + ADX5 + ADX6 + ADX7

> Package: Admin Dashboard UX Redesign (ADX1–ADX14), Batch DB2.
> Worktree: `~/workspace/ai-marketing-saas-adx`, branch `admin-ux`,
> base DB1 HEAD `889656e`. Local commits only — **not pushed**
> (push stays owner-gated, as always). Date: 2026-10-15.
> Plan: `Admin-Dashboard-UX-Redesign-Master-Plan-2026-10-15.md`
> §২ (principles), §৪ (Design System v3), §৫ Batch DB2, §৮ (gates);
> structure and honesty rules per `docs/admin-ux-architecture.md`.

## Commits

| Item | Commit | Summary |
|---|---|---|
| FIX-0 | `bbeedb8` | overview() failed-sync count: `startedAt`, not the nonexistent `updatedAt` + spec |
| ADX4 | `d7ec9a2` | Design System v3 — globals.css extension + `components/ui.tsx` |
| ADX5 | `3acd655` | Command Center — আজকের করণীয় row, previous-month reference, task-first quick actions |
| ADX6 | `940bf82` | Customers — list FilterBar/sort/drawer; detail Tabs + sticky action header |
| ADX7 | `fbb3362` | Money — Billing KPI strip + Tabs; Payouts queue, step states, four-eyes flag, statement download |
| ADX4 CSS fix | `31dde24` | Row-action reveal without `@apply group` (caught by the production build, see ADX4) |
| (this doc) | — | acceptance commit |

---

## FIX-0 — overview() failed-sync bug (found in DB1)

**The bug:** `AdminService.overview()` counted failed sync jobs with
`syncJob.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } })`.
The `SyncJob` model has **no `updatedAt` field** (schema: `startedAt`,
`completedAt`, …), so against real Prisma the query throws and the
surrounding `.catch(() => 0)` silently reported **0 failed sync jobs**
on the live Command Center — potentially forever, while syncs failed.

**The fix (`apps/api/src/admin/admin.service.ts`, one field):**
`updatedAt` → `startedAt` — the exact definition `navCounts()` (ADX3)
and every other failed-sync query in the service (`systemQueues`,
`timeline360`) already use. Response shape is byte-identical; only
the value becomes true. The stale comment in `navCounts()` that
described overview's bug was updated to match.

**Spec:** new `apps/api/src/admin/adx-fix0-overview.spec.ts` (2 tests,
mocked Prisma in the established admin-spec pattern). The fake's
`syncJob.count` **throws on an `updatedAt` where-clause**, mimicking
Prisma's unknown-field validation, so the test fails on the old code
by construction. It proves: recent FAILED jobs (2h, 23h ago) count
via `startedAt` (= 2), a 30h-old FAILED job and a COMPLETED job do
not, `failedAutomationRuns24h` is unchanged (= 1), and the emitted
where-clause is exactly `{ status: "FAILED", startedAt: { gte } }`.

## ADX4 — Design System v3

Files: `apps/admin/src/app/globals.css` (102 → 178 lines, **append-only**
v3 section), `apps/admin/src/components/ui.tsx` (new). No page
structure changed in this commit; no new dependency.

**Design System v3 note.** Tokens as CSS variables: spacing scale
(`--a-sp-1..8`), radius (`--a-r-sm..xl`), surface tiers
(base/raised/overlay), semantic colours mirroring the `.abadge-*`
palette, typography scale (page 22 / section 15 / body 13.5).
New classes: `.apage-head` (+ main/title/sub/actions), `.afilter`
(+ label), `.atabs`/`.atab`/`.atab-active`/`.atab-panel`,
`.adrawer-detail` + `.adrawer-scrim`/head/body/foot, `.aempty`
(+ title/sub), `.aerror`, skeleton extensions (`.askel-line`,
`.askel-card`, `.askel-table`), `.akbd`, `.abadge-count`, and Table
v2 affordances: `table.atable-sticky` (sticky header), `.ath-sort`
(+ indicator), density classes `table.atable-compact` /
`table.atable-comfortable`, and row-action reveal on `tr.arow`.
New components in `ui.tsx`: `PageHead`, `FilterBar`, `Tabs`,
`DetailDrawer` (ESC + scrim close; focus lands on the close button
on open), `EmptyState`, `ErrorState`, `SortableTh`, and
**`ConfirmModal`** — the v3 replacement for `window.prompt/alert`
on reason-required actions going forward: same contract as
`reasonPrompt` (input ≥ 3 chars when required), rendered as a modal
with an inline input. **`reasonPrompt` itself is untouched** and
keeps working for pages that have not adopted the modal (org/user
detail pages still use it in this batch, via their sticky headers).

**Backward compatibility (gated):** every class selector present in
the pre-DB1 globals.css (`9322ddb`) is still present — mechanically
diffed, **zero removed** (see Gates).

**Build-caught defect, fixed in `31dde24`:** the first `next build`
of the batch failed on `tr.arow { @apply group; }` — Tailwind
forbids `@apply` with the `group` utility. The reveal is now plain
CSS (`tr.arow:hover/:focus-within .atable-row-actions`). Recorded
here because it is exactly what the build gate is for; the shipped
CSS is the fixed version.

## ADX5 — Command Center (`apps/admin/src/app/page.tsx`)

- **আজকের করণীয় row** (new, above the KPI cards): driven by the
  shared `useNavCounts()` loader over DB1's `GET /admin/nav-counts`.
  One card per **available** field — pending payouts → `/payouts`,
  open tickets → `/tickets`, failed jobs 24h → `/health`, active
  alerts → `/alerts`, overdue subscriptions → `/billing`. A genuine
  `0` renders that queue's calm state ("কিছু বাকি নেই"); a field
  absent from the response renders no card; **if nav-counts fails
  entirely the whole row is absent** — unknown is never dressed up
  as an all-clear (architecture §4).
- **KPI comparison verdict — PARTIAL, by design.** The page now also
  reads `GET /admin/analytics/series?months=3` (M37). Its monthly
  buckets match overview's definitions **only** for orders and order
  revenue (calendar month, cancelled/refunded excluded both sides),
  so only the Orders KPI card gained a comparison: a plain
  previous-month reference appended to its sub-line
  ("গত মাস: Nটি Order, আয় …"). There is **no % change and no trend
  arrow anywhere**: the current month is incomplete, so a delta
  would mislead. No comparison is shown for the other cards, because
  the shapes do not honestly support one — overview's new-org/user
  figures are rolling 30-day counts while the series buckets are
  calendar months, and ad spend / AI usage have no series fields at
  all. If the series fetch fails or the current-month bucket is not
  found, no reference is shown.
- **Quick actions re-ordered task-first** (Health → Payouts →
  Billing → Security → Config) and **Wallet Payouts added** as a
  fifth quick action; all four original actions kept with their
  labels, subs and hrefs.
- The pre-existing error box now uses the v3 `.aerror` class (same
  message, same condition) and the KPI skeletons use `.askel-card`.

**Zero-loss enumeration (before → after).** apiFetch targets:
`/admin/overview`, `/admin/health` → same **plus** declared
additions `/admin/analytics/series?months=3` and `/admin/nav-counts`
(via the shared hook). Visible content: hero strip with all three
badges, all 6 KPI cards (same labels/values/subs; Orders sub gains
the reference text), recent-activity timeline + "সব Audit →" link,
attention / all-clear card (unchanged logic on overview data),
quick-actions card (4 original + 1 added, reordered). Nothing
removed.

## ADX6 — Customers

Controller signatures were checked first: `GET /admin/users` and
`GET /admin/orgs` accept **only `q`, `page`, `take`**. All new
filtering is therefore client-side over already-loaded rows; the
search box still uses the real server `q` param exactly as before.

**Lists (`/users`, `/orgs`):** v3 `FilterBar` (search + status
select; users also get an Admin/সাধারণ select, orgs a Plan select
built from the plans actually present in the loaded rows),
`SortableTh` headers (users: name/org-count/last-login/created;
orgs: name/members/orders/created; default order = the server's
created-desc, unchanged), sticky table header, and a per-row
"দ্রুত দেখুন" button opening the ADX4 `DetailDrawer` with only the
fields the list API already returns, plus a through-link to the
full detail page. The orgs bulk-status bar (selection, prompts,
endpoint, messages) is preserved verbatim; the empty states use
`EmptyState` with the original wording. The org drawer also surfaces
a PAST_DUE warning derived from the row's real
`subscription.status` — a display of existing data, not a computed
risk score.

**Details (`/orgs/[id]`, `/users/[id]`):** the stacked cards were
regrouped into ADX4 `Tabs` using **only content that already
existed on each page** — org: সারসংক্ষেপ (info, counts, members,
integrations, Danger Zone) / Billing ও Limit (subscription editor,
limit overrides, feature flags) / কার্যকলাপ (support view, view-as,
360 history) / নোট (admin notes); user: সারসংক্ষেপ (profile,
memberships) / কার্যকলাপ (audit trail) / নোট (admin notes). A
**sticky header** now carries the status badge (org also shows the
plan/status badge) and **every primary action with its original
handler and reasonPrompt flow** (org: suspend/reactivate/soft-delete;
user: activate/suspend/soft-delete, force-reset, revoke-sessions,
grant/revoke admin, incl. the reset-link result block) so actions
stay visible on all tabs. Breadcrumb (DB1) unchanged.

**Zero-loss evidence:** mechanical set-diff of apiFetch/fetch
targets per page, before vs after — **identical sets on all four
pages** (the only grep-level additions on the list pages are the
words "GET /admin/users" / "GET /admin/orgs" inside explanatory
comments, not calls). Every field, button and endpoint used before
is present after; actions moved (into the sticky header / tabs),
none removed or buried deeper than one tab click, with the primary
actions strictly *more* visible than before.

## ADX7 — Money

**Billing (`/billing`):** KPI strip at top — the original four cards
(MRR, collected this month, collected total, trialing) **plus** an
overdue card whose value is `sum.overdue.length`, i.e. data the page
already loaded from `/admin/billing/summary`; no new fetch. The
seven stacked cards regroup into `Tabs`: **Subscriptions** (per-plan
counts + overdue list, coupons), **Invoices ও Manual Payment**
(manual payment form, recent payments table with CSV export /
invoice / invoice-email / refund / delete, online checkout
reconciliation), **Dunning** (dunning card; the tab carries a count
badge). All forms, prompts, handlers and messages are the originals.
apiFetch target set-diff vs before: **identical**.

**Payouts (`/payouts`):** queue layout on the same endpoints —
rows are sorted **client-side** by status rank
(pending → approved → paid → rejected → cancelled), newest first
within a rank (the API already returns `createdAt` desc inside a
status filter; the rank ordering is client-side and the UI copy
says so). The filter select keeps all six original options. A new
**ধাপ (step) column** shows অনুরোধ → Approve → Mark Paid states side
by side per row (terminal states show their end badge instead).
**Wallet statement (AN2) is reachable from the queue:** per-row
Statement CSV / PDF buttons download from the existing
`GET /admin/wallets/:organizationId/statement.csv|.pdf` endpoints
via an authed blob fetch (the same pattern Billing already used).
The three action prompts moved to the ADX4 **ConfirmModal** — same
endpoints, same request bodies, same success messages; required
inputs follow the reasonPrompt ≥3-char contract (a deliberate,
small tightening over the old any-non-empty prompt for the reject
note and the payout reference; the optional approve note stays
optional). The wallet adjustment form is untouched.

**Four-eyes flag verdict — FLAGGED, honestly sourced.** The payout
payload (`payoutView`) carries `approvedById` and `amountMinor` but
**no threshold field**. However, the threshold *is* available from
an existing endpoint — `GET /admin/platform-config` returns
`wallet.payoutFourEyesThresholdMinor` (CC23) — so the page reads it
from there and flags every row with `amountMinor >= threshold`
("⚖ Four-eyes সীমার ওপরে", with a tooltip stating the rule:
the approver cannot also mark-paid). When the threshold is unset
(`null`) or the config read fails, **no flag is shown and no
threshold line is printed** — the page never guesses a "large
amount". The flag is display-only; enforcement remains server-side
in `WalletService.adminMarkPaid`, unchanged.

**Zero-loss evidence:** apiFetch target set-diff — billing
identical; payouts identical **plus** exactly the declared
additions (`GET /admin/platform-config` read, AN2 statement
downloads). Both statement endpoints and the config endpoint
pre-date this batch (AN2 / CC23 / M33); no API was added or changed
in ADX7.

---

## Gates — real output

| Gate | Result |
|---|---|
| Admin API specs (`npx jest src/admin --runInBand`) | **19 suites, 212 tests — all pass** (DB1's 18 suites / 210 tests + FIX-0's new suite / 2 tests) |
| Admin `tsc --noEmit` | **0 errors** |
| API `tsc --noEmit` | **0 errors** (FIX-0 touched the API) |
| Admin `next build` | **Green — all 22 routes** (20 static + `/orgs/[id]`, `/users/[id]` dynamic; route list diffed against DB1: identical set) |
| API route diff (DB1 → DB2) | **Identical** decorator count in `admin.controller.ts` — DB2 added no API route (FIX-0 changed one query field inside `overview()` only) |
| Zero-loss set-diffs | Per page, as detailed above: ADX5 enumeration, ADX6 four pages identical apiFetch sets, ADX7 billing identical / payouts additions-only (declared) |
| globals v2 backward compatibility | Class selectors of pre-DB1 `globals.css` (`9322ddb`) vs final: **zero removed** (mechanical `comm` diff); v3 is additions only |

## Honest limits

- **No browser screenshot QA** — none performed for DB2. Screenshot
  / usability QA is ADX13 and remains deploy-gated. Everything here
  is proven by typecheck, production build, unit specs and
  mechanical set-diffs, not by looking at the pages in a browser.
- **No live-API proof** — FIX-0's spec uses a mocked Prisma that
  mimics Prisma's unknown-field throw; the corrected overview query
  has not run against the production database. The ADX5 TODO row and
  comparison, and the ADX7 threshold read, are likewise proven by
  code + build, not against live data.
- **ConfirmModal adoption is partial by design** — payouts (ADX7)
  uses it; the detail pages and billing still use `reasonPrompt` /
  `window.prompt`, which remain supported. Full migration is a
  DB3/DB4-time decision, not claimed here.
- **Drawer focus handling is operator-grade, not a full focus
  trap** — ESC/scrim close and initial focus are implemented;
  trapping Tab inside the drawer is left to ADX12 polish.
- Push and deploy remain owner-gated; DB2 is local commits only.
  Next in the package: DB3 (ADX8 Health/System/Alerts, ADX9
  Settings hub, ADX10 Tickets/Audit/Security/Admins, ADX11
  Analytics/Usage/Growth/Social-Ops).
