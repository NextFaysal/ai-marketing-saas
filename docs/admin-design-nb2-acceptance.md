# Admin Design Next — NB2 Acceptance (ADNX4, ADNX7, ADNX8, ADNX9)

- **Batch:** NB2 (মূল page) of the ADNX package — plan
  `~/workspace/goals/ai-marketing-saas-platform-build/files/Admin-Dashboard-Design-Next-Plan-2026-10-16.md`
  §২ (principles), §৩ (responsive rules), §৫ ADNX4, §৭ ADNX7/ADNX8/ADNX9, §৯ NB2 row + gates
- **Worktree / branch:** `~/workspace/ai-marketing-saas-adnx`, `admin-design-next`
- **Base:** `2df46a7` (NB1 complete) · **Local commits only — NO push**
- **Scope:** `apps/admin` + this doc. No new API endpoint, no backend
  change, no migration, no behaviour/payload/label/config-key change —
  presentation and feedback only.

## Commits (one per item, in plan order)

| Item | Commit | Subject |
|---|---|---|
| ADNX4 | `ba61a50` | State completeness for NB2 pages |
| ADNX7 | `1d3a0fc` | Command Center redesign completion |
| ADNX8 | `120aba2` | Customers — list patterns, unified detail pattern, toasts |
| ADNX9 | `9d82ea7` | Money — Billing form pattern + KPI rail, Payouts queue polish |

## ADNX4 — State completeness (`ba61a50`)

Audit first; only genuinely missing states were added. Working
ADX12 error states were NOT redone. Per-page table
(skeleton / empty / error-with-working-retry):

| Page | Skeleton before → after | Empty before → after | Error + retry before → after |
|---|---|---|---|
| Overview `/` | Partial (KPI grid only) → **Full** (KPI grid + timeline lines + lower-block skeletons) | Inline text for recent actions → **EmptyState** | Present (ADX12) → unchanged |
| Organizations `/orgs` | Present (`askel-table`) → unchanged | Present → unchanged | Present → unchanged |
| Org Detail `/orgs/[id]` | **None** (plain "লোড হচ্ছে…") → **askel-card + askel-table**; retry now also clears the stale failure flag at load start | Only integrations had inline text → **EmptyState added** for members, support orders, support conversations, feature flags, notes, 360 history | Present → unchanged |
| Users `/users` | Present → unchanged | Present → unchanged; **fixed:** empty state no longer renders alongside a load error (orgs already guarded, users did not) | Present → unchanged |
| User Detail `/users/[id]` | **None** → **askel-card + askel-table**; retry clears stale flag | Only memberships had inline text → **EmptyState** for memberships (converted), audit trail, notes | Present → unchanged |
| Billing `/billing` | **None** (plain text) → **5 KPI skeleton cards + table skeleton**; retry clears stale flag | Inline texts only → **EmptyState** for payments, online checkouts, dunning; coupons had **no** empty rendering at all → EmptyState added | Present (summary) → unchanged |
| Payouts `/payouts` | Present → unchanged | Present → unchanged | Present → unchanged |

States for the NB3/NB4 pages were NOT touched — see the deferred
list at the end.

## ADNX7 — Command Center (`1d3a0fc`)

- **PageHead adopted** — the first adopter in the console (NB1 left
  it at 0/22). The shell owns the `<h1>`, so PageHead carries the
  sub-line plus the page's status badges (Database / API / failed
  jobs), moved out of the hero strip; the hero keeps its title and
  date line. Nothing was removed.
- **আজকের করণীয় rail:** on mobile the row is now a horizontal
  snap-scroll rail (`min-w-[228px]` cards, snap-start); `sm+`
  restores the grid (2-col, 5-col on xl) — same cards, same hrefs,
  same counts source (nav-counts; absent counts still hide the row).
- **Storage overview collapsible:** the R2/RM12 card header title is
  now a toggle button (`aria-expanded`); the collapsed state is
  persisted in `localStorage` (`admin_overview_storage_open`,
  guarded like every other shell preference; default = expanded,
  i.e. previous behaviour).
