# Admin Design DB1 Acceptance — ADX1 + ADX2 + ADX3

> Package: Admin Dashboard UX Redesign (ADX1–ADX14), Batch DB1.
> Worktree: `~/workspace/ai-marketing-saas-adx`, branch `admin-ux`,
> base Integration-6 HEAD `9322ddb`. Local commits only — **not pushed**
> (push stays owner-gated, as always). Date: 2026-10-15.
> Plan: `Admin-Dashboard-UX-Redesign-Master-Plan-2026-10-15.md` §৫ DB1.

## Commits

| Item | Commit | Summary |
|---|---|---|
| ADX1 | `b548499` | `docs/admin-ux-architecture.md` — architecture only, no code |
| ADX2 | `5024d5c` | Navigation v2 — `AdminShell.tsx` rewrite + new `components/nav.tsx` |
| ADX3 | `47bdb55` | Topbar v2 — nav-counts API + palette + bell + breadcrumbs |
| (this doc) | — | acceptance commit |

Pre-work setup (not a code change): the fresh worktree had no
`node_modules`; the repo's established flow was used —
`pnpm install --frozen-lockfile`, `pnpm --filter @repo/db generate`,
`pnpm --filter @repo/db build`, `pnpm --filter @repo/contracts build`.
No `node_modules` was copied from a sibling worktree.

---

## ADX1 — UX Architecture document

`docs/admin-ux-architecture.md` (295 lines) contains:

- The **final 7-group task-based menu** (হোম / কাস্টমার / টাকা-পয়সা /
  সাপোর্ট ও আস্থা / প্ল্যাটফর্ম পরিচালনা / গ্রোথ ও বিশ্লেষণ / সেটিংস),
  18 items: the 17 base hrefs plus `/search` promoted to a nav item.
- **One-line primary task for all 22 admin routes** — the doc's §3
  table lists every `page.tsx` route in the app, including the two
  `[id]` detail routes, `/login` and `/login/totp`.
- **5 operator journeys** with current vs target step counts, measured
  from the base code with a stated counting method (1 step = 1 nav
  click, 1 in-page locate action, or 1 action click; start = signed-in
  Command Center): J1 morning check **11 → 1 glance (+1/drill-down)**,
  J2 payout approval **5 → 3**, J3 ticket handling **6 → 4**,
  J4 config change **6 → 3**, J5 problem hunting **8 → 3**. Each
  journey states honestly what DB1 alone delivers vs what lands in
  DB2/DB3 (e.g. J2's queue-default view is ADX7; J4's in-page landing
  is ADX9) — DB1 does not claim the page-interior gains.
- The **settled §৭ decisions**: (1) Settings = in-page sub-nav + hash
  links (binds ADX9); (2) menu groups auto-collapse (binds ADX2).
  The owner approved the package without overriding the plan's
  recommendations, so the recommendations are recorded as settled.
- The **zero-loss rule** (§7 of the doc, with the measured baseline)
  and the **badge honesty rule** (§4: counts only from the real API;
  absent ⇒ render nothing; never an invented or understated number),
  plus the **nav-counts field definitions** (§5).

## ADX2 — Navigation v2 (`apps/admin`)

Files: `src/components/AdminShell.tsx` (rewritten shell),
`src/components/nav.tsx` (new — nav single source of truth + SVG
icon set + persistence helpers).

Built:

- **7 collapsible task groups** exactly as ADX1 §2, covering all 17
  existing hrefs + `/search`. Group open/close state persists in
  `localStorage["admin_nav_open_groups"]`; the active route's group
  auto-opens on mount and on every navigation (settled decision 2 —
  the current page is never hidden in a folded group); an operator's
  manual close of a non-active group is respected.
- **Distinct inline SVG icon per item** — 24 hand-written stroke icons
  in `nav.tsx` (Lucide-style paths), no new dependency, **no emoji
  icons in the nav** (the old duplicated 📈 is gone; Analytics = bar
  chart, Growth Ops = trending arrow, Usage = gauge — all distinct).
- **Badge slot per item**, wired to the ADX3 counts shape: a badge
  renders only for a present number > 0; group headers also show the
  summed total while folded, so a folded group still signals work.
- **⭐ প্রিয়** — every row (expanded mode) has a pin/unpin star
  (visible on hover, filled amber when pinned); pinned items appear
  in a প্রিয় section above the groups; persisted in
  `localStorage["admin_nav_favorites"]`. No default pins invented.
- **🕘 সাম্প্রতিক** — visited nav items recorded automatically
  (detail pages map to their list item), most-recent first, max 5,
  persisted in `localStorage["admin_nav_recent"]`; shown above the
  groups in expanded mode.
