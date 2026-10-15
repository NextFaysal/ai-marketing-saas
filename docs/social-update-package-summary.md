# Social Posts Update Package Summary — SU1–SU12 (2026-10-13)

**THE SOCIAL POSTS UPDATE PACKAGE IS CODE-COMPLETE. NOTHING IS
LIVE-PROVEN — SU0 live verification is entirely owner-gated and
still open (see the checklist doc).**

Owner approved the full package 2026-10-13 18:26 +06 ("পুরো SU
প্যাকেজ (SU1–SU12) অনুমোদন — Batch 1 থেকে শুরু করো"). Plan:
`docs/social-posts-update-plan.md`. Built in worktree
`~/workspace/ai-marketing-saas-su`, branch `su-package`, base =
integration-2 HEAD `21dec09` (the verified EC Phase-2 × Connect
Center merged line). **Local commits only — NOTHING pushed**
(push waits for the owner's explicit in-the-moment instruction;
every push triggers a Dokploy rebuild).

SU takes the already-shipped Social Posts system (SP1–SP9 +
PP1–PP4) from a per-account composer to a full social workspace:
grouped per-platform variants with first comments, queue slots /
recurring series / evergreen drafts, a real media library, an AI
content engine on the tenant's own data, commerce-triggered
drafts, tracked links with honest revenue *association*, analytics
v2, deeper publishing (FB photo stories, YouTube metadata +
cover), team collaboration, account health + a failure center,
and a tabbed page redesign. Every AI/commerce path stops at a
DRAFT — nothing in this package can publish on its own.

## Status table

| Item | Scope (what actually shipped) | Batch | Migration | Evidence |
|---|---|---|---|---|
| SU0 | Live-verification gate (owner accounts) | — | — | **OPEN — owner-gated.** Not one session has run; see `docs/social-live-verification-checklist.md` (all boxes unchecked) |
| SU1 | Composer v2: `SocialPostGroup` + per-platform variants, first comment (posted only after Meta publish success; failure leaves the post published, error verbatim), `validateForPlatform` pre-flight, platform preview, clone | B1 | 20261013400000 | Stubbed-Graph boundary specs (su1 12 + su1-publish 8) |
| SU2 | Queue slots + recurring + evergreen: `SocialPostingSlot`, "Add to Queue" (next free slot, org tz), recurring series (exactly one next occurrence, no drift), evergreen sweep creating DRAFT clones only, best-time one-click (honest 400 when <10 scored posts) | B1 | 20261013400000 | Service specs (su2 16); sweep = `social_evergreen_sweep` job |
| SU3 | Media Library v2: `MediaFolder` + asset tags/filters/usage/bulk, sharp aspect editor (derived asset, original untouched), video cover behind an injectable ffmpeg seam (missing ffmpeg = honest 400) | B2 | 20261013410000 | Seam/fake-Prisma specs (su3) |
| SU4 | AI Content Engine v2: hashtag performance from real published captions, `SocialContentPlan` (provider absent = refuse; number guard drops invented-price items), materialize to drafts, Reel script RETURNED ONLY | B2 | 20261013410000 | Stubbed-provider specs (su4) |
| SU5 | Commerce-triggered auto DRAFTS only: `SocialAutoDraftConfig` (4 toggles default FALSE, cap 3/day, target account) + `SocialCommerceDraftService`; hooks ride the global EventsService bus (product created, inventory 0→positive adjust, promotion create/flip/activate, review received — milestone at multiples of 50 total reviews, else 5-star) | B3 | 20261013420000 | Service specs (su5 26) |
| SU6 | UTM + tracked link + revenue association: `/public/social/r/:token` redirect (bot/preview UA redirected, not counted), FB publish uses the tracked URL (honest raw-link fallback when `API_PUBLIC_URL` absent), join = Touchpoint.campaign → AttributionCredit (LAST_TOUCH) → Order, labelled "association, attribution নয়"; serializer exposes `hasTrackedLink` only, never the token | B3 | 20261013420000 | Service specs (su6 17) |
| SU7 | Analytics v2: timeseries (org-tz day buckets, per-metric `{total, posts}` basis), content-types (avg null — never an invented 0), account comparison, `SocialAccountFollowerSnapshot` + `social_follower_snapshot` job, monthly report CSV **and** PDF (dependency-free PdfCanvas; PDF carries no Bengali caption — WinAnsi limit — full record in the BOM UTF-8 CSV) | B4 | 20261013430000 | Service specs (su7 13) |
| SU8 | Publishing depth, spike-first (`docs/social-su8-stories-spike.md`): FB Page **photo** story built (unpublished photo → `photo_stories`, published only on Meta's documented `{success, post_id}`); IG story + FB video story NOT built; YouTube metadata (title/tags/category/isShort → `#Shorts`) + `thumbnails.set` cover after upload (failure keeps the post published, verbatim note); cross-post derive into SU1 group drafts | B4 | 20261013430000 | Stubbed-fetch specs (su8 17) |
| SU9 | Collaboration: internal notes (publish path fully separate), version snapshots on create/edit with restore on drafts only (+ SP7 approval reset), timeline (versions/notes + real AuditLog approval events, marked derived fallback), assign to ACTIVE members, optional two-step approval (OFF = SP7 behaviour, regression-pinned) | B5 | 20261013440000 | Service specs (su9 24) |
| SU10 | Account health + failure center: `SocialHealthService` (Meta Graph identity / OAuth token check, `healthCheckedAt` on every attempt, error→connected recovery, health labels), failure groups by normalized error signature, retry delegating to `publishNow` (attempts reset only on explicit human retry, audited). Repeated-failure Telegram/email escalation NOT built — SP5's in-app `AgentNotification` is the only alert | B5 | 20261013440000 (shared) | Service specs (su10 18) |
| SU11 | Tabbed redesign + pagination + bulk/CSV: 5-tab workspace, all panels mounted (composer state survives tab switches), page split into components, opt-in cursor pagination (legacy bare-array byte-identical), bulk delete-drafts/reschedule, CSV import (rows are ALWAYS drafts in v1). Zero-loss counted: endpoints 67/67, UI labels 504/504 | B5 | — (no schema) | Service specs (su11 19) + zero-loss counts |
| SU12 | Closing: final full gate on the final tree (below), this summary, the live-verification checklist, SU12 acceptance. No new feature code | B6 | — | This batch's gate run, 2026-10-13 |

Per-batch detail: `docs/social-su-batch{1..6}-acceptance.md`.

## Commits (25 before this summary's batch, base `21dec09` → Batch 5 HEAD `5157e2c`)

| Commit | Scope |
|---|---|
| `263cc1a` | Plan doc (owner approved in full 2026-10-13) |
| `0c6e6b6` | SU1+SU2 API: groups/variants, first comment, pre-flight, clone, slots, recurring, evergreen sweep, best-time |
| `e254bed` | SU1+SU2 web: composer variants + preview, queue/best-time/evergreen controls |
| `a021241` | Batch 1 acceptance doc |
| `1053be8` | SU3+SU4 API: folders/tags/usage/bulk, aspect editor, ffmpeg seam, hashtag performance, content plan, reel script |
| `bfab25a` | SU3+SU4 web: library + AI panel |
| `e020a82` | Batch 2 acceptance doc |
| `11538c0` | SU5+SU6 schema + migration 20261013420000 |
| `79ff068` | SU5+SU6 API: commerce draft engine + hooks, link tracking, association stats |
| `2fc2d67` | SU5+SU6 web: auto-draft panel + link stats (+16 vitest) |
| `f231801` | SU5+SU6 fix: `hasTrackedLink` boolean instead of the raw token in the serializer |
| `07e218f` | Batch 3 acceptance doc |
| `76724ef` | SU7+SU8 API + schema + migration 20261013430000: analytics v2, follower snapshots, FB photo story, YouTube metadata/cover, derive |
| `7868a36` | SU7+SU8 web: analytics section, derive UI, story/YouTube composer fields |
| `cd83d8d` | Batch 4 acceptance doc + Stories spike doc |
| `275a97a` | SU9 schema + migration 20261013440000 (notes/versions/assign/two-step + SU10 `healthCheckedAt`) |
| `8747021` | SU9 API: notes, versions, timeline, assign, two-step approval |
| `e8597cc` | SU9 specs (24) |
| `915d3cb` | SU10 prep: Meta identity check + token-resolver flag |
| `5ab3940` | SU10 API: `SocialHealthService`, failure grouping, retry |
| `94c3c9d` | SU10 specs (18) |
| `1630e7f` | SU11 API: cursor pagination, bulk, CSV import + specs (19) |
| `503c873` | SU11 web: component split + 5-tab workspace (pure move) |
| `32e09c3` | SU11 web surface: pagination/bulk/CSV UI, SU9/SU10 surfaces (+7 vitest) |
| `5157e2c` | Batch 5 acceptance doc |

## Migrations (5, all SU-range, NONE run on any real DB)

| Migration | Contents |
|---|---|
| `20261013400000_su1_su2_composer_queue` | `SocialPostGroup`, `SocialPostingSlot`; SocialPost group/first-comment/series/recurrence/evergreen fields |
| `20261013410000_su3_su4_media_ai` | `MediaFolder`, `SocialContentPlan`; MediaAsset `folderId` + `tags` |
| `20261013420000_su5_su6_commerce_links` | `SocialAutoDraftConfig`, `SocialLinkClick`; SocialPost `linkToken`/auto-draft fields; Organization `socialLinkWindowDays` |
| `20261013430000_su7_su8_analytics_publishing` | `SocialAccountFollowerSnapshot`; SocialPost YouTube metadata/`coverAssetId`/`isStory` |
| `20261013440000_su9_su11_collab_health` | `SocialPostNote`, `SocialPostVersion`; SocialPost `assignedUserId`; Organization `socialApprovalTwoStep`; SocialAccount `healthCheckedAt` |

The SU range was claimed in the Cross-Track Ledger as
`20261013400000+` (cap `20261013499999`) before the first
migration was written; each batch re-verified the parallel
worktrees had not taken its slot.

## Final gate (SU12, coordinator-run on the final tree, 2026-10-13)

- **API jest FULL** (`NODE_OPTIONS=--max-old-space-size=4096`,
  `--runInBand`): **320 suites / 3206 tests, ALL PASS** — the
  known cx3-debounce flake did **not** appear in this final run
  (it appeared once in Batch 5's run and passed standalone 18/18;
  both facts stand as recorded).
- **Web vitest FULL:** **41 files / 315 tests, ALL PASS**.
- **tsc:** API 0, web 0, admin 0. **Prisma:** validate valid.
- **Monorepo build:** `pnpm -r build` green, 7/7 packages.
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL
  16.15 cluster, `prisma migrate deploy` from this tree —
  **150/150 applied, 0 unfinished / rolled back, 199 public
  tables** (verified in `_prisma_migrations`). (The first attempt
  died at a base migration because the sandbox's 512 MB `/tmp`
  tmpfs filled up — an environment failure, not a migration
  failure; the cluster was moved to `/var/tmp` and the full
  sequence re-ran clean from an empty database.)

## Deploy checklist (ALL still open — nothing below has happened)

1. **Owner's explicit push instruction first.** Then, per the
   standing lesson: `ls-remote` + fetch GitHub main BEFORE any
   sync (the owner also pushes directly; his commits are merged,
   never overwritten, never force-pushed). This package is **not
   integrated**: `su-package` is based on integration-2
   (`21dec09`), so integration is a separate pass against the
   then-current main.
2. **Final integration MUST re-run the full fresh-Postgres
   migration sequence on the union tree.** Parallel lines are
   live: CC Advanced owns `20261013310000+` (its
   `20261013310000_cc11_health_checks` was observed in the adv
   worktree during this package) and EC Phase 3 owns
   `20261013500000+`. SU's five migrations sit at
   400000–440000 with no known overlap — but the cx7 lesson
   (2026-10-13 outage) is that "no known overlap" is not proof;
   only the union sequence run is.
3. **Run all 5 SU migrations on the real production DB** (they
   apply via `prisma migrate deploy` on API start; none has ever
   run on any real DB), then `prisma generate` where the deploy
   flow requires it.
4. **Manual Dokploy Redeploy** by the owner (push-to-deploy must
   not be assumed working), then the standard post-deploy health
   checks (api `/health`, app, admin).
5. **Per-org Automations job templates to install** (Dashboard →
   Automations, per org — without them the features below are
   silently dormant):
   - `social_publish_due` — "Social Post Publisher", every 5 min
     (pre-existing since SP5; required for ANY scheduled post,
     queue slot or recurring occurrence to publish).
   - `social_evergreen_sweep` — "Social Evergreen Sweep", daily
     (SU2 evergreen draft recycling).
   - `social_follower_snapshot` — "Social Follower Snapshot",
     daily (SU7 follower growth data).
6. **Env:** `API_PUBLIC_URL` must be set on the API — without it
   SU6 cannot build tracked links (posts fall back to their raw
   `linkUrl`, honestly, and no click is ever counted). If S3
   media storage is used, `MEDIA_S3_BUCKET` +
   `MEDIA_S3_ENDPOINT`/`MEDIA_S3_REGION` +
   `MEDIA_S3_ACCESS_KEY_ID` + `MEDIA_S3_SECRET_ACCESS_KEY` must
   be set (the sandbox had none of these — see S3 note below).
7. **Live verification** — run
   `docs/social-live-verification-checklist.md` session by
   session with the owner's real accounts; tick boxes only on
   the stated evidence.

## Integration watch-outs (files SU touched that other tracks also work in)

- **`apps/api/src/automation/automation.service.ts`** — SU added
  two job types + templates + execute cases
  (`social_evergreen_sweep`, `social_follower_snapshot`).
  Additive, but every active track edits the job-type list and
  template table — keep both sides.
- **`packages/db/prisma/schema.prisma`** (social section) — 9 new
  models (`SocialPostGroup`, `SocialPostingSlot`,
  `SocialAutoDraftConfig`, `SocialLinkClick`,
  `SocialAccountFollowerSnapshot`, `SocialPostNote`,
  `SocialPostVersion`, `MediaFolder`, `SocialContentPlan`) plus
  fields on SocialPost / SocialAccount / MediaAsset /
  Organization. CC Advanced also extends the social/account
  area (health checks) — merge field-by-field, never drop a side.
- **SU5 producer hooks** — the commerce auto-draft engine listens
  on the global EventsService bus (direct service injection
  would have created a Nest module cycle). The emit sites are
  small additive hooks in `products/products.service.ts`
  (product created), `inventory/inventory.service.ts`
  (manual-adjust back-in-stock), `commerce/promotions.service.ts`
  (promotion activated) and `orders/reviews.service.ts`
  (review received). EC Phase 3 works in the same four areas —
  at integration, confirm each event is emitted exactly once.
- **`apps/api/src/social/*`** is otherwise SU-owned in this
  package (controller, publish/queue/link/health/library
  services); the web change is contained in
  `apps/web/src/app/dashboard/social-posts/` (page + components).

## Standing honest limits (whole package)

- **No live platform or LLM call of any kind** was made from the
  sandbox for any SU item. All proof is at stubbed-fetch /
  stubbed-provider / fake-Prisma boundaries, as with SP/PP
  before it. SU0 is owed in full.
- **S3 streaming (PP2) is still not live-proven.** SU12 checked:
  the sandbox has **no** `MEDIA_S3_*` configuration or
  credentials anywhere (env and `.env*` files inspected), so
  MediaStore runs in local mode here and no real S3 round-trip
  was possible. It is an owner-deploy checklist step (S10), not
  a claim.
- SU8: IG stories and FB video stories were **not** built; FB
  video cover was **not** built (the `thumb` parameter's tie to
  the `file_url` flow could not be documented); YouTube playlist
  selection was not built.
- SU10 health proves identity/token validity only — no Graph
  permissions inventory, no token-expiry estimate. The
  repeated-failure Telegram/email escalation was not built.
- SU9 version snapshots do not cover clone / derive /
  auto-draft / recurrence / evergreen copies (they create rows
  directly — documented in the Batch 5 acceptance).
- SU3's video cover is wired into the YouTube publish path by
  SU8 (`thumbnails.set`); it is not wired into Reels/FB video
  (no documented cover path — see above).
- SU5: auto-draft captions carry `linkUrl: null` (no honest
  absolute product URL exists at engine time); back-in-stock
  fires only from the manual inventory-adjust path.
- SU6 association counts only orders carrying a tracker +
  attribution credit — it undercounts by design and is labelled
  "association, attribution নয়" everywhere it appears.
- SU4/SU7 hashtag extraction truncates Bengali tags at vowel
  signs (`#অফার` → "অফ") — recorded, consistent on API and web,
  not hidden.
- **No screenshot QA** exists for any SU surface: the SU build
  has never been deployed, so there is no live app to screenshot.
  That is a checklist item after deploy, not a done item.
- Production **ffmpeg** and **fonts** are unverified on the real
  host (the sandbox has ffmpeg 8.1.2 and Noto fonts; the
  production image/host is a different machine — checklist S10).
