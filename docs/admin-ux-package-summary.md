# Admin UX Package Summary — ADX1–ADX14 (DB1–DB4)

> Package: Admin Dashboard UX Redesign, approved in full by the
> owner on 2026-10-15. Worktree: `~/workspace/ai-marketing-saas-adx`,
> branch `admin-ux`, base Integration-6 HEAD `9322ddb`.
> **Local commits only — nothing in this package has been pushed
> or deployed.** Plan:
> `Admin-Dashboard-UX-Redesign-Master-Plan-2026-10-15.md`;
> architecture: `docs/admin-ux-architecture.md`; per-batch
> evidence: `docs/admin-design-db1/db2/db3/db4-acceptance.md`.
> This summary is the package's closing document.

## What the package set out to fix

The audit behind the plan (from the `fc93238` tree) found a
console that was functionally complete but hard to operate: a
sidebar of **17 items in only 3 groups** (9 unrelated jobs in one
"প্ল্যাটফর্ম" group), no badges, no command palette, no
breadcrumbs, emoji icons with a duplicate, a 567-line / 17-card
Settings page and a 393-line / 10-card System page as undivided
scrolls, and a 102-line design system with no shared page
patterns. The package rebuilt the information architecture, the
shell, the design system, and every page's interior — with a
zero-loss rule (no route, href, endpoint, button or label may
disappear) proven mechanically in every batch.

## Per-item summary

**FIX-0** — `bbeedb8` · The bug DB1 found while building
nav-counts: `AdminService.overview()` counted failed sync jobs by
`SyncJob.updatedAt`, a field the model does not have, so the live
Command Center silently reported **0 failed sync jobs** forever
(the throw was swallowed by `.catch(() => 0)`). Fixed to the
`startedAt` definition every other failed-sync query uses, with a
spec whose fake Prisma throws on an `updatedAt` clause — it fails
on the old code by construction.

**ADX1** — `b548499` · UX architecture document (no code): the
final 7-group task-based menu, a one-line primary task for all 22
admin routes, the nav-counts field definitions, the badge honesty
rule (absent ⇒ render nothing, never an invented number), the
zero-loss baseline (17 nav hrefs, 22 routes, 148 API decorators),
and 5 operator journeys with current-vs-target step counts
(J1 11→1 glance, J2 5→3, J3 6→4, J4 6→3, J5 8→3), each stating
honestly which batch delivers which half.

**ADX2** — `5024d5c` · Navigation v2: 7 collapsible task groups
(18 items — the 17 existing hrefs plus `/search` promoted to a
nav item), one hand-written SVG icon per item (no emoji, no new
dependency), persisted group state with the active route's group
auto-opened, ⭐ favorites (pin/unpin, persisted), 🕘 recents
(auto, max 5), badge slots, icon-only collapsed mode with
tooltips and count bubbles, and the mobile drawer rendering the
exact same `NavContent`.

**ADX3** — `47bdb55` · Topbar v2 + the package's **only** new API
endpoint, `GET /admin/nav-counts` — all five counts honestly
sourced, none omitted (pending payouts, open tickets
open+pending, failed jobs 24h with the corrected `startedAt`
definition, active alerts via `alertsBoard()` reuse, overdue
subscriptions via `billingSummary()` reuse), each field omitted
individually if its query fails. Web side: Ctrl+K/Cmd+K command
palette (nav pages + live entities from the existing
`/admin/search`), an Attention Bell that renders **nothing** when
counts are unavailable (never a fake all-clear), and breadcrumbs
on the org/user detail pages.

**ADX4** — `d7ec9a2` (+ CSS fix `31dde24`) · Design System v3:
globals.css 102 → 178 lines, **append-only** (every v2 class kept
working), design tokens, and `components/ui.tsx` — `PageHead`,
`FilterBar`, `Tabs`, `DetailDrawer`, `EmptyState`, `ErrorState`,
`SortableTh`, and `ConfirmModal` (the modal replacement for
`window.prompt` on reason-required actions, same ≥3-char
contract; `reasonPrompt` itself untouched). The fix commit exists
because the build caught Tailwind forbidding `@apply group` —
recorded in the DB2 acceptance as the gate working as intended.

