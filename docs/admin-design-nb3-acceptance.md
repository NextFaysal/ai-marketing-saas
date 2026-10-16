# Admin Design Next — NB3 Acceptance (ADNX5, ADNX10, ADNX11, ADNX12)

- **Batch:** NB3 (পরিচালনা) of the ADNX package — plan
  `~/workspace/goals/ai-marketing-saas-platform-build/files/Admin-Dashboard-Design-Next-Plan-2026-10-16.md`
  §২ (principles), §৩ (responsive rules), §৫ ADNX5, §৭ ADNX10/ADNX11/ADNX12, §৯ NB3 row + gates
- **Worktree / branch:** `~/workspace/ai-marketing-saas-adnx`, `admin-design-next`
- **Base:** `cb14728` (NB2 complete) · **Local commits only — NO push**
- **Scope:** `apps/admin` + this doc. No new API endpoint, no backend
  change, no migration, no behaviour/payload/label/config-key change —
  presentation and feedback only.
- **NO screenshot / browser QA is claimed anywhere in this doc**
  (that is NB5 / ADNX16). Verification here is code-level: gates +
  set-diffs below.

## Commits (one per item, in the mandated order)

| Item | Commit | Subject |
|---|---|---|
| ADNX5 | `6bebd55` | Chart component (bar+line SVG, exact-value readout, data-table fallback) |
| ADNX10 | `21578b3` | Support & Trust — Tickets, Audit, Admins |
| ADNX11 | `1168f26` | Operations — Health, Alerts, System, Social-Ops |
| ADNX12 | `f9ea7b6` | Analytics, Usage, Growth |

## ADNX5 — Chart component (`6bebd55`)

Built in `apps/admin/src/components/ui.tsx` (ONE component, no new
dependency — owner decision §১১/৪):

- `Chart({ variant: "bar" | "line", points, formatValue, seriesLabel })`
  — hand-rolled SVG (viewBox 640×240), values only from data the
  caller already loaded; the component never fetches.
- **Exact values:** hovering, tapping or keyboard-focusing a bar /
  point selects it; the readout line under the chart shows
  `label: exact formatted value` (`aria-live="polite"`), and every
  mark also carries a native `<title>` tooltip. Default selection
  is the last point, so a correct value is visible without any
  interaction.
- **Colours from the v4 tokens:** series = `var(--a-status-info)`,
  selected mark = `var(--a-status-warning)` — no hard-coded palette.
- **Accessible fallback:** the SVG is `role="img"` with a summary
  label, and the "ডেটা টেবিল দেখুন" toggle renders the SAME numbers
  as a real DataTable (card pattern, `data-label` per cell) — for
  screen readers and small screens alike.

**Migration record:**
- Analytics' hand-rolled collected-payment bars → migrated to
  `Chart` variant `"bar"` in ADNX12 (same loaded series, same
  `formatMinorStr` formatting).
- **Overview — audited, nothing to migrate:** the Overview page
  renders no graphical chart; its series use is only the NB2
  previous-month reference line under the orders KPI. There is no
  hand-rolled chart to convert, so Overview was NOT touched in
  this batch (the task's NB4-candidate note is hereby closed as
  "no candidate exists"; if NB4 ever adds a chart there, this
  component is the one to use).
- The `"line"` variant is built and type-checked but has **no
  consumer yet** — no current page's data called for it. Recorded
  here so it is a known built-but-unused variant, not a surprise.

## ADNX10 — Support & Trust (`21578b3`)

**All three pages adopted PageHead** (sub-line only; the shell
keeps the h1, as in NB2).

**Tickets:**
- Mobile is now a true two-step flow: step 1 = the list alone
  (unchanged behaviour), step 2 = the conversation as a
  **full-screen sheet** (`max-lg:fixed inset-0 z-[45]`, own scroll,
  no rounding) with the existing "← তালিকায় ফিরুন" back action
  sticky at the top. Desktop (`lg`) keeps list + detail side by
  side, unchanged.
- Status filter chips are a **horizontal rail on mobile**
  (`flex-nowrap overflow-x-auto`, chips `shrink-0`), wrapping
  again from `sm` up. Same filters, same labels.