- **Quick actions:** 2-column grid on mobile, single column inside
  the xl side rail — same five actions, same hrefs/labels.
- **Full-page skeleton:** delivered with ADNX4 (above).

### Per-KPI comparison honesty table

Comparison data can only come from the two sources the page
already loads: `GET /admin/overview` and
`GET /admin/analytics/series?months=3`. Series buckets are
calendar-month: `orders`, `orderRevenueMinor`, `collectedMinor`,
`newOrgs`, `newUsers`, `newSubscriptions`.

| KPI card | Previous-period comparison | Shown? |
|---|---|---|
| এই মাসের Order — order count | Previous month `orders` — definition matches the overview figure exactly (calendar month, cancelled/refunded excluded, per the ADX5 note) | **YES** — uniform reference line under the card: `↔ গত মাস: Nটি Order · আয় ৳X` |
| এই মাসের Order — revenue (same card) | Previous month `orderRevenueMinor` — same exact definition | **YES** — same reference line |
| মোট Organization (cumulative total) | No honest source: the series carries monthly *new* orgs, not the previous value of the cumulative total | **NO — honestly absent** |
| মোট User (cumulative total) | Same as above | **NO — honestly absent** |
| "নতুন (৩০ দিন)" sub-lines (orgs/users cards) | Series `newOrgs`/`newUsers` are calendar-month; the overview figures are rolling 30 days — the windows differ, so a side-by-side would compare unlike periods | **NO — honestly absent** |
| Ad Spend (Tracked) | No ad-spend field in the series buckets | **NO — honestly absent** |
| AI ব্যবহার (এই মাস) | No AI field in the series buckets | **NO — honestly absent** |
| ব্যর্থ Job (২৪ ঘণ্টা) | No failed-job field in the series buckets | **NO — honestly absent** |

A ▲▼ percentage is deliberately **not** rendered even for
orders/revenue: the current month is incomplete and the previous
month is complete, so a percentage would dress a partial period
up as a trend. The plain previous-month reference (the ADX5
honesty contract) is kept, now in one uniform line style instead
of being buried inside the orders card's sub-line.

## ADNX8 — Customers (`120aba2`)

Shared components (additive only, in `apps/admin/src/components/ui.tsx`):
- `PageHead` gained an optional `breadcrumb` slot (rendered in the
  main column above title/sub) — existing usages unaffected.
- `FilterBar` gained `activeCount` — shown as a count badge on the
  mobile "ফিল্টার" toggle so a collapsed bar still reveals that
  filters are active.

List pages (`/orgs`, `/users`):
- PageHead adopted (sub-line; shell keeps the h1).
- **Active-filter chips:** a chip row under the FilterBar (visible
  even while the mobile bar is collapsed) — one chip per active
  filter (search text / status / plan or admin), each chip's ✕
  clears only its own filter through the same state setters, plus
  a "সব ফিল্টার মুছুন" reset. No new filter semantics.
- DataTable card mode was verified against the pages' real columns
  (all cells already carry `data-label` from NB1); no page-level
  horizontal scroll is introduced — the table keeps its own
  `.atable-wrap` container.
- Drawer quick-view from both lists is untouched and working.

Detail pages (Org Detail + User Detail) — unified to ONE pattern:
- PageHead with **breadcrumb + status badges** (badges moved out of
  the old sticky header; the summary tab still shows them too).
- **Action bar:** sticky at the top on `lg`; on mobile a fixed
  bottom bar directly above the NB1 quick bar
  (`bottom: calc(64px + safe-area-inset)`), with an end-of-page
  spacer so content is never hidden behind it. Same buttons, same
  order, same labels. Tabs kept on both pages.
- One body-copy line on Org Detail was updated to stay truthful
  about the moved bar ("sticky header / মোবাইলে নিচের action bar")
  — no button/endpoint/label change.

### Toast adoption record — Customers

