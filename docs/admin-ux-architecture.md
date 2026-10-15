# Admin UX Architecture — ADX1 (DB1)

> Package: Admin Dashboard UX Redesign (ADX1–ADX14), Batch DB1.
> Source plan: `Admin-Dashboard-UX-Redesign-Master-Plan-2026-10-15.md` (§২, §৩, §৫ DB1, §৭, §৮).
> Base tree audited for this document: Integration-6 HEAD `9322ddb`
> (`apps/admin/src/components/AdminShell.tsx`, all 22 admin `page.tsx` files,
> `apps/api/src/admin/admin.controller.ts` + `admin.service.ts`,
> `packages/db/prisma/schema.prisma`).
> This document is architecture only — no code changes in ADX1.
> The code that implements it is ADX2 (Navigation v2) and ADX3 (Topbar v2 +
> `GET /admin/nav-counts`).

---

## 1. Settled owner decisions (§৭ of the master plan)

The owner approved the full ADX package on 2026-10-15 without overriding
the plan's two recommendations, so both are **settled and binding** for the
rest of the package:

1. **Settings structure (binds ADX9): in-page sub-nav with hash links.**
   `/settings` stays ONE route. Inside it, a left sub-nav splits the
   current 17 stacked cards into sections (AI ও মিডিয়া / অ্যাপ সংযোগ /
   বার্তা / পেমেন্ট / Flags ও Plan Defaults / ঘোষণা), and every section /
   config block is deep-linkable via URL hash (e.g. `/settings#payment-bkash`).
   No new settings routes are created; no config key, endpoint, or save/test
   behaviour changes.
2. **Menu group folding (binds ADX2): auto-collapse.** Only the group
   containing the active route is open by default; other groups start
   folded. The operator may open/close any group manually and that manual
   state is persisted in `localStorage`; on navigation, the active route's
   group is always revealed (auto-open wins over a stored closed state for
   that one group, so the current page is never hidden inside a folded
   group).

Two further plan rules are restated here because every later batch
depends on them:

- **Dark theme only.** No light theme in this package.
- **Bangla first.** Nav labels and help text in Bangla; established
  English product terms (Billing, Payout, Analytics) stay in English with
  the Bangla group context around them.

---

## 2. Final navigation structure — 7 task-based groups

Replaces the current 3 groups / 17 items in `AdminShell.tsx`
(`প্রধান` 2 · `ব্যবস্থাপনা` 6 · `প্ল্যাটফর্ম` 9). The new structure has
**7 groups / 18 items**: all 17 existing hrefs are preserved, and
`/search` — which exists as a route today but is reachable only through
the topbar form — becomes a first-class nav item. No href is removed,
renamed, or re-targeted.

| # | Group (Bangla) | Items (href — label) | Badge source (ADX3) |
|---|---|---|---|
| 1 | হোম | `/` — Command Center | — (the Attention Bell total covers it) |
| 2 | কাস্টমার | `/orgs` — Organizations · `/users` — Users · `/search` — Search (সব খুঁজুন) | — |
| 3 | টাকা-পয়সা | `/billing` — SaaS Billing · `/payouts` — Wallet Payouts · `/usage` — Usage & Cost | `overdueSubscriptions` → Billing · `pendingPayouts` → Payouts |
| 4 | সাপোর্ট ও আস্থা | `/tickets` — Support Tickets · `/audit` — Audit Trail · `/security` — Security | `openTickets` → Tickets |
| 5 | প্ল্যাটফর্ম পরিচালনা | `/health` — Platform Health · `/system` — System & Reliability · `/alerts` — Proactive Alerts · `/social-ops` — Social & Ads Ops | `failedJobs24h` → Health · `activeAlerts` → Alerts |
| 6 | গ্রোথ ও বিশ্লেষণ | `/analytics` — Analytics · `/growth` — Growth Ops | — |
| 7 | সেটিংস | `/settings` — Settings & Config · `/admins` — Admins | — |

