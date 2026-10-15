# Social Posts Update — Batch 4 Acceptance (SU7 + SU8)

**Status:** Delivered (local commits on `su-package`, on top of Batch 3
`07e218f`; NOTHING pushed). Plan: `docs/social-posts-update-plan.md`,
Batch 4. Spike: `docs/social-su8-stories-spike.md`. Evidence ceiling,
stated plainly up front: **no live platform call was made for this
batch** — Meta story publish, follower counts and YouTube thumbnails
are proven at the stubbed-fetch boundary only; live proof is an
SU0/SU12 item, as with every earlier Social batch.

## Commits

- `76724ef` — SU7+SU8 API (+ schema + the migration below)
- `7868a36` — SU7+SU8 web
- (this docs commit: spike doc + this acceptance)

## Migration

One hand-written additive migration:
`20261013430000_su7_su8_analytics_publishing` — new table
`SocialAccountFollowerSnapshot` (`day` VarChar(10), `followers` Int;
unique `(socialAccountId, day)`; index `organizationId`;
FKs → SocialAccount + Organization, Cascade) and `SocialPost` gains
`youtubeTitle`, `youtubeTags` (Json), `youtubeCategoryId`,
`youtubeIsShort` (default false), `coverAssetId`, `isStory`
(default false). Before writing it, this worktree (last
`20261013420000_su5_su6`), the adv worktree (last
`20261013310000_cc11_health_checks`) and the other tracked worktrees
were checked: nobody had taken 430000, and the SU range cap
(20261013499999, EC Phase 3 owns 350000+) is respected.
Fresh-Postgres sequence: **149/149 applied, 0 rolled back,
197 public tables** (details under Gates).

## SU7 — Analytics v2

Every number comes from **stored insights only** — a metric the
platform never returned stays absent (never 0, never estimated);
every total carries its **basis count** (how many posts actually
had that metric), the SP7 discipline carried through all new
surfaces.

- **Timeseries.** `GET insights/timeseries?days=30` (1–90).
  Published posts are bucketed by `publishedAt` per calendar day
  in the ORG timezone (the Intl pattern `computeBestTime` uses).
  Each day carries per-metric `{total, posts}` plus
  `engagement {total, posts}` (SP7 `engagementScore`). Days with
  no scored posts appear with empty metrics and
  `engagement {total: 0, posts: 0}` — a structural zero (no posts
  that day), explicitly not a measured zero.
- **Content types.** `GET insights/content-types`. Classification
  from `mediaRefs` alone: any video ref → `video`; >1 refs →
  `carousel`; exactly 1 image → `photo`; 0 → `text`. Per class:
  total published posts, how many carry insights, engagement
  total/average — **null when a class has no scored post** (never
  a fabricated 0 average).
- **Account comparison.** `GET insights/accounts` — the summary's
  per-metric basis totals grouped per account (platform + name),
  beside the unchanged SP7 summary endpoint (old shape untouched).
- **Follower snapshots.** `SocialAccountFollowerSnapshot`, one row
  per account per org-local day. New `MetaSocialPublisher.
  getFollowerCount`: Page → `fan_count`, IG → `followers_count`;
  an absent/non-numeric field returns **null (no snapshot is
  written)**, a Graph error throws verbatim.
  `SocialInsightsService.snapshotFollowers(orgId)` runs per
  connected meta_page/instagram account through the publish
  service's existing token seam, upserts today's row, and is
  failure-isolated (one account's failure never stops the rest;
  a dead token marks the account, exactly like insights refresh).
  One audit row (`social.follower_snapshot`) records the counts.
  Driven by the new automation template **`social_follower_
  snapshot`** (1440 min, org target — installed per org, like
  every sweep). `GET insights/followers` returns each account's
  snapshot series (day ascending); no snapshots → an honest empty
  series, and the web copy says so instead of charting a guess.
- **Monthly report.** `GET insights/report.csv?month=YYYY-MM` and
  `GET insights/report.pdf?month=YYYY-MM` (month absent → the org's
  current month; a malformed month is a Bengali 400). Rows are the
  month's posts (by `publishedAt`, or `createdAt` while
  unpublished): date, platform, account, caption excerpt (CSV
  only), status, every stored metric (**absent = empty cell**,
  never 0), engagement, and link clicks from SU6's real
  `SocialLinkClick` rows.
  **PDF decision:** the repo's only PDF mechanisms are the reports
  module's print-HTML and the courier module's dependency-free
  `PdfCanvas` writer (PDF 1.4, no new dependency). The PDF report
  uses **`PdfCanvas`** — a real downloadable PDF, not a print
  page. Because PdfCanvas fonts are WinAnsi-only (Bengali would
  render as "?"), the PDF table deliberately carries the
  machine-readable columns (date, platform, account, status,
  engagement, clicks + totals over present values only) and **no
  caption text** — the caption lives in the CSV, which is
  BOM-prefixed UTF-8. Stated in the code comment and here, not
  disguised.