| Page | Moved to toast | Kept as banner / inline — and why |
|---|---|---|
| `/orgs` | Bulk status result (success + failure) — was the page's only feedback banner | — |
| `/users` | (no banner existed) | — |
| Org Detail | Status changes (suspend/reactivate/soft-delete), data-export result, name-mismatch cancellation, subscription save, limits save, conversation-body fetch failure; note-add now confirms by toast (it was previously completely silent) | **Permanent-deletion certificate stays a banner:** it carries long persistent data (per-table counts) the operator may need to read/copy while the page redirects after 3.5s — a 6-second auto-dismiss toast cannot carry it. **View-As card error stays inline:** it sits next to the retry buttons inside that card and persists until the next attempt. **Flags toggle:** no banner existed and none was added — the reload is the feedback, unchanged. |
| User Detail | All `act()` flows (activate, suspend, soft-delete, force-reset, revoke-sessions, grant/revoke admin) success + failure; note-add toast (was silent) | **Password-reset link box stays:** it contains the actual link the operator must copy — persistent data, not feedback. |

## ADNX9 — Money (`9d82ea7`)

Billing:
- PageHead adopted. **KPI strip** (MRR / this-month collected /
  total collected / trialing / overdue): snap rail on mobile,
  grid on `sm+` (2-col, 5-col xl) — same five figures, same source.
- **Manual-payment form rebuilt on one Form pattern:** labels and
  the existing help line kept; validation is now field-level
  (organization → "Organization বেছে নিন।", amount → "সঠিক
  পরিমাণ দিন।" — the two halves of the previous combined
  message), rendered under their fields and persistent until
  fixed; submit shows a busy state ("হচ্ছে…", the console's
  existing pattern) and is disabled while recording. The coupon
  form got the same treatment for its validation error + busy
  state. Payloads unchanged.
- Payments + checkout tables keep the NB1 card-mode classes
  (`atable-cards atable-v3`, `data-label` on every cell — verified
  present at base) and were not restructured.

Payouts:
- PageHead adopted, with a **pending-decision badge** counted from
  the rows the page already loaded (shown only in the unfiltered
  view, so a filtered list can never understate it).
- Queue order (pending → approved → terminal, newest first),
  step states and the ConfirmModal approve/reject/mark-paid flow
  are unchanged.
- **Four-eyes flag:** verified present at base — it is driven by
  `wallet.payoutFourEyesThresholdMinor` from the existing
  `GET /admin/platform-config`; rows at/above the threshold show
  the amber flag, and when the threshold is unset nothing is
  flagged. **No other "large amount" signal exists in the payout
  payload or config, so no second flag was invented.**
- Statement download feedback by toast in stages:
  "Statement তৈরি হচ্ছে…" (info) → "Statement ডাউনলোড হয়েছে।"
  (success) / failure toast. The endpoint returns a single blob —
  there is no byte stream to derive a percentage from, so **no
  % progress is claimed**.

### Toast adoption record — Money