Ordering rationale (plan §২ principle 1 — "কাজ দিয়ে ভাগ"): the groups
follow the operator's day — home/status first, then customers, money,
support, platform operations, growth, and finally configuration. The old
`প্ল্যাটফর্ম` group mixed 9 unrelated jobs (config + health + social ops +
alerts + system + growth + usage + security + admins); those 9 are now
spread across groups 3, 4, 5, 6 and 7 by the job they belong to:
Usage & Cost → টাকা-পয়সা, Security → সাপোর্ট ও আস্থা, Social & Ads Ops →
প্ল্যাটফর্ম পরিচালনা, Growth Ops → গ্রোথ ও বিশ্লেষণ, Admins → সেটিংস.

### 2.1 Shell elements around the groups

- **⭐ প্রিয় (Favorites)** — a section above the groups. Any nav item can
  be pinned/unpinned (pin control on the item itself); the pinned set is
  persisted in `localStorage`. Empty until the operator pins something —
  no default pins are invented.
- **🕘 সাম্প্রতিক (Recent)** — a section above the groups, fed
  automatically by visited routes, most-recent first, **max 5**,
  de-duplicated, persisted in `localStorage`. The current page is not
  repeated at the top of its own list on the page itself is acceptable —
  the list simply reflects visit order.
- **Collapsible groups** — per §1 decision 2: auto-open the active
  route's group; manual open/close state persisted in `localStorage`.
- **Icon-only collapsed sidebar** — the existing collapse toggle keeps
  working. In collapsed mode each item shows its icon with a tooltip
  (native `title` + label), and clicking a group icon expands the
  sidebar (expand-on-click) so the item can be chosen — no item becomes
  unreachable in collapsed mode.
- **Mobile drawer** — renders the exact same `NavContent` component as
  the desktop sidebar (no second, divergent nav list).
- **Icons** — one distinct inline SVG icon per item, hand-written inside
  the admin app. No new dependency, and no emoji as nav icons (the old
  set reused 📈 for two different items).
- **Badges** — each item has a badge slot (see §4 honesty rule). A badge
  renders only when ADX3's `nav-counts` actually returns that count.

### 2.2 What ADX2 deliberately does NOT do

- **Role-aware de-emphasis: SKIPPED, with evidence.** The plan suggested
  visually de-emphasising items outside the operator's tier
  (SUPER / SUPPORT / FINANCE). That requires the tier client-side.
  Verified 2026-10-15: the login flow stores `body.user` in
  `localStorage["admin_user"]`, and `body.user` comes from
  `AuthService.issueToken()` (`apps/api/src/auth/auth.service.ts`), which
  returns exactly `{ id, email, name, isSuperAdmin }` — **no `adminTier`
  field**. The TOTP challenge response builds the same shape
  (`{ id, email, name, isSuperAdmin, totpEnabled }`). The tier exists
  server-side (`User.adminTier`, enforced by `SuperAdminGuard`, which
  sets `req.adminTier`) but is never sent to the admin client. Inventing
  a client-side tier (e.g. guessing from `isSuperAdmin`) would mislabel
  SUPPORT/FINANCE operators as SUPER, so ADX2 does not render any
  role-based styling. If a future item adds `adminTier` to the auth
  response, this section can be revisited; API guards are unchanged
  either way, and nav styling was never a security boundary.

---

## 3. Every admin route — one-line primary task

19 routes + 2 detail routes + login/TOTP = 22 `page.tsx` files at base.
("Route" below is the app route; API paths stay `/admin/...`.)