- **Web.** The SP7 performance strip grows in place: a pure-helper
  SVG/div bar chart of the 30-day timeseries (tooltip per day:
  engagement + basis posts), the content-type table (null →
  "—" with the basis noted), the account comparison table,
  follower growth per account (first → last snapshot + delta;
  below 2 snapshots or none → the honest note naming the
  "Social Follower Snapshot" automation template), and a month
  picker with CSV/PDF download buttons (raw-fetch blob →
  temporary anchor, the accounting/exports pattern). All four new
  loaders are failure-isolated so analytics can never break the
  page's main load. Helpers live in `lib/social-analytics.ts`
  (18 vitest).

## SU8 — Publishing Depth (spike-first)

- **Stories spike** (`docs/social-su8-stories-spike.md`): FB Page
  photo story and IG story flows are both documented by Meta;
  per this batch's scope only the **FB Page photo story** was
  implemented: `SocialPost.isStory` + `meta_page` + exactly one
  image routes publishing through unpublished photo upload →
  `POST /{page-id}/photo_stories`, and only Meta's documented
  `{success: true, post_id}` counts as published
  (`platformUrl = https://facebook.com/stories/<post_id>`, the
  documented `GET /stories` URL shape). Any other platform or
  media shape is refused pre-flight with a Bengali message —
  story captions do not travel to the platform (documented; the
  caption stays on our row). **IG stories and FB video stories
  were NOT built** (documented in the spike as candidates, kept
  out so one batch opens one new surface).
- **YouTube metadata.** `youtubeTitle` (wins over the
  caption-derived title), `youtubeTags`, `youtubeCategoryId` —
  sent in the resumable-upload snippet only when set (unset ⇒
  the request body is byte-identical to SP9's; its spec stays
  green). `youtubeIsShort` appends `#Shorts` to the title when
  absent (total stays ≤100 chars). **Playlist selection was not
  built** — no playlist field ships in this batch.
- **YouTube cover.** After a successful upload, a set
  `coverAssetId` is applied via the documented
  `POST /upload/youtube/v3/thumbnails/set` (raw image bytes read
  from MediaStore by range). A thumbnail failure **never** fails
  the publish: the post stays published and the verbatim error is
  appended to `publishNote` ("Cover (thumbnail) সেট করা যায়নি: …").
- **FB video cover — NOT built.** The Graph reference lists a
  `thumb` (raw data) parameter on the Page videos edge, but its
  documented connection to our `file_url` publish flow (and any
  post-publish `/{video-id}/thumbnails` path) could not be
  confirmed in the spike. Rather than send an unverified
  parameter and claim a cover, nothing was implemented — see the
  spike doc.
- **Cross-post derive.** `POST posts/:id/derive {accountIds}` —
  one DRAFT variant per compatible target account through the
  SU1 group (the source's group is reused; a groupless source
  gets a new group and joins it). Caption/link/media/first
  comment/YouTube fields/cover are copied; `isStory` is not.
  Targets that fail platform pre-flight (and unknown or
  disconnected accounts) are skipped with a per-account warning
  returned verbatim and shown in the UI; a TikTok target always
  carries the warning that the video lands in the creator's
  inbox, not published. Audited `social.post_derived`.
- **TikTok photo / direct post:** unchanged — still gated on the
  owner's app audit (the audited flag); nothing was built here.

## Gates (coordinator-run on the final tree, 2026-10-13)

- **API jest FULL** (`NODE_OPTIONS=--max-old-space-size=4096`,
  `--runInBand`): **317 suites / 3145 tests, ALL PASS** — base was
  315/3115; the +2 suites / +30 tests are exactly the new SU7
  (13) + SU8 (17) specs. No flake this run (the known cx3-debounce
  flake did not appear); no existing spec needed changing.
- **Web vitest FULL:** **308/308** (290 base + 18 new
  `social-analytics` tests).
- **tsc:** API 0, web 0, admin 0. **Prisma:** validate 🚀 valid
  + generate run.
- **Monorepo build:** `pnpm -r build` green (exit 0; web build
  Done).
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL
  16.4 cluster, `prisma migrate deploy` from this tree —
  **149/149 applied (148 through Batch 3 + 1 new), 0 unfinished/
  rolled back, 197 public tables** (verified in
  `_prisma_migrations`, not just the CLI tail).

## Honest limits

- No live proof: no real Page story, follower fetch, YouTube
  upload or thumbnail was exercised (no platform accounts in the
  sandbox) — SU0/SU12 items, like all Meta/Google surfaces here.
- Follower growth only exists once the per-org
  `social_follower_snapshot` job is installed and has run on
  real days; the API never backfills or interpolates.
- The monthly PDF carries no caption/Bengali text by design
  (WinAnsi ceiling of the repo's own PDF writer); the CSV is the
  complete record.
- Timeseries days are calendar buckets of *published* posts —
  insights fetched later still count on the publish day, because
  stored insights carry no per-day history.
- No screenshot QA of the new analytics/derive UI (no live app
  in the sandbox); the web gate is vitest + tsc + next build.
- The migration has never run against the production DB — it
  arrives with the next owner-authorized push + Dokploy Redeploy,
  together with the other tracks' pending migrations.