| Page | Moved to toast | Kept with the form — and why |
|---|---|---|
| Billing | Record payment, refund, reconcile, coupon create, coupon toggle, invoice email, payment delete, CSV/invoice open failure | Manual-form field errors + coupon validation error stay inline with their forms (persistent until fixed; field-level per ADNX4's form pattern) |
| Payouts | Approve, reject, mark-paid, adjustment success, statement stages | Adjustment validation error stays inline with its form (same reasoning); toast texts keep the original wording — only the ✅/❌ prefixes were dropped, since the toast kind already carries success/error |

### Contrast sweep (ADNX8(d) / ADNX9(c))

Page-level small `text-slate-500` (measured 4.24:1 on slate-950,
3.75:1 on slate-900 in NB1 — below WCAG AA) → `text-slate-400`
(7.87:1 / 6.96:1) on all seven NB2 pages. Final count of
`text-slate-500` in every NB2 page file: **0** (overview 11 sites,
org detail 12, orgs 3, users 3, user detail 2, billing 6,
payouts 2 — the remainder of each page's original count had
already been converted inside blocks restructured by this batch).
Shared-component occurrences in `ui.tsx` (DetailDrawer sub,
SavedViewsBar, ConfirmModal optional marker) were NOT swept —
they are shared by NB3/NB4 pages too; see deferred list.

## Gates (run SERIALLY, one heavy gate at a time, recorded as they finished)

| Gate | Result |
|---|---|
| Admin `tsc --noEmit` | **0 errors** — after ADNX4, after ADNX7 (one JSX nesting slip in the storage fragment was caught here and fixed before commit), after ADNX9, and a final batch-end run |
| Admin `next build` | **Green** — compiled successfully, static generation 23/23; route table lists the same **22 routes** as base (21 static + `/orgs/[id]`, `/users/[id]` dynamic; `_not-found` excluded, as at base) |
| ADNX3 grep gate (`window.prompt/alert/confirm` + bare calls, `apps/admin/src`) | **0 matches** |
| Route set-diff (page.tsx files, base `2df46a7` vs final) | **Identical — 22** |
| Nav href set-diff (`nav.tsx`) | **Identical** |
| API path set-diff (`/admin/...` string literals in `apps/admin/src`, one consistent scan) | **Identical — 115 = 115**, zero added, zero removed (NB1's doc counted 116 with its own scan; under any single consistent method this batch adds and removes none) |
| Button-label scan | No visible button label removed. Changes are: two buttons gained the console's existing busy-state alternate label ("হচ্ছে…" while busy — coupon create, manual record); the FilterBar mobile toggle gained the active-count badge; genuinely new buttons are additions only — filter chips (✕, aria-labelled) + "সব ফিল্টার মুছুন" on `/orgs` + `/users`, and the storage section toggle on `/` (previously a plain heading with the same text) |
| Payload/behaviour scan | No `apiFetch` path, method or body changed in any hunk; conversions touch only feedback calls (`setMsg` → `toast`), validation rendering, and layout classes |
| Working tree | Clean at batch end (build artifact `tsconfig.tsbuildinfo` restored, not committed) |

PageHead adoption after NB2: **7 of 22 pages** (overview, orgs,
org detail, users, user detail, billing, payouts) — the first
adopters; the remaining pages belong to NB3/NB4.

## NOT BUILT / DEFERRED (explicit)

1. **States for NB3/NB4 pages — DEFERRED to their batches:**
   tickets, audit, admins (ADNX10); health, alerts, system,
   social-ops (ADNX11); analytics, usage, growth (ADNX12);
   security, settings (ADNX13); search, login, TOTP (ADNX14).
   Their state gaps recorded in the plan (§১.২ item 4) are
   untouched by this batch, per the batch split.
2. **Screenshot / browser QA — NOT done** (plan assigns it to
   NB5 / ADNX16). Nothing here claims visual QA; verification is
   code-level (gates + set-diffs above). One specific thing NB5
   should check: on detail pages the toast stack (fixed at
   `bottom: 76px` on mobile) may transiently overlap the new
   mobile bottom action bar — cosmetic and temporary, but
   unverified visually.
3. **Shared-component slate-500 sweep — DEFERRED.** `ui.tsx`
   still uses `text-slate-500` in the DetailDrawer sub-line,
   SavedViewsBar and the ConfirmModal "(ঐচ্ছিক)" marker. These
   components render on NB3/NB4 pages too, so the sweep belongs
   with a cross-page pass, not inside NB2's page scope.
4. **▲▼ / percentage KPI trends — deliberately NOT built**
   (see the honesty table: an incomplete current month measured
   against a complete previous month would be a fabricated
   trend). Only the plain previous-month reference is shown,
   and only where definitions match exactly.
5. **A second payout "large amount" flag — NOT built.** No such
   field exists in the payout payload or platform config; the
   four-eyes threshold flag is the only amount flag, and it was
   already working.
6. **Org Detail flags-toggle feedback — unchanged.** It had no
   banner before and its failure path is a silent reload, as at
   base; converting it would have meant adding new error
   behaviour, which is outside this batch's presentation-only
   rule. Noted here so it is a recorded decision, not an
   oversight.