| Route | Primary task (one line) |
|---|---|
| `/` (Command Center) | See the whole platform's today at a glance — KPIs, failures, recent admin actions. |
| `/analytics` | Understand platform growth and revenue trends over time. |
| `/users` | Find a user and open their detail (status, memberships, admin actions). |
| `/users/[id]` | Act on one user — status, sessions, password reset, admin grant/revoke, notes. |
| `/orgs` | Find an organization and judge its health before opening it. |
| `/orgs/[id]` | Act on one organization — subscription, limits, flags, support view, notes. |
| `/billing` | Run SaaS billing — MRR, payments, overdue/dunning, manual payments, coupons. |
| `/payouts` | Decide tenant wallet payouts — approve/reject pending requests, mark paid exactly once. |
| `/usage` | See usage and AI cost per organization for the last 30 days. |
| `/tickets` | Work the support queue — read, reply to, assign and resolve tenant tickets. |
| `/audit` | Prove who did what — search the admin audit trail and export it. |
| `/settings` | Configure the platform — dynamic config, flags, plan defaults, announcements. |
| `/health` | Judge platform health — integrations, failing jobs, connections, retry/nudge. |
| `/social-ops` | Operate tenant social + ad accounts — boards, failures, operator retry. |
| `/alerts` | See proactively computed problems (broken integrations, past-due, expiring trials) and nudge orgs. |
| `/system` | Run reliability operations — queues, errors, webhooks, DLQ, backup record, deploy readiness, env check. |
| `/growth` | Run growth operations — platform campaigns, announcements/changelog surfaces, referrals/feedback boards. |
| `/security` | Guard the console itself — sessions, admins roster, API keys, IP allowlist, login anomalies, TOTP. |
| `/admins` | See the admin roster — who holds which tier and when they last logged in. |
| `/search` | Find any user, organization, or order from one query. |
| `/login` | Sign in as a platform admin (non-admin accounts are refused and logged). |
| `/login/totp` | Complete the two-factor step of an admin sign-in. |

---

## 4. Badge honesty rule (binds ADX2, ADX3 and all later batches)

1. Every badge/bell number comes **only** from `GET /admin/nav-counts`
   (ADX3), which counts real rows in real tables (see §5). No number is
   ever computed client-side from page data, estimated, or hard-coded.
2. **Absent means absent.** If the endpoint fails, or a field is omitted
   from its response, the corresponding badge — and, if no fields are
   available at all, the Attention Bell itself — renders **nothing**.
   Absence of data is never rendered as `0`, and never as an
   "all clear" message.
3. A genuine `0` returned by the API is shown as data: badges may hide
   on zero by design (a `0` badge carries no signal), but the bell
   dropdown may then honestly say "কোনো করণীয় নেই" — only when every
   count was actually returned.
4. Each count's definition is fixed in §5 and in the ADX3 acceptance
   doc; changing a definition means changing both documents.

---

## 5. nav-counts definitions (ADX3 contract)

`GET /admin/nav-counts` (SuperAdminGuard, like every other `/admin`
route) returns a flat object; **any field that cannot be sourced
honestly is omitted, not zero-filled**:

| Field | Definition (verified against schema + existing service code) |
|---|---|
| `pendingPayouts` | `PayoutRequest.count(status = "pending")` — status is a plain string, comment in schema: `pending \| approved \| paid \| rejected \| cancelled`. |
| `openTickets` | `SupportTicket.count(status IN ("open", "pending"))` — schema comment: `open \| pending \| resolved \| closed`. Both non-terminal states need operator attention (an admin reply moves `open → pending`, the tenant can re-open it); the field name in the UI is "খোলা টিকিট". Terminal states are never counted. |
| `failedJobs24h` | `SyncJob.count(status = "FAILED", startedAt >= now-24h)` **+** `AutomationRun.count(status = "error", createdAt >= now-24h)` — the same definition as `AdminService.overview()` (`SyncJobStatus` enum has `FAILED`; `AutomationRun.status` is a string with `error` used by overview), with one documented correction: overview() filters SyncJob by `updatedAt`, **a field the SyncJob model does not have** (schema: `startedAt`/`completedAt` only), so against real Prisma overview's query throws and its `.catch(() => 0)` silently reports 0 — a latent base-code bug, recorded in the DB1 acceptance doc. nav-counts uses `startedAt`, the field every other failed-sync query in the service uses. If either query fails, the whole field is omitted — a partial sum would understate failures. (Overview itself defaults each side to 0 on error; nav-counts is stricter because a badge that understates failures is worse than no badge.) |
| `activeAlerts` | `AdminService.alertsBoard().length` — alerts are **computed**, there is no alerts table: broken integrations (`Integration.status = "ERROR"`), integrations with ≥2 failed sync jobs in 24h, latest-subscription `PAST_DUE` per org, trials expiring within 3 days. Reusing `alertsBoard()` guarantees the badge can never disagree with the Alerts page. If the board computation throws, the field is omitted. |
| `overdueSubscriptions` | `AdminService.billingSummary().overdue.length` — the same "overdue" the Billing page shows: per-org latest subscription that is `PAST_DUE`, or `ACTIVE`/`TRIALING` with `currentPeriodEnd` in the past. Reused, not re-implemented, so badge and page cannot diverge. If it throws, the field is omitted. |

