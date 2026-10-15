# SD Batch 1 Acceptance — SD1 Foundation + SD2 Header/Tab Rail + SD3 Composer v2

**Package:** Social Posts Design Update (SD1–SD8), Batch 1 of 3 — plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Social-Posts-Design-Plan-2026-10-14.md`
(Batch 1: SD1 + SD2 + SD3).
**Branch/worktree:** `su-package` in `~/workspace/ai-marketing-saas-su`
(base `94aead6`, the SU1–SU12 code-complete HEAD). **LOCAL COMMITS ONLY — nothing pushed.**

**WEB-ONLY batch** (plan §২): no API, schema, migration, endpoint,
handler or state-logic change. Changes are JSX structure/className
plus one additive `.soc-*` section in `globals.css`.

## Commits

| Commit | Contents |
|---|---|
| `1696a08` | SD1: design foundation — additive `.soc-*` primitives in globals.css (power header, sticky tab rail, step badge, platform avatar/dot, skeleton, empty state, mobile action bar, dropzone; all brand-derived via `--brand-from/--brand-to`); one pill shape in `shared.tsx` (`PostStatusPill` / `ApprovalStatusPill` / `AccountStatusPill` / `HealthPill` over the existing records, no new mapping); `AccountAvatar` / `PlatformDot` identity components; pill swaps in SettingsPanel (account status, health) and PostsPanel (post status ×2); MediaThumb placeholder 10px → 12px |
| `39f5551` | SD2: power header (`.soc-header`) with live stat chips counted **only** from already-loaded page data (connectedAccounts, queuePosts, pendingApprovalPosts, failureGroups total, accountHealth errors; failed/health chips render only when > 0), chip clicks jump to the owning tab; error/notice become dismissible `.alert` banners (existing `setError`/`setNotice`, same texts); tab bar becomes `.soc-tab-rail` (sticky under the 60px topbar, scroll-snap, 44px targets, brand-gradient active state) with URL hash deep-links (`#composer/#posts/#library/#analytics/#settings`, read on mount, `replaceState` on switch); composer tab gains bottom padding for the mobile action bar |
| `5fb7152` | SD3: Composer v2 — the single composer card becomes a guided 4-step flow (১ Content / ২ Media / ৩ Accounts & Variants / ৪ Save) of `.soc-section-card` step cards with numbered brand badges, field order and handlers untouched; SU1 platform preview moves into a sticky rail (lg:sticky, 380px column, all target previews stacked) and renders inline below the steps on mobile; existing pre-flight warnings become a checklist (✗ per failing rule with the same warning texts, one ✓ line when an account passes); media step gains a real dropzone (drag-over brand ring, `onDrop` → the **existing** `uploadMedia`, one file at a time) and paste-to-upload on the composer root, both honouring the existing busy/MAX_MEDIA guards; account rows and variant/preview headers use the SD1 `AccountAvatar`/`PlatformDot`/badge chips; AI generate buttons take the single `.btn-ai` shape; mobile sticky action bar (above the bottom nav, `lg:hidden`) carries the composer's own Save action on the same `saveDraft` handler/busy guard |
| _(this docs commit)_ | This acceptance record |

## Final gate (run by the finisher on the final tree, HEAD `5fb7152`)

| Gate | Result |
|---|---|
| Web vitest FULL | **41 files, 315/315 tests PASS** (unchanged from the SU final gate — no test touched) |
| Web tsc (`tsc --noEmit`) | **0 errors** |
| Web next build | **Green** (exit 0, full route table emitted, `.next/BUILD_ID` present) |

No fix commit was needed: the batch's own commits pass the full
gate as they stand.

## Zero-loss verification (base `94aead6` vs HEAD `5fb7152`)

Method: both trees extracted with `git archive`; the same
extraction run on both sides.

