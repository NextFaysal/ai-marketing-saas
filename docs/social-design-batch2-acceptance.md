# SD Batch 2 Acceptance — SD4 Posts/Calendar + SD5 Library + SD6 Analytics

**Package:** Social Posts Design Update (SD1–SD8), Batch 2 of 3 — plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Social-Posts-Design-Plan-2026-10-14.md`
(Batch 2: SD4 + SD5 + SD6).
**Branch/worktree:** `su-package` in `~/workspace/ai-marketing-saas-su`
(base `dcd0d79`, the SD Batch 1 HEAD). **LOCAL COMMITS ONLY — nothing pushed.**

**WEB-ONLY batch** (plan §২): no API, schema, migration, lib, endpoint,
handler or state-logic change. Changes are JSX structure/className
plus three additive `.soc-*` classes in `globals.css`.

## Commits

| Commit | Contents |
|---|---|
| `b40c6ec` | SD4: Posts & Calendar v2 — post card v2 (`AccountAvatar` + a local `PlatformChip` carrying `PlatformDot` + the same `PLATFORM_LABELS` text; SD1 `PostStatusPill`; the page's `renderApprovalBadge` now renders the SD1 `ApprovalStatusPill` over the same `APPROVAL_STATUS_META`; prominent scheduled/published time line in `text-sm font-semibold` from the existing `fmtInTz`; primary actions — detail toggle, submit-approval, edit, delete — in front, with Clone/Derive/Link-stats moved inside the SU9 detail expander; `.soc-selected` brand ring on bulk-selected cards; `.soc-skeleton` blocks on the existing `posts-more` busy state); calendar v2 (`.soc-cal-today` brand highlight replacing the hard-coded indigo ring, platform-dot post chips, the 7-column grid wrapped `hidden md:block`, and a mobile agenda list under `md` grouped by day from the **same** `calBuckets`/`calCells` data); queue view as a brand-dot timeline with a larger schedule time; approval queue gets an amber section header band; posting-slot rows gain avatar + platform chip; additive globals `.soc-chip-active` / `.soc-cal-today` / `.soc-selected` |
| `37d79f5` | SD5: Library v2 — media grid `grid-cols-2 sm:3 lg:4 xl:5` (fixed `w-44` flex tiles dropped); folder bar becomes a scrollable chip rail whose active chip takes the brand-gradient `.soc-chip-active` (hard-coded indigo dropped); video tiles gain a kind badge; a hover/focus quick-action overlay carries the **same** per-kind handler as the control below the thumb (Cover for video, PNG version for SVG, Crop for image) while the below controls stay for touch; bulk-selected tiles take the `.soc-selected` ring; the empty library becomes a `.soc-empty` state with the same text |
| `4a48358` | SD6: Analytics v2 — a `.ctx-tile` summary row on top (total / published posts counted from the loaded posts; total engagement summed from the **same** timeseries bars, with the basis subtext; follower delta summed from the **same** per-account `followerGrowth` results; `—`, never an invented number, when the data is absent); timeseries bars take the brand gradient (hard-coded `bg-indigo-500` dropped) with larger value/day labels; content-type and account tables get ring + header polish; account-comparison and follower rows gain `AccountAvatar` + `PlatformDot` identity; every no-data branch becomes a `.soc-empty` state keeping the exact honest text; the monthly CSV/PDF report becomes its own export card |
| _(this docs commit)_ | This acceptance record |

## Final gate (run on the final tree, HEAD `4a48358`)

| Gate | Result |
|---|---|
| Web vitest FULL | **41 files, 315/315 tests PASS** (unchanged from the SD Batch 1 gate — no test touched) |
| Web tsc (`tsc --noEmit`) | **0 errors** |
| Web next build | **Green** (exit 0, full route table emitted, `.next/BUILD_ID` present) |

## Zero-loss verification (base `dcd0d79` vs HEAD `4a48358`)

Method: the base tree extracted with `git archive`; the same
extraction run on both sides (the Batch 1 method — it reproduces
Batch 1's own counts exactly on the older trees: 180 labels at
`94aead6`, 191 at `dcd0d79`, 43 endpoints on both).

- **Files changed:** only the social-posts tree (`PostsPanel.tsx`,
  `LibraryPanel.tsx`, `AnalyticsPanel.tsx`, and in `page.tsx` only
  the `renderApprovalBadge` pill swap + its import) and
  `apps/web/src/app/globals.css`. **No API, schema, lib or any other
  file changed** — the WEB-ONLY condition holds. The
  `apps/web/tsconfig.tsbuildinfo` churn from the gate runs (a tsc
  incremental-cache artifact, not a source change) was restored to
  the committed version; the final tree is clean.
- **Endpoints:** unique `social/…` API path segments in the tree:
  **43 base vs 43 head — the sets are identical** (diffed, not just
  counted).
- **Bengali UI labels:** JSX text segments extracted from both
  trees: **191 base → 196 head, ZERO lost.** The 5 additions are
  all new SD4–SD6 presentation: the agenda today badge (আজ), the
  agenda empty-month line (এই মাসে কোনো শিডিউল করা পোস্ট নেই।), the
  two analytics tile labels (মোট post / প্রকাশিত post), and the
  library video kind badge (🎬 ভিডিও). Quoted-string extraction was
  also diffed (Batch 1 discipline): **320 base → 323 head, ZERO
  lost** — the additions there are the tile subtexts inside string
  literals (e.g. "snapshot অনুযায়ী", "যথেষ্ট snapshot নেই").
- **Panels stay mounted:** page.tsx is untouched in structure —
  all 5 panels still render with inactive ones `hidden` (the only
  page.tsx change is the approval-pill swap), so no panel state is
  lost on tab switch.
- **Pill/avatar application:** the SD1 components now cover every
  status/account surface in the Posts and Analytics panels —
  `PostStatusPill` (list card, calendar detail, queue),
  `ApprovalStatusPill` (via `renderApprovalBadge` everywhere it
  renders), `AccountAvatar`/`PlatformDot` (slot rows, approval
  queue, list cards, calendar detail, queue, analytics account and
  follower rows). The Library panel has no status/account surface
  (media assets only), so it takes `.soc-*` classes instead.

## Before / after counts (the three Batch-2 panels, same method both sides)

| Measure | Panel | Base `dcd0d79` | Head `4a48358` |
|---|---|---|---|
| Responsive utilities (`sm:`/`md:`/`lg:`/`xl:`) | PostsPanel | 0 | 2 |
| | LibraryPanel | 0 | 3 |
| | AnalyticsPanel | 0 | 1 |
| | **Total** | **0** | **6** |
| `text-[10px]`/`text-[11px]` occurrences | PostsPanel | 12 | 8 |
| | LibraryPanel | 13 | 17 |
| | AnalyticsPanel | 1 | 4 |
| | **Total** | **26** | **29** |
| `.soc-*` class usages | PostsPanel | 0 | 5 |
| | LibraryPanel | 0 | 6 |
| | AnalyticsPanel | 0 | 10 |
| | **Total** | **0** | **21** |
| SD1 component usages (pill/avatar/dot) | PostsPanel | 3 | 15 |
| | LibraryPanel | 0 | 0 |
| | AnalyticsPanel | 0 | 5 |
| | **Total** | **3** | **20** |

Notes on the counts, stated plainly:

- The responsive total is small in raw utility count because much
  of the behaviour lives in the `.soc-*` CSS and in structural
  changes the count does not capture (the calendar grid/agenda
  switch is 2 utilities; the library grid is 3). The full
  responsive pass remains SD8's job, as planned.
- The `text-[10px]/[11px]` total rose by 3 net: PostsPanel fell
  12 → 8, but every *new* element added by this batch carries a
  badge/meta size — the library overlay buttons and video badge
  (+4 in LibraryPanel) and the analytics tile subtexts plus the
  chart day label moving 9px → 10px (+3 in AnalyticsPanel). **No
  existing text was shrunk**; the typography floor pass completes
  in SD8.

## Honest limits

- **The mobile calendar agenda is presentation only** — verified
  in code: it renders from the same `calCells`/`calBuckets` the
  month grid uses, groups them by day under `md`, and its post
  buttons call the same `setSelectedPostId`. No new fetch, no new
  state, no data the grid does not already show (the agenda lists
  all of a day's posts instead of the grid's 3 + "+আরও n").
- **Library grid skeleton not added** — `loadAssets` sets no busy
  or loading flag (checked in page.tsx), so the panel has **no
  existing loading condition** to hang a skeleton on; inventing
  one would mean a state change, which this package forbids. The
  one real loading condition in scope — the posts list's
  `posts-more` — did get `.soc-skeleton` blocks (SD4).
- **Video cover thumbnail priority not implemented** — SD5's plan
  line "cover থাকলে তা-ই thumbnail" needs a cover reference on the
  asset; `MediaAsset` carries none (a captured cover is a separate
  derived asset), and `MediaThumb` renders the asset itself. With
  no existing data to read, nothing was wired — the video kind
  badge is what shipped.
- **Library upload dropzone not in this panel** — the Library
  panel has no upload control of its own (upload lives in the
  Composer's media step, which got the dropzone in SD3), so there
  was no upload area here to restyle.
- **Analytics tiles count the loaded posts** — the total/published
  tiles read the same `posts` array the Posts tab itself labels
  "মোট {posts.length}টি"; with SU11 pagination that is the loaded
  set, exactly as the page already presents it elsewhere. The
  engagement/follower tiles sum only the panel's own endpoint
  data (timeseries bars / snapshot growth) and show "—" without it.
- **No screenshot QA** — there is no live app in the sandbox; the
  visual result is verified by code, build and counts only. The
  deploy-time screenshot checklist belongs to SD8.