No schema change, no migration, no new table. This endpoint is the
**only** new API surface in the entire ADX package.

---

## 6. Operator journeys — current vs target

**Counting method (applied identically to both columns).** Start point:
signed-in operator on the Command Center (`/`), unless the journey says
otherwise. One **step** = one navigation click, OR one in-page locate
action (scanning a flat 17-item menu, scanning/scrolling a stacked-card
page to find the relevant block, setting a filter the task needs), OR
one action click. Pure reading of an already-visible summary = 0 steps.
Counts were measured from the base code: menu = 17 always-visible items
in 3 groups; Settings = 567 lines / 17 cards on one scroll; System = 393
lines / 10 cards; Payouts default filter = all statuses; Search exists
only as the topbar form.

**Scope honesty:** DB1 (ADX2+ADX3) delivers the shell gains — grouped
menu, badges, bell, palette, breadcrumbs. Page-interior gains
(Settings sub-nav, Payouts queue layout, Tickets inbox layout,
System tabs) land in DB2/DB3 (ADX5–ADX11); the Target column is the
**package target**, and the "of which DB1" column states what DB1 alone
already achieves so no batch over-claims.

### J1 — Morning check ("what needs me today?")

| | Steps | Path |
|---|---|---|
| Current | **11** | Overview glance (0) → locate Health in the 9-item প্ল্যাটফর্ম group (1) → open Health (1) → scan 4 cards (1) → locate Alerts (1) → open Alerts (1) → locate Payouts in ব্যবস্থাপনা (1) → open Payouts (1) → locate Tickets (1) → open Tickets (1) → locate Billing for overdue (1) → open Billing + scan 7 cards for the overdue part (1) |
| Target | **1 + 1 per drill-down** | Glance at sidebar badges + Attention Bell on the page already open (1 glance, 0 navigation) → each queue is then exactly 1 click from the bell dropdown or its badged menu item. Knowing the state of all five queues costs **zero page visits**. |
| Of which DB1 | All of it — badges, bell and grouped menu are ADX2/ADX3. |

### J2 — Payout approval (approve one pending payout, later mark it paid)

| | Steps | Path |
|---|---|---|
| Current | **5** (approve) | Locate Wallet Payouts among 17 flat items (1) → open Payouts (1) → list defaults to **all** statuses, scan past approved/paid/rejected rows to find the pending one (1) → Approve click (1) → note prompt confirm (1). Mark-paid repeats the locate+scan (2) + Mark Paid click (1) + reference prompt (1). |
| Target | **3** (approve) | Bell/badge shows the pending count → click Payouts in the bell dropdown or the badged item (1) → pending queue is the default view with the request on top (ADX7) (0 locate) → Approve (1) → confirm (1). Mark-paid: 1 click in + Mark Paid (1) + reference (1). |
| Of which DB1 | The discovery half: count visible without visiting the page; entry is 1 click from the bell. The queue-default-view half is ADX7 (DB2). |

### J3 — Ticket handling (find the oldest open ticket and reply)

| | Steps | Path |
|---|---|---|
| Current | **6** | Locate Support Tickets (1) → open Tickets (1) → set the `open` filter (1) → scan the list and open the ticket (1) → type reply (0) → Send (1) → (the list re-scan to confirm state (1)). No menu signal exists that any ticket is waiting at all. |
| Target | **4** | Tickets badge shows open count → 1 click to Tickets → open the top ticket in the inbox layout (ADX10) (1) → reply in place (0 page change) → Send (1) → state updates in place (0 re-scan). |
| Of which DB1 | Badge + 1-click entry. The in-place inbox layout is ADX10 (DB3). |