**ADX5** — `3acd655` · Command Center: a "আজকের করণীয়" row
driven by nav-counts (one card per *available* count, each
linking to its queue; genuine 0 = calm state; endpoint down =
row absent), task-first quick actions (4 originals kept +
Payouts added), and a **partial** KPI comparison — only the
Orders card gained a plain previous-month reference from M37's
series, because it is the only figure whose definition matches
the series buckets exactly; no % change or trend arrow anywhere.

**ADX6** — `940bf82` · Customers: `/users` and `/orgs` gained a
FilterBar (client-side status/plan/admin filters — the controller
accepts only `q/page/take`, and no server param was invented),
sortable headers, sticky table headers, and a per-row quick-view
drawer using only fields the list API already returns. Both
detail pages regrouped their stacked cards into Tabs using only
pre-existing content, with a sticky header keeping status and
every primary action visible on all tabs. apiFetch set-diffs:
identical on all four pages.

**ADX7** — `fbb3362` · Money: Billing's seven cards regrouped
into KPI strip + three Tabs (all figures from data the page
already loaded); Payouts became a queue — client-side status-rank
ordering stated in the UI copy, a step-state column
(অনুরোধ → Approve → Mark Paid), the AN2 wallet-statement
downloads reachable per row, and the action prompts moved to
ConfirmModal. The four-eyes flag is honestly sourced: the
threshold is read from the existing `GET /admin/platform-config`
(`wallet.payoutFourEyesThresholdMinor`); unset or unreadable ⇒ no
flag is shown, never a guessed "large amount".

**ADX8** — `36fbf9a` · Health/System/Alerts: a traffic-light
summary strip on Health derived only from already-loaded data
(no light renders for an unloaded area); System's 10 cards
regrouped into Tabs — five plan-named tabs plus a **declared
sixth** for the Activity Log card, which fits none of the five
honestly; the AA1 deploy banner lifted to page level so no tab
can hide it; Alerts grouped by the payload's own `severity`
field (no acknowledge state exists — alerts are computed, not
stored — so none was invented).

**ADX9** — `1a04736` · Settings Config Hub: the 567-line /
17-card page became one page with a sticky sub-nav and **7
sections** — the plan's 6 plus a declared সাধারণ section for the
platform-state/pricing/kill-switch/maintenance/allowlist blocks
that belong to none of the six (all 18 blocks mapped in the DB3
acceptance, none unmapped). Hash deep-links (`#payment-bkash`,
aliases, direct block ids) open the right section, scroll and
highlight; all sections stay mounted so unsaved input survives
section switches. Zero config behaviour change — proven by
identical apiFetch sets, `pc-*` input ids, `patch()` areas and
`test()` call sets. No "যাচাই হয়েছে" badge was fabricated:
`PlatformConfigView` has no verified-state field, so only the
real source badges are shown.

**ADX10** — `05c6a41` · Support & Trust: Tickets became an inbox
(master-detail, client-side priority-then-recency ordering
stated in the UI copy, mobile back-to-list); Audit gained the
v3 FilterBar, a detail drawer, and **one declared addition** —
the page now sends the controller's pre-existing `userId` param
as the actor filter (the CSV export shares the query; no new
endpoint); Security regrouped into 3 Tabs with handlers
identical; Admins already carried tier badges and `lastLoginAt`
(DB3 verdict: data already satisfied) and only adopted the v3
state components.

