# Social Posts Design v2 — Package Summary (SD1–SD8)

**Package:** Social Posts Design Update — plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Social-Posts-Design-Plan-2026-10-14.md`
**Branch/worktree:** `su-package` in `~/workspace/ai-marketing-saas-su`,
built directly on the SU1–SU12 code-complete HEAD `94aead6`.
**Status: CODE-COMPLETE — LOCAL COMMITS ONLY, nothing pushed.**
Per-batch records: `docs/social-design-batch1-acceptance.md`,
`docs/social-design-batch2-acceptance.md`,
`docs/social-design-batch3-acceptance.md`.

## What the package was

The SU package (SU1–SU12) had finished Social Posts functionally,
but the page's presentation lagged the rest of the app: 2
responsive utilities in the whole tree, the app's Design v2 brand
tokens used once, no skeletons, 10–11px text in 48 places, a plain
header and a plain wrap tab bar. SD1–SD8 closed exactly that gap —
**WEB-ONLY**: no API, schema, migration, lib, endpoint, handler or
state-logic change anywhere in the package; every change is JSX
structure/className plus additive `.soc-*` primitives in
`globals.css`, all derived from `--brand-from/--brand-to` so tenant
white-label flows into this page.

## Batch / commit table

| Batch | Items | Commits |
|---|---|---|
| Batch 1 | SD1 foundation (`.soc-*` primitives, one pill shape, platform identity) · SD2 power header + sticky hash tab rail · SD3 Composer v2 (guided 4 steps, sticky preview rail, pre-flight checklist, dropzone + paste upload, mobile action bar with Save only) | `1696a08` · `39f5551` · `5fb7152` · docs `dcd0d79` |
| Batch 2 | SD4 Posts & Calendar v2 (post card v2, calendar + mobile agenda) · SD5 Library v2 (responsive grid, chip rail, hover overlay) · SD6 Analytics v2 (`.ctx-tile` row, brand chart, export card) | `b40c6ec` · `37d79f5` · `4a48358` · docs `f9fb401` |
| Batch 3 | SD7 Settings & Accounts v2 (account card v2, danger zone, section cards, failure center) · SD8 states/responsive/a11y hardening + closing | `92af0d8` · `6b9ffb3` · docs (this commit) |

## Zero-loss — the whole package, set-diffed (base `94aead6` → final)

Method: both trees extracted (`git archive` for the base, working
tree for the final); JSX Bengali text segments, Bengali quoted
strings and `social/…` endpoint segments extracted with the same
script on both sides and compared **as sets**, not just counts.

| Measure | Base `94aead6` | Final | Lost |
|---|---|---|---|
| Endpoint segments (set) | 43 | 43 — identical sets | **0** |
| Bengali UI labels (set) | 180 | 196 | **0** |
| Bengali quoted strings (set) | 320 | 324 | **0** |

The 16 added labels are all new SD presentation, each recorded in
its batch acceptance: 5 header stat chips, the 4 composer step
numbers, the pre-flight pass line, the mobile action bar's Save,
the calendar agenda's today badge + empty-month line, 2 analytics
tile labels, the library video kind badge. The 4 added quoted
strings are the analytics tile subtexts and renderer strings from
Batch 2. **No label, honesty note or endpoint was removed or
rewritten anywhere in the package.** All 5 panels stay mounted
(SU11 pattern untouched), so no panel state is lost on tab switch.

## Before / after — the full measures

| Measure (social-posts tree unless noted) | Base `94aead6` | Final |
|---|---|---|
| Responsive utilities (`sm:`/`md:`/`lg:`/`xl:`) | 2 | 12 (+ the `.soc-*` CSS behaviour the count cannot capture: sticky tab rail with scroll-snap, composer 2-column grid, calendar grid/agenda switch, library 2/3/4/5 grid, settings account grid) |
| `text-[10px]`/`text-[11px]` occurrences | 48 | 26 — every remaining one is badge/meta (full list in the Batch 3 acceptance) |
| `.soc-*` classes defined in globals.css | 0 | 25 (all brand-derived) |
| `.soc-*` usages in the tree | 0 | 79 |
| Designed empty states (`.soc-empty` + `.soc-empty-sm` usages) | 0 | 26 |
| Skeleton usages (`.soc-skeleton`) | 0 | 5 |
| `hover:` states | 11 | 18 |
| Brand-variable references in globals.css | 89 | 101 (the `.soc-*` section derives from them) |

## Final gate (final tree)

| Gate | Result |
|---|---|
| Web vitest FULL | **41 files, 315/315 tests PASS** (the same count as the SU final gate — no test was touched by any SD batch) |
| Web tsc (`tsc --noEmit`) | **0 errors** |
| Web next build | **Green** (exit 0, full route table, fresh `.next/BUILD_ID`) |

## What each SD delivered (one line each)

- **SD1** — `.soc-*` design foundation: one pill shape for post /
  approval / account / health statuses over the existing META
  records, `AccountAvatar`/`PlatformDot` platform identity,
  typography/touch/focus floors started.
- **SD2** — power header with live stat chips counted **only**
  from already-loaded page data (failed/health chips only when
  > 0), dismissible banners, sticky scroll-snap tab rail with
  brand-gradient active state and URL hash deep-links.
- **SD3** — Composer as a guided 4-step flow; SU1 preview in a
  sticky desktop rail (inline on mobile); pre-flight results as a
  checklist; real dropzone + paste upload through the **existing**
  `uploadMedia`; mobile sticky action bar carrying Save only
  (Schedule/Publish have no composer-level handler — not faked).
- **SD4** — post card v2 with identity/pills/prominent time and
  secondary actions in the expander; calendar v2 with brand today
  highlight and a mobile agenda from the same data; queue as a
  timeline; skeleton on the existing posts-more busy state.
- **SD5** — Library responsive grid (2/3/4/5), folder chip rail,
  video kind badge, hover/focus quick-action overlay carrying the
  same per-kind handlers (touch keeps the below controls).
- **SD6** — Analytics `.ctx-tile` summary row summed only from
  the panel's own loaded data ("—", never an invented number),
  brand-gradient chart, avatar identity rows, designed no-data
  states, monthly report as its own export card.
- **SD7** — Settings account card v2 (large avatar, status +
  health pills + last-checked from the same health rows, verbatim
  error alert block, disconnect in a danger zone), one toggle
  shape, section cards everywhere, failure center as ring cards
  with clear Retry buttons.
- **SD8** — skeleton/empty-state completion strictly on existing
  conditions, typography floor finished (badge/meta list
  documented), responsive final pass, focus-visible verified
  against the global rule, screenshot QA checklist written.

## Honest limits (unchanged by design, stated plainly)

- **No screenshot QA exists.** There is no live app in the
  sandbox; every visual claim above is verified by code, build
  and counts. The deploy-time checklist —
  `docs/social-design-screenshot-qa-checklist.md`, desktop 1440 /
  tablet 768 / mobile 390 × every tab — is **entirely unchecked**
  and remains a post-deploy step.
- **No skeleton where no loading condition exists** (Library
  grid, initial page loads) — inventing the state was out of
  bounds for a presentation-only package; recorded per-surface
  in the Batch 3 acceptance.
- **A few plan lines were honestly not buildable** and are
  recorded in their batch acceptances: the mobile action bar
  carries Save only (no composer-level Schedule/Publish handler);
  Library video cover-thumbnail priority (MediaAsset carries no
  cover reference); a Library upload dropzone (upload lives in
  the Composer); per-account Reconnect in Settings (no such
  handler — the header connect buttons are the path).
- **Dark mode** stays an app-wide owner-decision item, excluded
  by the plan; the page state architecture (2,090-line page.tsx
  holding state) is untouched by design.

## Deploy note

This package rides **with the SU package**: same branch
(`su-package`), same integration step (merge into the release
line together with the parallel CC Advanced / EC Phase 3 lines —
the union fresh-Postgres sequence is mandatory there, as recorded
in the SU summary), push **only on the owner's explicit
instruction**, then the owner's manual Dokploy Redeploy. After the
redeploy: run the screenshot QA checklist above and tick it with
a date; the 5 SU migrations and the per-org job enables from the
SU deploy checklist (`docs/social-update-package-summary.md`)
apply unchanged — this design package adds **no** migration, env
var or job of its own.