- States audit: skeleton / empty / list error+retry were all
  already present (ADX12) — **verified, unchanged**. What was
  missing was feedback consistency: the detail-open, reply and
  status-update results rode two inline banners (`error`/`note`)
  — all moved to toast (see toast record).
- The ADX10 inbox ordering, SavedViewsBar and the reply flow are
  untouched.

**Audit:**
- PageHead adopted. **FilterBar pattern completed:** the bar
  already carried actor (User ID) / action prefix / entity type /
  date range (ADX10); it now also passes `activeCount` (count of
  filters differing from the page defaults — prefix `admin.`,
  take `100`) so the collapsed mobile bar shows its active-filter
  badge, like the NB2 list pages.
- **Action colour mapping on the one v4 status scale:**
  `auth.*` → `astatus-warning`, `admin.*` → `astatus-info`,
  everything else → `astatus-neutral` (the action text itself is
  unchanged, now badge-rendered).
- **Detail drawer full-screen on mobile:** the shared
  `.adrawer-detail` is now `w-full` below `sm` and the 420px panel
  from `sm` up (`globals.css`, one rule). This applies to every
  DetailDrawer (audit detail + orgs/users quick-view) — plan §৩'s
  "drawer পূর্ণ পর্দা" rule, one shared pattern.
- Contrast sweep: page-level `text-slate-500` 6 → **0**.
- CSV export is unchanged (including its silent non-OK path, as
  at base — it never had a banner to convert).

**Admins:**
- **Migrated to the DataTable v3 component** — the one-off
  `atable atable-cards atable-v3` marker NB1 explicitly deferred
  to here is gone; the roster now renders through the same
  component as every other list page. The skeleton and empty
  state moved into DataTable's `empty` slot, rendering exactly
  as before.
- The Tier badge and **সর্বশেষ Login** cell both carry
  `data-label`, so both stay visible on the mobile card (they
  already did; verified against the card pattern, unchanged).
- States were already complete (skeleton/empty/error+retry) —
  verified, unchanged. `text-slate-500` was already 0.

## ADNX11 — Operations (`1168f26`)

**All four pages adopted PageHead.**

**Health:**
- The **traffic-light card remains the first content block**
  (immediately after PageHead), i.e. inside the first mobile
  viewport; its data sources and wording are unchanged.
- Retry and Nudge feedback → **toast** (the indigo `msg` banner is
  removed). A not-retried result rides an `info` toast; failures
  ride `error`.
- Per-card pending slot: the "লোড হচ্ছে…" text is now a real
  **skeleton**; the ADX12 error+retry half is unchanged.
- Both tables now render through **DataTable** (they already
  carried the card classes + `data-label`s from NB1): Connections
  (its old `overflow-x-auto` wrapper is gone) and Scheduled Jobs,
  whose empty slot is now component states — skeleton in flight,
  **ErrorState with a working retry** after a failed load (before:
  a plain guidance sentence pointing at another card), and
  EmptyState when there are genuinely no jobs.
- Contrast sweep: `text-slate-500` 5 → **0**.

**Alerts:**
- **ADX12 false-empty protection VERIFIED, not regressed:** a
  failed load still renders `ErrorState` + retry, and the 🎉
  empty card still renders only after a successful empty load.
  The empty card now uses `EmptyState` with the identical text.
- Severity groups are **collapsible on mobile**: the group header
  gains a `sm:hidden` toggle (দেখুন ▼ / লুকান ▲); on `sm+` the
  group always shows, as before. Default = expanded.
- Severity badges moved from one-off inline light colours to the
  **v4 status mapping** (`astatus-danger` / `astatus-warning`) —
  same HIGH/MEDIUM labels.
- Nudge + Onboarding Nudge feedback → **toast** (both banners
  removed). Skeleton was already present — verified, unchanged.