### J4 — Config change (e.g. rotate the bKash platform config and test it)

| | Steps | Path |
|---|---|---|
| Current | **6** | Locate Settings & Config (1) → open Settings (1) → scroll/scan the 567-line, 17-card page to find the bKash card inside Platform Config (1–2, counted 1) → edit fields (0) → Save (1) → scroll back to the same card's Test button (1) → Test (1). No deep link exists — support cannot send the operator to the block. |
| Target | **3** | Ctrl+K "bkash" (or `/settings#payment-bkash` link) lands on the Payment section with the bKash block visible (1) → Save (1) → Test (1), status badge on the block updates in place (ADX9). |
| Of which DB1 | Ctrl+K palette reaches page level (1 step saved: no menu hunt). The in-page sub-nav + hash landing is ADX9 (DB3). |

### J5 — Problem hunting ("orders stopped syncing — where is it failing?")

| | Steps | Path |
|---|---|---|
| Current | **8** | Notice nothing on Overview except the combined failed-jobs KPI (0) → guess Health, locate + open it (2) → scan 4 cards, find failed sync jobs (1) → Retry (1) → if not there: locate System (1) → open System (1) → scroll 10 cards to Queues/Errors (1) → act (1). Search plays no part (it is a small topbar form that must be typed + submitted, and results open a separate page). |
| Target | **3** | Health badge / bell shows failed-jobs count → 1 click to Health → failing job visible in the traffic-light summary (ADX8) (0 locate) → Retry (1). Or from anywhere: Ctrl+K → type the org/store name → Enter opens its detail with breadcrumbs showing where you are (1–2). |
| Of which DB1 | Badge/bell discovery + palette + breadcrumb context. The traffic-light Health summary is ADX8 (DB3). |

### Journey summary

| Journey | Current | Package target | DB1 delivers |
|---|---|---|---|
| J1 Morning check | 11 | 1 glance (+1/drill-down) | ✅ shell-complete |
| J2 Payout approval | 5 | 3 | discovery half (badge/bell entry) |
| J3 Ticket handling | 6 | 4 | badge + entry |
| J4 Config change | 6 | 3 | palette entry |
| J5 Problem hunting | 8 | 3 | badge/bell + palette + breadcrumb |

---

## 7. Zero-loss rule (binds every ADX batch)

1. No route, nav href, endpoint, button, or label that exists at base
   `9322ddb` may disappear or change target in any ADX batch. Additions
   are allowed; the only planned API addition in the whole package is
   `GET /admin/nav-counts` (ADX3).
2. Every batch proves it with a set-diff: nav hrefs and app routes
   before vs after must be identical sets (plus declared additions),
   and the diff is recorded in that batch's acceptance doc.
3. Baseline at `9322ddb` (measured for DB1): **17 nav hrefs**
   (`/`, `/admins`, `/alerts`, `/analytics`, `/audit`, `/billing`,
   `/growth`, `/health`, `/orgs`, `/payouts`, `/security`, `/settings`,
   `/social-ops`, `/system`, `/tickets`, `/usage`, `/users`),
   **22 app page routes** (every route listed in §3, including `/`,
   `/search`, the two `[id]` detail routes, `/login` and `/login/totp`),
   **148 `@Get/@Post/@Patch/@Delete` decorators**
   in `admin.controller.ts` (147 distinct method+path pairs — `changelog`
   appears twice, once admin and once `@Public`).
4. Visual restructuring (groups, tabs, drawers) must keep every action
   reachable in the same number of clicks or fewer — if a redesign
   buries an existing action deeper, that is a loss and blocks the batch.

---

## 8. What DB1 does not claim

- No page interior is redesigned in DB1 (that is DB2/DB3); DB1 is the
  architecture doc, the navigation shell, and the topbar.
- No browser screenshot QA in DB1 — screenshot/usability QA is ADX13
  and is deploy-gated.
- No live-API proof in DB1: `nav-counts` is proven by unit specs with a
  mocked Prisma (the established admin spec pattern) and by the admin
  build, not against the production database.
