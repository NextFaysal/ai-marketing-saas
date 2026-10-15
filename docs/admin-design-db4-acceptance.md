# Admin Design DB4 Acceptance — ADX12 + ADX13 + ADX14

> Package: Admin Dashboard UX Redesign (ADX1–ADX14), Batch DB4 — the
> final batch. Worktree: `~/workspace/ai-marketing-saas-adx`, branch
> `admin-ux`, base DB3 HEAD `37f46f6`. Local commits only — **not
> pushed** (push stays owner-gated, as always). Date: 2026-10-15.
> Plan: `Admin-Dashboard-UX-Redesign-Master-Plan-2026-10-15.md`
> §২ (principles), §৫ Batch DB4, §৮ (gates); structure and honesty
> rules per `docs/admin-ux-architecture.md`. All work reuses the
> Design System v3 patterns (`apps/admin/src/components/ui.tsx` +
> globals v3 classes); **no API code was changed in this batch at
> all** (verified: `git diff 37f46f6 -- apps/api` = 0 lines), no new
> dependency, no new network call from any page or component.

## Commits

| Item | Commit | Summary |
|---|---|---|
| ADX12 | `71abbdc` | States & responsive completion — all 22 routes audited/fixed, collapsible FilterBar, Admins mobile card table |
| ADX13 | `5933a56` | `docs/admin-ux-screenshot-qa-checklist.md` — document only, 135 boxes, all unchecked |
| ADX14 | `f3a3153` | Density toggle, saved views (users/orgs/audit/tickets), favorites loop completion |
| (this doc + package summary) | — | acceptance + `docs/admin-ux-package-summary.md` commit |

---

## ADX12 — States & responsive completion

**Method.** Every route under `apps/admin/src/app` (22 `page.tsx`
files) was read and scored on the three v3 states before touching
anything. Two systematic defects accounted for almost every gap:

1. **Perpetual loading.** Many pages fetch with `.catch(() => null)`
   and render `লোড হচ্ছে…` while the value is null — so a *failed*
   load showed "loading" forever (health, system, social-ops,
   analytics series, billing summary, security, settings, both
   detail pages, growth's two null-gated boards).
2. **Swallowed load errors.** List pages fetched with
   `.catch(() => [])` and no error state, so a failed load was
   indistinguishable from an empty result (alerts even showed its
   🎉 "no alerts" card on an outage), and several pages flashed
   their empty state during the first load.

Fixes reuse each page's **existing** load function as the retry —
no endpoint added, no fetch target changed (gate below).

### Per-page audit table (route × state × before → after)

Legend: ✅ = was already compliant, verified in place · 🔧 = fixed
in this item · — = not applicable (form page, no list/data state).

| Route | Loading | Error (load failure) | Empty |
|---|---|---|---|
| `/` Command Center | ✅ skeleton cards | 🔧 plain `.aerror` text, no retry → `ErrorState` + retry via extracted `loadAll` | ✅ timeline empty text |
| `/analytics` | 🔧 KPI skeletons spun forever on series failure → bounded by `loadDone`; error block replaces them | 🔧 none → `ErrorState` + retry when series absent after load | ✅ per-section empty texts (sub-section fetches still swallow errors into those texts — pre-existing shape, noted not restructured) |
| `/users` | 🔧 none (empty state flashed) → `askel-table` skeleton on first load | 🔧 `.aerror` text, no retry → `ErrorState` + retry | ✅ `EmptyState`, now gated on `!loading` |
| `/users/[id]` | 🔧 "লোড হচ্ছে…" also on failure → failure renders `ErrorState` + retry | 🔧 none → added (`loadFailed` from the existing load) | — (detail page; notes/audit empties ✅ in place) |
| `/orgs` | 🔧 none (empty state flashed) → skeleton on first load | 🔧 swallowed → error state + retry | ✅ `EmptyState`, gated on `!loading && !error` |
| `/orgs/[id]` | 🔧 same defect as user detail → fixed the same way | 🔧 none → added | — (detail page; sub-sections ✅) |
| `/billing` | 🔧 "লোড হচ্ছে…" forever on summary failure → `ErrorState` + retry | 🔧 none → added (`loadFailed`) | ✅ per-card empties (overdue/payments/checkouts/dunning) |
| `/payouts` | 🔧 queue empty state flashed → skeleton on first load | 🔧 swallowed → `ErrorState` + retry | ✅ `EmptyState` + a next-action sub (other statuses) |
| `/usage` | 🔧 "কোনো Organization নেই" showed during load → skeleton | 🔧 swallowed → `ErrorState` + retry | 🔧 plain text → `EmptyState` with next-action text; AI-detail section ✅ (own loading flag + empty text) |
| `/tickets` | 🔧 empty card showed during load → skeleton cards | 🔧 list failure swallowed → `ErrorState` + retry in the list column | 🔧 plain card → `EmptyState` with filter guidance (existing 'সব' filter as the next action) |
| `/audit` | 🔧 none → skeleton on first load | 🔧 swallowed → `ErrorState` + retry | 🔧 plain text → `EmptyState` with filter-relaxing guidance |
| `/settings` | 🔧 main gate "লোড হচ্ছে…" forever on failure → `ErrorState` + retry; the whole Config Hub silently vanished on a platform-config failure (section returned `null`) → loading text / `ErrorState` + retry in the hub | 🔧 none → added at both gates | ✅ announcements/flags empties in place |
| `/health` | 🔧 per-card "লোড হচ্ছে…" forever on failure → shared `pending()` slot (loading text in flight, `ErrorState` + retry after a completed failed load) for Integrations / Jobs / Connections; the Scheduled Jobs card's empty text no longer claims "none" while loading or failed | 🔧 none → added per card | ✅ per-card empties (no failed sync, no connections, no scheduled jobs) |
| `/social-ops` | 🔧 same perpetual-loading pattern in every board card → shared `pending()` per board | 🔧 none → added per board | ✅ board empty texts/helpers in place |
| `/alerts` | 🔧 blank until `loaded` → skeleton while loading | 🔧 **load failure showed the 🎉 "no alerts" card** → `ErrorState` + retry; the empty card now renders only after a *successful* load | ✅ 🎉 empty (now honest) |
| `/system` | 🔧 per-card perpetual loading → shared `pending()` for the 7 null-gated cards (Env Check, Version, Queues, Inbox Health, DLQ, Errors, DB Growth) | 🔧 none → added per card | ✅ webhooks/logs empties; Backup "এখনো কোনো Integrity যাচাই হয়নি" is a data-true empty (manifest is null until an operator verifies), not a load mask |
| `/growth` | 🔧 Referrals/Feedback boards loaded forever on failure → `loadDone`-gated `ErrorState` + retry | 🔧 none → added for the two null-gated boards | ✅ list empty texts (array boards — campaigns/changelog/referral campaigns — keep their pre-existing shape: a failed fetch reads as empty there, noted, not restructured) |
| `/security` | 🔧 page gate "লোড হচ্ছে…" forever on failure → `ErrorState` + retry | 🔧 none → added (`loadFailed`) | ✅ sessions/keys/anomalies empties in place |
| `/admins` | 🔧 none → skeleton while loading | ✅ `ErrorState` existed (DB3) → 🔧 retry added | ✅ `EmptyState`, now gated on `!loading`; **+ mobile card form (below)** |
| `/search` | 🔧 "খোঁজা হচ্ছে…" forever on failure *and* on a <2-char query → failure gets `ErrorState` + retry; short query gets an instruction `EmptyState` | 🔧 none → added | 🔧 none → zero-result `EmptyState` + per-column "মেলেনি" lines |
| `/login` | ✅ form busy state ("যাচাই হচ্ছে…", button disabled) | ✅ inline form error | — form page |
| `/login/totp` | ✅ form busy state | ✅ inline form error | — form page |

### Responsive completion

- **Collapsible FilterBar (shared pattern).** `FilterBar` in
  `ui.tsx` gained an opt-in `collapsible` prop: on narrow screens a
  "🔎 ফিল্টার" toggle shows/hides the controls (they otherwise stack
  into a tall block above the table); on `sm:` and up the children
  lay out exactly as before (`sm:contents`). Adopted on the three
  pages whose bars are tall — `/users`, `/orgs`, `/audit`. The
  default (no prop) renders the original bar, so every other usage
  is byte-identical in behaviour.
- **Tables.** The established horizontal-scroll behaviour
  (globals ≤920px rule) is **kept everywhere** — no page's data flow
  was restructured for a card form. One opt-in exception, as the
  brief allowed: the **Admins roster** is plain text/badges, so it
  adopts the new `.atable-cards` form (globals.css, ADX12 section):
  at ≤640px the header hides and each cell renders as a labelled
  row via its `data-label`. Per page: card form **done** — admins;
  **not done, by design** — all other tables (action-heavy tables
  like payouts/billing would need per-cell restructuring for no
  readability gain over scroll; the audit table above is per-state,
  and this sentence is the per-page record for the card question).

## ADX13 — Screenshot & usability QA checklist (document only)

`docs/admin-ux-screenshot-qa-checklist.md` (257 lines, **135 boxes,
0 checked** — verified mechanically). Contents: a header stating
plainly that it runs **only after deploy**; the relationship to the
AN10 checklist (`docs/admin-screenshot-qa-checklist.md`, 49 boxes —
**left untouched**; it still covers the old surfaces it was written
for, ADX13 covers the new shell, both run post-deploy); general
checks; shell checks (7 groups, group persistence, badges ≡ page
counts, palette keyboard flow, bell honesty, favorites/recents,
collapsed mode, drawer, density); **22 routes × (desktop 1440 /
mobile 390) × (empty / populated) = 88 screenshot boxes** plus
ADX12-specific mobile checks (admins card form, collapsible
FilterBars, tickets master-detail); Settings hub section + hash
checks (all 7 section hashes, `#payment-bkash` and alias hashes,
unsaved-input survival, source badges); the **5 ADX1 journeys as
measurable boxes** with their target step counts and a blank
"মাপা ধাপ" field; ADX14 saved-view checks; and a sign-off block.
**No box was executed or ticked in this batch** — execution is
deploy-gated, exactly as the plan states.

## ADX14 — Light personalization (client-side only)

- **Density toggle.** `DensityToggle` in the shell — two chips
  (স্বাভাবিক / Compact) in the desktop sidebar footer and the
  mobile drawer footer, an icon button in collapsed mode. Persisted
  in `localStorage["admin_density"]` (new `LS_KEYS.density`),
  mirrored onto `<html data-admin-density="compact">` by a shell
  effect; the compact rules are **appended** to globals.css (ADX14
  section) and reuse the `atable-compact` metrics (table cell
  padding/font) plus denser nav rows. Comfortable is the default
  and needs no CSS — it is exactly the v2/v3 look. Degradation:
  unreadable/blocked storage leaves the default; nothing else
  reads the value.
- **Favorites — verdict: DB1's implementation was already
  complete; two loop pieces were missing and are now added.**
  DB1 shipped pin/unpin on every nav row, the প্রিয় section, and
  `localStorage` persistence (verified by re-reading
  `AdminShell.tsx`/`nav.tsx` at DB4 start). Missing: (1)
  **discoverability of the empty state** — the section simply did
  not exist until the first pin, so an operator could never learn
  the feature exists → an empty-favorites hint line now renders in
  expanded nav ("⭐ কোনো প্রিয় পেজ নেই — যেকোনো মেনু আইটেমের
  পাশের ☆ চেপে এখানে রাখুন।") and disappears after the first pin;
  (2) **keyboard focus** — the unpinned star was hover-only
  (`opacity-0` + `group-hover`) → it now also reveals on `:focus`.
  Everything else is verification-only, as the brief allowed.
- **Saved views.** New `SavedViewsBar` in `ui.tsx`
  (load/store helpers beside it): name → save the page's current
  filter state → chip click re-applies → ✕ deletes; same-name save
  overwrites. Storage: `localStorage["admin_saved_views_<page>"]`,
  values validated on load (non-string fields dropped, corrupt
  JSON → no views). Adopted on the four brief-named pages, over
  each page's **existing** filter state only:
  `/users` (q, statusFilter, adminFilter), `/orgs` (q,
  statusFilter, planFilter), `/audit` (prefix, organizationId,
  userId, entityType, dateFrom, dateTo, take), `/tickets` (the
  status filter — the page's only filter state, so a view is
  honestly a named status preset). No filter semantics were added
  anywhere; applying a view only calls the page's existing state
  setters, so all downstream behaviour (server `q`, client
  filters, audit's `buildQuery`) is the page's own.

---

## Gates — real output

| Gate | Result |
|---|---|
| Admin API Jest specs (`npx jest src/admin --runInBand`) | **19 suites, 212 tests — all pass** (identical to DB3; this batch changed no API code — `git diff 37f46f6 -- apps/api` = **0 lines**) |
| Admin `tsc --noEmit` | **0 errors** (run after ADX12 and again after ADX14) |
| Admin `next build` | **Green — all 22 routes** (20 static + `/orgs/[id]`, `/users/[id]` dynamic; route list diffed against DB3's build output: identical set) |
| apiFetch set-diff vs `37f46f6` | **Identical** — mechanical per-page extraction of every `apiFetch(...)`/`fetch(...)` target in all 22 `page.tsx` files, before vs after DB4: zero added, zero removed. Components: `ui.tsx` performs no fetch at all; `AdminShell.tsx`'s only call remains the pre-existing `/admin/health` auth check. **This batch added no network calls.** |
| globals backward compatibility | Class selectors at `37f46f6` vs final DB4 tree (mechanical `comm` diff): **zero removed**. DB4's globals changes are append-only sections (ADX12 card form, ADX14 density) plus nothing else. |
| ADX13 box count | **135 boxes, 0 checked** (`grep -c "- [ ]"` / `"- [x]"`) |

## Honest limits

- **No browser screenshot QA** — none performed for DB4; ADX13 is
  a checklist, and its execution remains deploy-gated (owner push
  + Dokploy Redeploy, then live `admin.qosprey.com` in a real
  browser). States, density, saved views and the card form are
  proven by typecheck, production build and code-level diffs —
  not by looking at the pages.
- **No live-API proof** — no page in this batch ran against the
  production API or database. The new error states in particular
  are wired to the pages' real load functions, but their rendering
  on a genuine outage is part of what ADX13's offline check will
  confirm after deploy.
- **Two pre-existing shapes were documented, not restructured:**
  sub-section fetches on `/analytics` and the array boards on
  `/growth` still fold a failed fetch into their empty text (see
  the audit table). Distinguishing those would mean changing each
  section's data contract, which is beyond a states-polish item.
- **Density and saved views are per-browser** (localStorage) —
  they do not follow the operator across devices, by design for a
  light-personalization item; nothing is stored server-side.
- Push and deploy remain owner-gated; DB4 is local commits only.
  The package closes with `docs/admin-ux-package-summary.md`.