- **Collapsed (icon-only) mode keeps working**: same footer toggle
  and `admin_nav_collapsed` key as before; every item stays reachable
  as an icon with a native tooltip (label, plus count when badged)
  and a corner count bubble; groups render as divider-separated
  clusters. (Folding and the প্রিয়/সাম্প্রতিক sections apply to the
  expanded mode; collapsed mode loses nothing it had at base.)
- **Mobile drawer reuses the exact same `NavContent`** component and
  the same state — no second nav list.
- **Every pre-existing shell behaviour preserved**: `/admin/health`
  auth check + login redirect, logout (token + `admin_user` cleared),
  collapse persistence, the topbar global-search form (unchanged in
  this commit; ADX3 extends the topbar around it), the email avatar,
  and the `reasonPrompt` export used by the detail pages.

### Role-display verdict: SKIPPED — with evidence

The plan offered role-aware de-emphasis (items outside the
operator's SUPER/SUPPORT/FINANCE tier shown de-emphasised). **Not
built**, because the tier is not available client-side and inventing
it would be dishonest:

- The login page stores `body.user` verbatim in
  `localStorage["admin_user"]`; the TOTP page does the same.
- `body.user` is produced by `AuthService.issueToken()`
  (`apps/api/src/auth/auth.service.ts`), which returns exactly
  `{ id, email, name, isSuperAdmin }` — **no `adminTier`**. The TOTP
  challenge response builds `{ id, email, name, isSuperAdmin,
  totpEnabled }` — also no tier.
- The tier exists only server-side (`User.adminTier`, read by
  `SuperAdminGuard` into `req.adminTier`). Guessing a tier from
  `isSuperAdmin` would mislabel every SUPPORT/FINANCE operator as
  SUPER. If a future item adds `adminTier` to the auth response,
  the styling can be added then. API guards are untouched either
  way; nav styling was never a security boundary.

## ADX3 — Topbar v2 + `GET /admin/nav-counts`

### (a) API — the package's only new endpoint

Files: `apps/api/src/admin/admin.service.ts` (`navCounts()`),
`apps/api/src/admin/admin.controller.ts` (`@Get("nav-counts")`,
guarded by the controller-wide `SuperAdminGuard` like every other
`/admin` route), `apps/api/src/admin/adx3-nav-counts.spec.ts` (new).
**No schema change, no migration.**

Counts — included, and how each is sourced (all verified against
`packages/db/prisma/schema.prisma` and the existing service code):

| Field | Source | Verdict |
|---|---|---|
| `pendingPayouts` | `PayoutRequest.count(status = "pending")` — schema string comment `pending \| approved \| paid \| rejected \| cancelled` | ✅ included |
| `openTickets` | `SupportTicket.count(status IN ("open","pending"))` — both non-terminal states need an operator (an admin reply moves open → pending; the tenant can re-open pending); terminal `resolved`/`closed` never counted | ✅ included |
| `failedJobs24h` | `SyncJob.count(status = "FAILED", startedAt >= now-24h)` + `AutomationRun.count(status = "error", createdAt >= now-24h)` — overview()'s definition, one correction (below); all-or-nothing on failure | ✅ included, corrected field |
| `activeAlerts` | `alertsBoard().length` — alerts are computed (no alerts table); reusing the board guarantees badge ≡ Alerts page | ✅ included |
| `overdueSubscriptions` | `billingSummary().overdue.length` — exactly the overdue list the Billing page renders (latest sub per org: `PAST_DUE`, or `ACTIVE`/`TRIALING` past `currentPeriodEnd`); reused, not re-implemented | ✅ included |

**Nothing was omitted**: all five planned counts had an honest real
source, so the response carries all five whenever their queries
succeed. Any individual query failure omits **only that field**
(`Promise.allSettled` per field); `failedJobs24h` omits as a whole if
either side fails, because a partial sum would understate failures.

**Deviation (documented, deliberate):** the task brief said to reuse
overview()'s failed-jobs logic exactly. overview() filters SyncJob
by `updatedAt` — **a field the SyncJob model does not have** (schema
fields: `startedAt`, `completedAt`, …). Against real Prisma that
query throws and overview's `.catch(() => 0)` silently reports 0
failed sync jobs — a latent base-code bug. navCounts therefore uses
`startedAt`, the field every other failed-sync query in the same
service already uses (`systemQueues`, `timeline360`). The definition
(FAILED in the last 24h) is unchanged; only the nonexistent column
reference was corrected. overview() itself was **not** modified
(outside DB1 scope) — the bug is recorded here and in the
architecture doc §5 for the owner to schedule.

### (b) Admin web

Files: `src/components/CommandPalette.tsx`, `AttentionBell.tsx`,
`Breadcrumb.tsx`, `useNavCounts.ts` (all new),
`AdminShell.tsx` (wiring), `src/app/orgs/[id]/page.tsx` +
`src/app/users/[id]/page.tsx` (breadcrumb).

- **Ctrl+K / Cmd+K palette** — global key handler in the shell
  (plus a visible "Ctrl K" button in the topbar). Lists all nav
  pages from the same `nav.tsx` source (filtered by label/href),
  plus live entities from the **existing** `GET /admin/search`
  (debounced 250 ms, queries ≥ 2 chars): users → `/users/[id]`,
  organizations → `/orgs/[id]`, orders → the Search page for that
  query (orders have no admin detail page — the same destination
  the topbar form uses), and a "সব ফলাফল দেখুন" entry. ↑/↓ cycle,
  Enter opens, ESC closes, hover syncs selection. Recent searches
  (max 5) persist in `localStorage["admin_recent_searches"]` and
  are offered as chips on an empty query.
- **Attention Bell** — total of the *available* counts with a red
  bubble; dropdown lists each available count > 0 with a link to
  its queue page (Payouts / Tickets / Health / Alerts / Billing).
  If **all** counts were genuinely returned and sum to 0, the
  dropdown says "কোনো করণীয় নেই — সব queue খালি।" If the fetch
  failed or no fields are present, **the bell renders nothing** —
  absence of data is never dressed up as "all clear"
  (architecture §4).
- **Shared counts loader** (`useNavCounts`) — one fetch per page
  load shared by sidebar badges and the bell; failure leaves the
  value null (unknown), never a retried-into-existence 0.
- **Breadcrumb** — `Organizations › <name>` on the org detail page
  and `Users › <name>` on the user detail page, using the name the
  page already loads, falling back to a truncated id
  (`xxxxxxxx…`) when the name is empty — never a fabricated name.
  The loading state renders no breadcrumb (data not yet loaded).

---

## Gates — real output

| Gate | Result |
|---|---|
| New API spec (`adx3-nav-counts.spec.ts`) | **7/7 tests pass** — definitions per field, alerts ≡ board, genuine zeros returned as 0, per-field omission on failure, failedJobs all-or-nothing |
| All admin API specs (`npx jest src/admin --runInBand`) | **18 suites, 210 tests — all pass** (17 pre-existing suites + the new one) |
| Admin `tsc --noEmit` | **0 errors** (checked after ADX2 and again after ADX3) |
| API `tsc --noEmit` | **0 errors** |
| Admin `next build` | **Green** — all 22 routes listed in the build output (20 static + `/orgs/[id]`, `/users/[id]` dynamic), no route missing |
| Zero-loss set-diff (below) | **Pass** — additions only, exactly the declared ones |

### Zero-loss evidence

Baseline at `9322ddb` vs final DB1 tree, enumerated mechanically:

- **Nav hrefs:** before 17 (`/`, `/admins`, `/alerts`, `/analytics`,
  `/audit`, `/billing`, `/growth`, `/health`, `/orgs`, `/payouts`,
  `/security`, `/settings`, `/social-ops`, `/system`, `/tickets`,
  `/usage`, `/users`) → after **18**; the diff is a single added
  line: `href: "/search"` (a route that already existed). Nothing
  removed or re-targeted.
- **App routes:** `find apps/admin/src/app -name page.tsx` before
  and after — **identical sets, 22 routes**.
- **API routes:** `@Get/@Post/@Patch/@Delete` decorators in
  `admin.controller.ts`: before **148** → after **149**; the diff
  is a single added line: `@Get("nav-counts")` — the package's one
  declared API addition. Nothing removed.

---

## Honest limits

- **No browser screenshot QA** — none was performed for DB1. That
  is ADX13, deploy-gated, exactly as the plan states. The new shell
  is proven by typecheck + production build + unit specs, not by
  looking at it in a browser.
- **No live-API proof** — `nav-counts` is proven against a mocked
  Prisma in the established admin-spec pattern; it has not run
  against the production database or a running API.
- **Journey targets are package targets** — DB1 delivers the shell
  gains (J1 in full; the discovery/entry half of J2/J3/J5; the
  palette entry of J4). The page-interior halves land in ADX7
  (payouts queue), ADX8 (health summary), ADX9 (settings hub),
  ADX10 (tickets inbox) and are not claimed here.
- **Found, not fixed:** overview()'s failed-sync count references
  the nonexistent `SyncJob.updatedAt` and silently degrades to 0
  against real Prisma (see ADX3 deviation above). Fixing overview
  is a one-line change but outside DB1's scope; it is recorded
  here for the owner.
- **Role-aware nav styling remains unbuilt** (see the ADX2 verdict)
  until `adminTier` is exposed to the admin client by the auth API.
- Push and deploy remain owner-gated; DB1 is local commits only.