**System:**
- PageHead adopted. Tabs kept (6, unchanged).
- **Every tab now carries its own states:** the shared per-card
  pending slot renders a skeleton in flight and ErrorState+retry
  after failure (deploy, queues, errors, backup cards all consume
  it). Added where genuinely missing:
  - **Webhooks tab:** skeleton in flight; a failed fetch now shows
    ErrorState+retry instead of the false "কোনো Webhook Event
    নেই।" (a false empty of exactly the ADX12 Alerts class);
    EmptyState only after a successful empty load.
  - **Activity Log tab:** same treatment (skeleton / ErrorState+
    retry / EmptyState) — it had the same silent-failure shape.
  - **Errors tab:** EmptyState when the loaded summary has zero
    sources (per-source "কোনো Error নেই।" lines unchanged).
  - **Backup tab:** EmptyState when the growth payload has zero
    tables (manifest/back-up record texts unchanged).
- **Long error lines are collapsible on mobile:** a page-local
  `ErrText` clamps to 2 lines below `sm` with a বিস্তারিত/লুকান
  toggle (full text always on `sm+`). Applied to queue failures
  (scheduled + sync), inbox send failures, and DLQ entries (the
  DLQ line's old `truncate`+title is replaced by it).
- **Toast adoption:** queue Pause/Resume/Retry-Failed results,
  backup-verify and backup-record-save results → toast (✅/❌/⚠
  prefixes dropped; the toast kind carries the outcome).
  **Kept as a banner, deliberately:** the deploy-readiness env
  banner (required-missing / all-present) — it is persistent
  platform status visible on every tab, not action feedback.
- Contrast sweep: `text-slate-500` 21 → **0**.

**Social-Ops:**
- PageHead adopted. **Mobile tab switch:** below `lg`, a sticky
  Tabs bar switches between the Social and Ads sections (the
  hidden one is `hidden lg:block`); on `lg` both sections render
  stacked exactly as before (the plan's "mobile tab switch"
  option). Section headings, order and the failed-first ordering
  inside each board are unchanged.
- Ops-action (recheck / retry-publish / recover-stuck /
  retry-sync) feedback → **toast** (banner removed, ✅/❌ prefixes
  dropped).
- Per-board pending slot: text → **skeleton**; error+retry half
  unchanged. The boards' positive empty renderings (emerald
  "কোনো … নেই" texts) were already honest post-load states —
  kept as designed (see deferred list).
- Both board tables (Social error accounts, Ads broken) migrated
  to **DataTable** with `data-label` on every cell — before, they
  were bare `.atable` with no card form at all.
- Contrast sweep: `text-slate-500` 13 → **0**.

## ADNX12 — Analytics, Usage, Growth (`f9ea7b6`)

**All three pages adopted PageHead.**

**Analytics:**
- Hand-rolled monthly bars → **ADNX5 `Chart` (bar)** — see the
  migration record above. The explanatory paragraph (বার =
  সংগৃহীত পেমেন্ট…, no day-level buckets) is kept verbatim.
- **Time-range selector is sticky:** the শেষ ৩/৬/১২ মাস buttons
  moved from inside the chart card into a sticky bar
  (`top-0 z-20`, slate-950/90 blur — the same pattern as the
  System/Growth tab bars) directly above the chart card. Same
  buttons, same labels, same window behaviour.