- **Files changed:** only the social-posts tree (page.tsx,
  ComposerPanel, PostsPanel, SettingsPanel, shared.tsx) and
  `apps/web/src/app/globals.css`. **No API, schema, lib or any
  other file changed** — the WEB-ONLY condition holds. (The batch's
  commits also carried `apps/web/tsconfig.tsbuildinfo` churn, a tsc
  incremental-cache artifact, not a source change; the working-tree
  copy was restored to the committed version after the gate runs.)
- **Endpoints:** unique `social/…` API path segments in the tree:
  **43 base vs 43 head — the sets are identical.** Lib files that
  hold the remaining endpoint strings were not touched at all.
- **Bengali UI labels:** JSX text segments extracted from both
  trees: **180 base → 191 head, ZERO lost.** The 11 additions are
  all new SD2/SD3 presentation: 5 header stat-chip labels
  (সংযুক্ত অ্যাকাউন্ট / Queue-তে শিডিউল / অনুমোদনের অপেক্ষায় /
  ব্যর্থ পোস্ট / ⚠️ অ্যাকাউন্টে সমস্যা আছে), the 4 step numbers
  (১ ২ ৩ ৪), the pre-flight pass line (প্রকাশের জন্য প্রস্তুত),
  and the mobile action bar's Save label (সংরক্ষণ). Quoted-string
  extraction was also diffed: every base string is present in head;
  the only differences are the surrounding JSX structure captured
  by the extraction, not the label texts.
- **Panels stay mounted:** page.tsx keeps the SU11 pattern — all 5
  panels rendered, inactive ones `hidden` (composer / posts /
  library / analytics / settings), so no panel state is lost on
  tab switch.
- **Hash deep-links present:** mount reads `window.location.hash`;
  tab switch writes it via `history.replaceState`.
- **Sticky preview + dropzone:** preview rail is
  `lg:sticky lg:top-[148px]` in ComposerPanel; dropzone `onDrop`
  and root `onPaste` both funnel into the pre-existing
  `uploadMedia` from the page context — **no new endpoint**.

## Before / after counts (social-posts tree, same method both sides)

| Measure | Base `94aead6` | Head `5fb7152` |
|---|---|---|
| Responsive utilities (`sm:`/`md:`/`lg:`/`xl:`) | 2 | 5 (+ `.soc-*` CSS carries the tab-rail scroll-snap, sticky rail and action-bar breakpoint behaviour, which this count does not capture; the full responsive pass is SD8) |
| `text-[10px]`/`text-[11px]` occurrences | 48 (10px: 13) | 39 (10px: 10) — the remainder are badge/meta sizes; the full typography floor pass completes in SD8 |
| `.soc-*` classes defined in globals.css | 0 | 20 |
| `.soc-*` usages in the tree | 0 | 23 (14 unique) |
| `brand-from`/`brand-to` references in globals.css | 89 | 98 (the `.soc-*` section derives from the brand variables, so tenant white-label now flows into this page's header/rail/chips) |

## Honest limits

- **Mobile action bar carries Save only.** Schedule and Publish
  act per-post in the Posts tab; there is no composer-level
  Schedule/Publish handler, so those buttons were **not** faked
  onto the bar (SD3 commit states this; it stands).
- **No screenshot QA** — there is no live app in the sandbox; the
  visual result is verified by code, build and counts only. The
  deploy-time screenshot checklist belongs to SD8.
- **Pill/avatar application is partial in this batch** — SD1
  applied the single pill shape in SettingsPanel (account status,
  health) and PostsPanel (post status ×2) and across the composer;
  full application to every surface completes in Batch 2/3
  (SD4–SD7) as planned.
- **Typography/responsive floors are started, not finished** —
  see the counts table; SD8 owns the full pass.
- **Process note:** the batch's original coordinator died mid-run
  in a daemon restart after the three SD commits had landed
  (tree clean at `5fb7152`). A finisher agent recovered the work
  from the commits, ran the final gate and zero-loss verification
  above, and wrote this acceptance. No design work was redone.