**ADX11** — `673d4d0` · Analytics/Usage/Growth/Social-Ops:
Analytics' period selector is an honestly labelled client-side
**month window** (3/6/12) over the monthly series — the endpoint
has no day buckets, so no ৭/৩০/৯০-day selector was fabricated;
Usage became sortable ranking tables with a **no-cost verdict**
(neither usage payload carries a cost field, so it ranks usage —
money stays on the Analytics operator-rate board); Growth
regrouped into Tabs, with the plan's "Announcements" tab **not
built** because announcements live in Settings (ADX9), not on
that page; Social-Ops split into explicit Social / Ad sections,
failed-first, AN13 retry on the row.

**ADX12** — `71abbdc` · States & responsive completion: all 22
routes audited in a per-page table (DB4 acceptance) and the two
systematic defects fixed — perpetual "লোড হচ্ছে…" on failed
loads (now `ErrorState` + a retry of the page's existing load)
and swallowed load errors masquerading as empty results (the
Alerts page even showed its 🎉 empty card on an outage). Empty
states no longer flash during first loads. Responsive:
`FilterBar` gained an opt-in collapsible mode (adopted on
users/orgs/audit); tables keep horizontal scroll, with one
opt-in exception — the Admins roster's `.atable-cards` mobile
card form.

**ADX13** — `5933a56` · Screenshot & usability QA checklist
(document only): 135 boxes, **all unchecked**, covering the new
shell — 22 routes × desktop/mobile × empty/populated, shell,
Settings hash, journey step-count and saved-view checks, plus a
sign-off block. It explicitly does **not** replace the AN10
checklist, which stays for the surfaces it covered. Execution is
deploy-gated; nothing in this package claims any screenshot QA
has happened.

**ADX14** — `f3a3153` · Light personalization (client-side only):
a density toggle (comfortable/compact, persisted, applied
app-wide via `<html data-admin-density>` + append-only CSS);
saved views on users/orgs/audit/tickets over each page's
existing filter state (localStorage per page, silently degrading
when storage is blocked/corrupt); and the favorites loop
completed — DB1's pin/unpin was verified already complete, DB4
added the two missing pieces (an empty-favorites hint and
keyboard-focus visibility for the pin star).

## Gate history

| Batch | API Jest (admin) | Admin tsc | API tsc | Admin build | Zero-loss evidence |
|---|---|---|---|---|---|
| DB1 | 18 suites / 210 tests ✅ (17 prior + new nav-counts spec 7/7) | 0 | 0 | Green, 22 routes | Nav 17→18 (only `+/search`); routes identical (22); API decorators 148→149 (only `+nav-counts`) |
| DB2 | 19 suites / 212 tests ✅ (+ FIX-0 spec 2/2) | 0 | 0 | Green, 22 routes | Per-page apiFetch diffs identical or declared-additions-only; API routes identical; globals selectors zero removed |
| DB3 | 19 suites / 212 tests ✅ (API untouched) | 0 (after every item) | — | Green, 22 routes | apiFetch identical on all 12 touched pages; declared additions documented (audit `userId` param, System 6th tab, Growth tabs); globals untouched |
| DB4 | 19 suites / 212 tests ✅ (API diff vs DB3 = 0 lines) | 0 | — | Green, 22 routes | apiFetch identical across all 22 pages vs DB3 HEAD; globals selectors zero removed (append-only additions) |

Package totals: 20 commits on `admin-ux` over base `9322ddb`
(15 item commits — FIX-0 + ADX1–ADX14 — plus 1 ADX4 CSS fix and
4 batch docs commits; this summary ships inside the DB4 docs
commit). One new API endpoint in the whole package
(`GET /admin/nav-counts`). No migration, no schema change, no
new dependency.

## Settled decisions (owner-approved package, plan §৭)

- **Settings = in-page sub-nav + hash links** (no new routes) —
  the plan's recommendation, adopted because the owner approved
  the package without overriding it. Binds ADX9 as built.
- **Menu groups auto-collapse** (only the active group open by
  default; manual state persisted) — same basis. Binds ADX2/DB4.
- Dark theme only; Bangla-first labels with established English
  product terms kept; badge numbers only from the real API.

## Every documented deviation / verdict in the program

1. **Role-aware nav display — SKIPPED with proof** (DB1).
   `adminTier` never reaches the client (`issueToken` returns
   only id/email/name/isSuperAdmin); guessing a tier would
   mislabel SUPPORT/FINANCE operators as SUPER. API guards were
   never the nav's job and are unchanged.
2. **FIX-0** (found DB1, fixed DB2) — overview()'s failed-sync
   count referenced the nonexistent `SyncJob.updatedAt` and
   silently read 0 in production; corrected to `startedAt`.
3. **ADX5 comparison — PARTIAL by design.** Only the Orders KPI
   carries a previous-month reference; signups/ad-spend/AI
   comparisons omitted because the shapes do not match honestly,
   and no %/trend arrows anywhere (the current month is
   incomplete).
4. **ADX7 four-eyes flag — sourced, not guessed.** Threshold
   from the existing platform-config read; absent when unset or
   unreadable. Side effect recorded in DB2: the reject note and
   mark-paid reference now follow the ConfirmModal ≥3-char
   contract — a deliberate, documented tightening over the old
   any-non-empty prompts.
5. **ADX8** — a sixth System tab (Activity Log) beyond the
   plan's five, declared; Alerts has no acknowledge state
   because alerts are computed, not stored.
6. **ADX9** — a seventh Settings section (সাধারণ) beyond the
   plan's six, declared with the full 18-block mapping; no
   verified-state badge (the payload has no such field).
7. **ADX10** — the audit actor filter is a declared addition of
   a query param on the pre-existing endpoint, not a new API.
8. **ADX11** — Analytics uses a month window, not day ranges;
   Usage ranks usage, not cost (no cost field exists); Growth's
   "Announcements" tab not built (announcements live in
   Settings).
9. **ADX12** — the mobile card form was adopted for exactly one
   table (Admins roster); all other tables keep horizontal
   scroll by design. Two pre-existing shapes documented, not
   restructured: analytics sub-sections and growth array boards
   still fold a failed fetch into their empty text.
10. **ADX14 favorites** — DB1's implementation verified
    complete; only the empty hint and focus visibility were
    actually missing.
11. **ConfirmModal adoption is partial** — payouts (ADX7) uses
    it; other pages still use the untouched, still-supported
    `reasonPrompt`/`window.prompt`. Full migration was never
    claimed in any batch.

## What remains owner-gated

- **GitHub push** — only on the owner's explicit in-the-moment
  instruction (standing rule); before any push, ls-remote +
  fetch first and merge the owner's own commits, never
  overwrite. This package is local commits on `admin-ux` only.
- **Dokploy Redeploy** — the owner's manual step; nothing here
  is live until then.
- **ADX13 execution** — the 135-box screenshot/usability QA runs
  only after deploy, on live `admin.qosprey.com` in a real
  browser (the AN10 checklist's 49 boxes also remain unchecked
  and post-deploy).
- **M30 live verification** — still owed across the product
  (real Meta/LLM/courier/messaging credentials, session by
  session); nav-counts in particular has only mocked-Prisma spec
  proof, never a run against the production database.
- **AN4–AN8 / AB1 setup track** (Admin Next) — gateway
  credentials, legal review, per-org job enables and the rest of
  the owner-only checklist are unaffected by this package and
  remain open on their own track.

## Honest limits

- **No live proof of anything in this package.** Every claim
  rests on typecheck, production builds, mocked-Prisma unit
  specs, and mechanical set-diffs.
- **No screenshot QA has ever been run** on the new shell —
  ADX13 is a checklist, not a result.
- **Journey step targets are package targets**, measured from
  code in ADX1; the real counts are ADX13's post-deploy
  measurement, still unmeasured.
- **Personalization is per-browser** (localStorage): density,
  favorites, recents, group state and saved views do not follow
  the operator across devices, and a fresh browser starts from
  today's defaults — by design for a light-personalization item.
- The role-aware nav remains unbuilt until the auth API exposes
  `adminTier` to the admin client (verdict 1 above).