- **Per-table conversion record (the page's four tables):**

  | # | Table | Choice | Why |
  |---|---|---|---|
  | 1 | Monthly series (মাস/সংগ্রহ/নতুন Org/…) | **DataTable card mode** + `data-label` on all 7 columns | Plain numeric cells — card-safe |
  | 2 | Top Tenant | **DataTable card mode** + `data-label` on all 6 columns | Plain cells + one plan badge — card-safe |
  | 3 | AI Cost | **DataTable card mode** + `data-label` on all 6 columns | Plain numeric cells — card-safe |
  | 4 | Onboarding Funnel | **Kept its own `overflow-x-auto` container** (table-level scroll, never page-level) | The ধাপসমূহ cell is a 7-chip cluster and অগ্রগতি a progress bar — stacking those into card rows would bury the funnel's at-a-glance shape; §৩ permits a genuinely wide table to scroll inside its own container |

- States: KPI skeleton + series ErrorState were already present
  (verified). Tenant/Health empties and the AI-cost empty are now
  `EmptyState`. **Onboarding board:** loading text → skeleton,
  and its failed load (previously indistinguishable from "no
  organizations") → ErrorState+retry; EmptyState after a
  successful empty load.
- Rate-save feedback → **toast** (`msg` banner removed); the rate
  inputs, payload and busy flag are unchanged.
- Contrast sweep: `text-slate-500` 13 → **0**.

**Usage:**
- PageHead adopted. Rank-table sort, card classes and
  `data-label`s (NB1) verified and unchanged.
- **Cost-rate help text next to the figures:** the footnote under
  the ranking now states the whole rule in one place — money is
  computed only on Analytics' AI Cost board and only from the
  operator's own set rate (৳ / 1M tokens); with no rate set, no
  money figure appears there either. **No new calculation** — the
  payload carries no cost field (ADX11 verdict, unchanged).
- **AI-by-Feature section states completed:** skeleton in flight,
  a failed `ai-detail` load now shows ErrorState+retry instead of
  the false "no records" text, and the genuine empty uses
  EmptyState with the identical wording.
- Contrast sweep: `text-slate-500` 5 → **0**.

**Growth:**
- PageHead adopted. Tabs kept (Campaigns/Referrals/Changelog/
  Feedback — ADX11's honest tab set; no Announcements tab was
  invented, announcements live in Settings).
- **Forms on the NB2 form pattern** — visible label + field-level
  error (persistent until fixed) + busy state on the submit:
  - *Tenant Email Campaign:* Subject/বার্তা gained labels; the
    silent `return` on empty fields is now a field error under
    each field ("Subject লিখুন।" / "বার্তা লিখুন।"); submit shows
    the console's busy label ("হচ্ছে…") and is disabled while
    sending. The askConfirm step, payload and audience select are
    unchanged.
  - *Referral Campaigns:* all six inputs gained labels (same
    words as their placeholders, which are kept); কোড/লেবেল get
    field errors; busy on create.
  - *Referral Program config:* save gained a busy state (labels,
    fields and PATCH payload unchanged).
  - *Changelog:* Version/শিরোনাম/বার্তা gained labels; শিরোনাম/
    বার্তা get field errors; busy on publish.
- **Toast adoption:** campaign-send result, referral-campaign
  create, referral-config save and changelog-publish → toast
  (the page-level `msg` banner is removed).
- **States completed:** Referrals/Feedback board loading text →
  skeleton (their ErrorState+retry halves were already present);
  Campaigns and Changelog lists gained skeleton + EmptyState;
  and a failed campaigns/changelog/ref-campaigns fetch now sets a
  page-level **list error** (ErrorState + retry above the tabs)
  instead of silently reading as empty lists.
- Contrast sweep: `text-slate-500` 12 → **0**.

## Per-page state table — the 10 NB3 pages

(skeleton / empty / error-with-working-retry; "present" = verified
at base `cb14728`, not assumed)

| Page | Skeleton before → after | Empty before → after | Error + retry before → after |
|---|---|---|---|
| Tickets | Present → unchanged | Present → unchanged | Present → unchanged (detail/reply/update errors: banners → toast) |
| Audit | Present → unchanged | Present → unchanged | Present → unchanged |
| Admins | Present → unchanged (moved into DataTable `empty` slot) | Present → unchanged (same slot) | Present → unchanged |
| Health | Text "লোড হচ্ছে…" → **askel skeleton** per card + table | Connections/Scheduled plain text → **EmptyState** | Present per card → kept; Scheduled gains a real ErrorState in its empty slot |
| Alerts | Present → unchanged | 🎉 card → **EmptyState** (renders only after successful load — verified) | Present → **verified unchanged** (ADX12 honesty intact) |
| System | Per-card text → **skeleton**; Webhooks/Logs none → **skeleton** | Errors/Growth/Webhooks/Logs false-or-plain empties → **EmptyState** (only after successful load) | Per-card present → kept; Webhooks/Logs silent failure → **ErrorState + retry** |
| Social-Ops | Per-board text → **skeleton** | Present (positive board texts) → kept | Present → unchanged |
| Analytics | KPI present → unchanged; Onboarding text → **skeleton** | Tenants/Health/AI plain text → **EmptyState**; Onboarding → **EmptyState** | Series present → kept; Onboarding silent failure → **ErrorState + retry** |
| Usage | Main present → unchanged; AI section none → **skeleton** | Main present → unchanged; AI section plain text → **EmptyState** | Main present → kept; AI section silent failure → **ErrorState + retry** |
| Growth | Boards text → **skeleton**; Campaign/Changelog lists none → **skeleton** | Campaign/Changelog lists none → **EmptyState** | Boards present → kept; list fetches silent failure → **page-level ErrorState + retry** |

## Toast adoption record (NB3 pages)

| Page | Moved to toast | Kept as banner / inline — and why |
|---|---|---|
| Tickets | Ticket-open failure, reply result (success + email-failure wording intact), status-update failure — both old banners removed | — (no persistent banner existed) |
| Audit | (no banner existed) | Load ErrorState stays — persistent until retried, not feedback |
| Admins | (no banner existed) | Load ErrorState stays (same reasoning); the TOTP warning strip is persistent status, not feedback |
| Health | Retry result, Nudge result — `msg` banner removed | Traffic-light card is status, not feedback |
| Alerts | Nudge + Onboarding Nudge results — both banners removed | Load ErrorState stays (same reasoning) |
| System | Queue actions, backup-verify, backup-record save | **Deploy-readiness env banner stays:** persistent platform status shown on every tab, not action feedback. Per-card ErrorStates stay |
| Social-Ops | All ops-action results — `msg` banner removed | The operator-limits paragraph is persistent guidance, not feedback |
| Analytics | AI rate save result — `msg` banner removed | Series ErrorState stays (same reasoning) |
| Usage | (no banner existed) | Load ErrorStates stay (same reasoning) |
| Growth | Campaign send, referral-campaign create, referral-config save, changelog publish — `msg` banner removed | **Form field errors stay inline** with their forms (persistent until fixed — the NB2 form pattern). Changelog publish/unpublish toggle, changelog delete and referral-campaign activate toggle stay silent, exactly as at base (their reload is the feedback) |

## Contrast sweep (this batch's pages)

Page-level small `text-slate-500` (NB1-measured 4.24:1 on
slate-950 / 3.75:1 on slate-900 — below WCAG AA) → `text-slate-400`
(7.87:1 / 6.96:1): audit 6→0, health 5→0, system 21→0,
social-ops 13→0, analytics 13→0, usage 5→0, growth 12→0;
tickets, admins, alerts were already 0. **Final count in every
NB3 page file: 0.** (Alerts' severity badges separately moved
from inline light colours to the v4 `astatus-*` mapping.)

PageHead adoption after NB3: **17 of 22 pages** (NB2's 7 + this
batch's 10). The remaining 5 (security, settings, search, login,
TOTP) belong to NB4.

## Gates (run SERIALLY, one heavy gate at a time, recorded as they finished)

| Gate | Result |
|---|---|
| Admin `tsc --noEmit` | **0 errors** — interim runs after ADNX5, after ADNX10 and after ADNX11, plus a final batch-end run; all 0 |
| Admin `next build` | **Green** — compiled successfully, static generation 23/23; route table lists the same **22 routes** as base (21 static + `/orgs/[id]`, `/users/[id]` dynamic; `_not-found` excluded, as at base) |
| ADNX3 grep gate (`window.prompt/alert/confirm` + bare `prompt(`/`alert(`/`confirm(` in `apps/admin/src`) | **0 matches** (both patterns) |
| API path set-diff — ONE consistent scan, defined here: every `"/admin/…"` or `` `/admin/…` `` string literal in `apps/admin/src` (`*.tsx`/`*.ts`), unique-sorted | **Identical — 116 = 116**, zero added, zero removed (NB1 counted 116 with its scan, NB2 115 with its own; under this batch's single defined method the base and final sets are byte-identical) |
| Route set-diff (`page.tsx` files, base vs final) | **Identical — 22** |
| Nav href set-diff | **Identical** — `nav.tsx`, `AdminShell.tsx`, `CommandPalette.tsx`, `AttentionBell.tsx` and `apps/admin/src/lib/` are untouched by this batch (0-line diff) |
| Button-label scan | No visible button label removed. Additions/changes only: four Growth submit buttons gained the console's existing busy-state alternate ("হচ্ছে…" while busy, NB2 precedent); Alerts groups gained a mobile-only toggle (দেখুন ▼ / লুকান ▲); the Tickets back button is unchanged in text and gained `sticky` positioning on mobile; the Chart's ডেটা টেবিল দেখুন/লুকান toggle is new component UI. Key labels spot-verified present in the final tree (Campaign পাঠান/তৈরি, Sync আবার চেষ্টা, স্বাস্থ্য আবার যাচাই, তালিকায় ফিরুন, Rate সেভ করুন, প্রকাশ করুন, Nudge পাঠান, CSV Export, খুলুন, …) |
| Payload/behaviour scan | No `apiFetch` path, method or body changed in any hunk; conversions touch only feedback calls (`setMsg`/`setNote`/`setError` → `toast`), state rendering, layout classes, and the Audit FilterBar's `activeCount` (derived from the page's own existing filter state) |
| Working tree | Clean at batch end (build artifact `tsconfig.tsbuildinfo` restored, not committed) |

Files changed vs base: 12 (515 insertions, 271 deletions) —
`components/ui.tsx` (Chart), `globals.css` (drawer width), the 10
NB3 page files. No other file touched.

## NOT BUILT / DEFERRED (explicit)

1. **Screenshot / browser QA — NOT done** (NB5 / ADNX16). Nothing
   here claims visual QA. Specific things NB5 should check:
   the Tickets full-screen conversation sheet on a small phone
   (it overlays the shell topbar/quickbar by design, z-[45]);
   the Social-Ops mobile tab switch; the Chart at 360px (bars
   narrow when 12 months are shown); the Audit drawer now being
   full-width on mobile.
2. **Chart `"line"` variant — built, no consumer.** No NB3 page's
   existing data called for a line rendering; inventing one
   would have changed a page's presentation beyond its item.
3. **Overview chart — audited, none exists** (see ADNX5 record).
   The NB4-candidate question is closed: nothing to migrate.
4. **System's inner raw tables NOT converted to DataTable:**
   the BullMQ queue table (queues tab), the DB-growth table
   (backup tab) and the Activity Log table (logs tab) keep their
   bare `.atable` form. The ADNX11 item mandated per-tab states
   (done) — these three tables' conversion was not in the item,
   and the log/BullMQ tables carry action clusters per row.
   Candidate for a later polish pass if the owner wants it.
5. **Analytics Onboarding table kept container-scroll** — a
   recorded per-table choice (table 4 above), not an oversight.
6. **Usage's two tables kept their NB1 class-level adoption**
   (`atable-cards atable-v3` + `data-label`, verified) rather
   than being re-wrapped in the DataTable component. Only Admins
   was mandated for component migration in this batch; the
   rendered pattern is the same.
7. **Social-Ops positive empty texts kept** (emerald "কোনো …
   নেই" paragraphs) instead of being re-rendered as `EmptyState`
   components — they are the boards' designed post-load empty
   rendering from ADX11 and carry status meaning (all-clear),
   unlike a neutral empty.
8. **Tickets message-bubble inline colours untouched** — the
   conversation bubbles still use pre-existing inline light
   backgrounds (`#eef2ff` / `#f1f5f9`) from ADX10. Restyling them
   is a visual decision that belongs with NB5's screenshot pass,
   where they can actually be looked at; noted here so it is a
   recorded deferral, not a miss.
9. **Tickets status/assign/priority updates stay silent on
   success** (failures toast) — exactly as at base; the reloaded
   conversation is the feedback. Same recorded-decision class as
   NB2's org flags toggle.
10. **Shared-component `text-slate-500` in `ui.tsx` still not
    swept** (DetailDrawer sub-line, SavedViewsBar label,
    ConfirmModal "(ঐচ্ছিক)" marker) — the NB2-deferred cross-page
    pass remains open; those components render on NB4 pages too,
    so the sweep still belongs with a cross-page item, not NB3.
11. **Health Scheduled-Jobs failed-load wording changed** — the
    old plain sentence ("ওপরের Job কার্ডে আবার চেষ্টা করুন") is
    replaced by a real ErrorState with its own retry button in
    the table's empty slot. Recorded as a deliberate feedback
    improvement inside ADNX11's state completion, not a label
    loss: no button label, endpoint or payload changed.
