# SD Batch 3 Acceptance — SD7 Settings/Accounts v2 + SD8 Hardening (CLOSING batch)

**Package:** Social Posts Design Update (SD1–SD8), Batch 3 of 3 — plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Social-Posts-Design-Plan-2026-10-14.md`
(Batch 3: SD7 + SD8; this batch also closes the package — the
package summary is `docs/social-posts-design-v2-summary.md`).
**Branch/worktree:** `su-package` in `~/workspace/ai-marketing-saas-su`
(base `f9fb401`, the SD Batch 2 HEAD). **LOCAL COMMITS ONLY — nothing pushed.**

**WEB-ONLY batch** (plan §২): no API, schema, migration, lib,
endpoint, handler or state-logic change. Changes are JSX
structure/className plus two additive `.soc-*` classes in
`globals.css` and one optional presentation prop on the SD1
`AccountAvatar`.

## Commits

| Commit | Contents |
|---|---|
| `92af0d8` | SD7: Settings & Accounts v2 — account card v2 (large `AccountAvatar` + platform chip with dot, `AccountStatusPill` + `HealthPill` and last health-checked time read from the **same** `accountHealth` rows the health section renders, verbatim account error in an `.alert-red` block, disconnect moved into a separated red danger zone), accounts on a responsive grid (the flex `min-w-[240px]`/`max-w-sm` cards dropped), YouTube picker channels gain the avatar identity with an initials fallback, every settings group (accounts / approval + two-step / Commerce Auto-Draft / Health & Failures) becomes a `.soc-section-card` with one toggle shape (brand-accent checkboxes), health rows gain `AccountAvatar` + platform chip + ring, failure groups become ring cards with a clear Retry button, designed empty states for accounts / discovered pages / health / failures; additive globals `.soc-avatar-lg` + `.soc-empty-sm`; `AccountAvatar` gains an optional `size` prop; skeleton rows on the YouTube picker's existing loading display |
| `6b9ffb3` | SD8: states / responsive / a11y hardening — remaining plain-text empty states take designed surfaces with the same texts (details under SD8 below), typography floor completed, `MediaThumb` loading placeholder takes the `.soc-skeleton` shimmer, focus-visible verified against the global rule |
| _(this docs commit)_ | This acceptance record + `docs/social-posts-design-v2-summary.md` + `docs/social-design-screenshot-qa-checklist.md` |

## SD7 — what landed, point by point

- **Account card v2:** `AccountAvatar size="lg"` (picture or brand
  initials, platform dot pinned) + a `PlatformChip` (dot + the same
  `PLATFORM_LABELS` text) + `AccountStatusPill` + `HealthPill`.
  The health pill and the "শেষ যাচাই:" time on the card are looked
  up from the **existing** `accountHealth` array by account id —
  the same rows, the same `healthCheckedAt` values the Health
  section below renders; nothing new is fetched or computed.
- **Verbatim error:** `a.lastError` now renders inside an
  `.alert .alert-red` block — the string itself is untouched.
- **Danger zone:** the disconnect button keeps its handler, busy
  label and `status === "connected"` condition, and moves into a
  separated red-tinted zone at the card's foot.
- **Reconnect:** there is **no** per-account reconnect handler in
  this page and none was invented — reconnecting runs through the
  connect buttons in the accounts header, exactly as before. The
  Check Health action stays in the health rows (which gain the
  avatar/chip identity and a ring).
- **Settings groups:** accounts / approval (SP7 + SU9 two-step) /
  Commerce Auto-Draft (SU5) / Health & Failures (SU10) each sit on
  a `.soc-section-card` with their existing headers and
  descriptions; every toggle in the panel takes one shape —
  `h-4 w-4 shrink-0 accent-[var(--brand-from)]`.
- **Failure center:** each group is a ring card — error signature
  header, affected-post count chip, latest time (all unchanged) —
  and each post's Retry becomes a clear ring button on the same
  `retryFailedPost` handler.
- **Accounts layout:** the flex-wrap strip of `min-w-[240px]` cards
  becomes `grid gap-3 sm:grid-cols-2 xl:grid-cols-3` — no fixed
  minimum width left in the strip.

## SD8 — skeleton audit (existing conditions only)

| Surface | Existing loading condition | Skeleton? |
|---|---|---|
| Posts list "আরও দেখুন" | `busy === "posts-more"` | ✅ landed in SD4 (`.soc-skeleton` blocks) |
| YouTube channel picker | empty channel list renders the "Channel তালিকা লোড হচ্ছে…" text (the picker's existing loading display) | ✅ **this batch** — 2 `.soc-skeleton` rows under the same text |
| Media thumbnails | `MediaThumb`'s per-asset fetch (url not yet loaded) | ✅ **this batch** — the existing "লোড হচ্ছে…" placeholder span takes the shimmer class; text kept |
| Library grid | `loadAssets` sets **no** busy/loading flag (checked in page.tsx, already recorded in Batch 2) | ❌ none — no condition exists; inventing one would be a state change |
| Posts / accounts / analytics initial load | page state exposes **no** initial-loading flag at all (lists render their empty states until data arrives — pre-existing SU11 behaviour) | ❌ none — same reason |
| Composer / settings saves | per-button `busy` labels only | ❌ not list loading; button busy texts unchanged |

## SD8 — empty-state completion (same texts throughout)

Already designed before this batch: posts list (`@repo/ui`
EmptyState), Library assets (`.soc-empty`, SD5), all five Analytics
no-data branches (`.soc-empty`, SD6).

Converted in this batch — full `.soc-empty` (+icon): posting
slots, approval queue, filtered-posts, queue, mobile calendar
agenda. Compact `.soc-empty-sm` (new additive class, for
sub-sections/expanders): Settings accounts (full `.soc-empty`),
discovered pages, health list, failure center, Composer Step-3
no-accounts, Composer no-content-plan, Composer no-hashtag-set,
Posts detail-expander notes / versions / timeline, page.tsx
derive no-other-account, page.tsx insights no-data.

Left as plain guidance notes, deliberately (they are not list
empties): the hashtag-advice data note, the dropzone media hint,
the Analytics best-time "পর্যাপ্ত data নেই" note, the follower
snapshot-job note. Their texts are untouched either way.

## SD8 — typography floor, completed

Raised to 12px in this batch: Library tiles (asset name, bulk
label, folder select, aspect select, 3 overlay quick actions, 5
below-thumb action buttons), Analytics tile subtexts (×2), Posts
bulk-select label, Posts note-delete button. (SettingsPanel needed
no raises — all of its small text is badge/meta, below.)

**What remains at 10–11px — badge/meta only, the full list:**
platform chips/badges (PostsPanel `PlatformChip`, SettingsPanel
`PlatformChip` + discovered-page badges + "আগে থেকেই কানেক্টেড"
badges, Composer plan pillar/product/draft badges, page.tsx
derive-panel platform badge), note/version author-and-time meta,
calendar day chips + "+আরও nটি" meta, chart value label (11px) and
day-axis label (10px), Library kind badge + tag chips + folder and
usage meta lines, health "শেষ যাচাই" / failure "সর্বশেষ" meta and
the failure count badge, and two icon-only glyph buttons (Library
folder ✕ at 10px, Composer media-remove ✕ at 11px — both
aria-labelled). Plus one 9px badge (Library "যোগ হয়েছে").

Counts: `text-[10px]`/`text-[11px]` occurrences in the tree —
48 at the SU-final base `94aead6` → 42 at Batch-3 base `f9fb401` →
**26 at this batch's head** (10px: 6, 11px: 20), every one of them
in the badge/meta list above.

## SD8 — responsive + focus, final pass

- **Responsive:** the last fixed-width risk in scope — the
  Settings account strip's `min-w-[240px]` cards — is gone (grid
  now). Everything else audited: all remaining `min-w-[…]` are
  flex-1 form labels inside `flex-wrap` rows (they wrap, they do
  not overflow); the two `min-w-[480px]` Analytics tables sit
  inside `overflow-x-auto` wrappers; the failure-center caption
  chip truncates at `max-w-[220px]` inside a wrapping row; the
  Posts filter input (`w-56`) sits in a wrapping row. No fixed
  width can push past the viewport.
  Tree-wide responsive utilities: **2** (base `94aead6`) → 11
  (`f9fb401`) → **12** (final) — again, most breakpoint behaviour
  lives in the `.soc-*` CSS and structural switches, which this
  count does not capture (tab rail, composer grid, calendar
  grid/agenda switch, library grid, account grid).
- **Focus-visible:** verified, not rebuilt. `globals.css` already
  gives **every** interactive element a `:focus-visible` outline
  (line 46); the social tree contains **zero** `outline-none`
  overrides (grep-checked); `.input` controls carry their own
  brand focus ring and `.soc-tab-btn` its ring shadow. The new
  raw-styled buttons in this batch (danger-zone disconnect,
  failure Retry) suppress nothing, so they inherit the global
  ring. No gap remained to fill.

## Final gate (run on the final tree, HEAD `6b9ffb3`)

| Gate | Result |
|---|---|
| Web vitest FULL | **41 files, 315/315 tests PASS** (unchanged from the SU/SD gates — no test touched) |
| Web tsc (`tsc --noEmit`) | **0 errors** |
| Web next build | **Green** (exit 0, fresh `.next/BUILD_ID` emitted) |

The `apps/web/tsconfig.tsbuildinfo` churn from the gate runs (a
tsc incremental-cache artifact, not a source change) was restored
to the committed version; the final tree is clean.

## Zero-loss verification (base `f9fb401` vs HEAD `6b9ffb3`)

Method: per-file extraction diff for every file this batch touched
(the Batch 1/2 method — JSX Bengali text segments, Bengali quoted
strings, `social/…` endpoint segments, set-compared).

- **Files changed:** `SettingsPanel.tsx`, `PostsPanel.tsx`,
  `LibraryPanel.tsx`, `AnalyticsPanel.tsx`, `ComposerPanel.tsx`,
  `page.tsx`, `shared.tsx` and `apps/web/src/app/globals.css`
  (additive `.soc-avatar-lg` + `.soc-empty-sm` only). **No API,
  schema, lib or any other file changed.**
- **Per file, lost = 0 everywhere:** SettingsPanel labels 28→28,
  quotes 24→24 · PostsPanel 42→42 / 35→35 · LibraryPanel 11→11 /
  22→22 · AnalyticsPanel 21→21 / 9→9 · ComposerPanel 80→80 /
  44→44 · shared.tsx 2→2 / 15→15 · page.tsx 18→18 / 186→186,
  endpoints 43→43. **This batch adds ZERO new Bengali labels** —
  every text rendered is a pre-existing one.
- **Panels stay mounted:** page.tsx structure is untouched (its
  only changes are the two `.soc-empty-sm` swaps in the derive /
  insights renderers), so no panel state is lost on tab switch.

## Before / after counts (social-posts tree, same method both sides)

| Measure | Base `f9fb401` | Head `6b9ffb3` |
|---|---|---|
| Responsive utilities (`sm:`/`md:`/`lg:`/`xl:`) | 11 | 12 |
| `text-[10px]`/`text-[11px]` occurrences | 42 (10px: 11) | 26 (10px: 6) — all badge/meta, listed above |
| `.soc-*` usages in the tree | 44 | 79 |
| `.soc-empty` usages | 6 | 13 |
| `.soc-empty-sm` usages | 0 | 13 |
| `.soc-skeleton` usages | 2 | 5 |

## Honest limits

- **No screenshot QA** — there is no live app in the sandbox; the
  visual result is verified by code, build and counts only. The
  deploy-time checklist is written and **entirely unchecked**:
  `docs/social-design-screenshot-qa-checklist.md` (desktop 1440 /
  tablet 768 / mobile 390, every tab).
- **No new skeleton where no condition exists** — the Library
  grid and the initial page loads still show their previous
  states (empty-state text / nothing) while data loads, because
  the page exposes no loading flag for them and inventing one is
  a state change this package forbids. Recorded in the audit
  table above, not papered over.
- **Health on the account card is only as fresh as the health
  section's data** — the card reads the same `accountHealth`
  rows; an account never health-checked shows no pill on the
  card, exactly as it shows `never_checked` in the section.
- **Reconnect is not a per-account action** — see SD7 above; the
  header connect buttons remain the reconnect path.
- Push/integration remain owner-gated with the rest of the SU
  package (see the package summary's deploy note).
