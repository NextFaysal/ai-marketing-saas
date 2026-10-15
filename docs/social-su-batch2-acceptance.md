# Social Posts Update — Batch 2 Acceptance (SU3 + SU4)

**Status:** Delivered (local commits on `su-package`, on top of Batch 1
`a021241`; NOTHING pushed). Plan: `docs/social-posts-update-plan.md`,
Batch 2. Evidence ceiling, stated plainly up front: **no live LLM call
and no production ffmpeg run was or could be made for this batch** —
the AI paths are proven at the stubbed-provider boundary and the cover
path at its ffmpeg seam, the package's standing discipline. SU0/SU12
live verification remains the owner's.

## Migration

One hand-written additive migration:
`20261013410000_su3_su4_media_ai` — new tables `MediaFolder`,
`SocialContentPlan`; `MediaAsset` gains `folderId` (FK, SetNull) and
`tags` (JSONB, default `[]`); 2 indexes, 3 FKs. The SU range continues
at 20261013410000 +1 exactly as reserved — before writing it, both this
worktree (last was `20261013400000_su1_su2`) and the adv worktree
(last `20261013310000_cc11_health_checks`) were checked: nobody had
taken 410000. Fresh-Postgres sequence: **147/147 applied, 0 rolled
back, 194 public tables** (details under Gates).

## SU3 — Media Library v2

New `SocialMediaLibraryService` (folder/usage/bulk/editor/cover),
following the raster service's seam discipline (public fields the
specs substitute: `readBytes`/`writeBytes`/`deleteBytes`,
`imageEditor`, `ffmpegAvailable`, `frameExtractor`; defaults are the
real MediaStore / sharp / ffmpeg).

- **Folders.** Flat `MediaFolder` (org, name; no parent in v1). CRUD
  under `media/folders` — declared before every `media/:id` route so
  the literal segment is never captured as an asset id. Duplicate
  name in the same org (case-insensitive) ⇒ Conflict; foreign folder
  ⇒ 404. Deleting a folder makes its assets folderless via the FK's
  SetNull — the service deletes only the folder row.
- **Asset fields.** `folderId` + `tags` on `MediaAsset`; the shared
  serializer in `SocialService.serializeAsset` now also returns
  `folderId`, `tags` and `derivedFromId`, so uploads and every older
  media path carry them too. `PATCH media/:id` edits name/folder/tags
  (tags through the exported `normalizeMediaTags`: trim,
  case-insensitive dedupe keeping the first form, max 20, tags over
  50 chars dropped).
- **Filtered list.** `GET media` now goes through the library service
  with `?folderId=&tag=&q=` — `folderId="none"` means folderless;
  tag and name filters are applied service-level over the JSON /
  lowercase name (the list is capped at 200 like before).
- **Usage.** `GET media/:id/usage` scans the org's posts' `mediaRefs`
  JSON service-level (org-scoped; unknown/cross-org asset ⇒ 404) and
  returns the referencing posts — never another org's.
- **Bulk.** `POST media/bulk {ids, action: move|delete, folderId?}`
  returns per-item `{id, ok, error?}` and never stops at the first
  failure. **Delete refuses a used asset** with the Bengali reason
  (how many posts use it) and leaves the row in place; an unused
  asset's storage bytes and row are both deleted. One audit row per
  bulk call carries the ok/failed counts.
- **Aspect editor.** `POST media/:id/edit {aspect}` — sharp
  center-crops to 1:1 / 4:5 / 9:16 / 16:9 (downscale only, never
  upscale; SVG sources become PNG) and stores the result as a NEW
  derived asset (`derivedFromId` = source, folder/tags copied,
  original untouched — the PP1 discipline). A video ⇒ an honest
  Bengali 400. The spec proves real dimensions: a real 400×200 PNG
  edited to 1:1 yields a PNG whose sharp metadata reads 200×200.
- **Video cover.** `POST media/:id/cover {atSeconds?}` — when the
  `ffmpegAvailable` seam says no ffmpeg, it refuses with the Bengali
  explanation **and creates no asset row**; when a frame comes back
  it is stored as an image asset derived from the video. Specs pin
  both branches with fakes; the sandbox host does have an ffmpeg
  binary, but no real tenant video was extracted here (see Limits).
- **Web library UI.** Inside the existing library panel: folder chip
  bar (সব / ফোল্ডারহীন / per-folder with counts / + নতুন / per-chip
  delete with the folderless consequence in the title), name + tag
  filters, wider asset cards with tag chips, folder select, tag edit
  (prompt, parsed by the new pure helper), inline usage readout,
  aspect select + crop for images, cover button for videos (an API
  ffmpeg error surfaces verbatim in the page error area), and bulk
  select with a move/delete bar whose failures are listed per item.
  New pure helpers in `apps/web/src/lib/social-media-library.ts`
  (ASPECT_OPTIONS, parse/format tags, buildMediaQuery, bulk summary).

## SU4 — AI Content Engine v2

All in `SocialAiService` (SP3's home), reusing its machinery:
`checkDailyLimit` was generalized to `checkDailyLimit(org, feature)`
(the `social_copy` caller is byte-identical), the LLM still resolves
through `providerForOrg` (the org's own key wins since CC B4), and a
usage record is written ONLY after provider success.

- **Hashtag performance (no LLM — pure data).** `GET
  insights/hashtags` aggregates the org's OWN published posts:
  `extractHashtags` (per-post dedupe, lowercase) and
  `aggregateHashtagPerformance` (sums `engagementScore` from SP7 —
  only fields the platform actually returned; a post with no score
  never feeds the totals) return `{tag, posts, totalEngagement,
  avgEngagement}` plus `postsConsidered`. No scored posts ⇒ an honest
  empty result. The AI panel shows these as clickable suggestion
  chips (click = the existing hashtag selection), with the
  not-enough-data line when empty. **Known quirk, pinned in the
  spec:** the frozen character class `[\p{L}\p{N}_]+` stops a Bengali
  hashtag at a vowel sign (a combining mark is not `\p{L}`), e.g.
  `#অফার` extracts "অফ" — the API and the web display use the same
  extraction, so the two sides stay consistent; widening the class
  is a later deliberate change, not a silent one.
- **Content plan.** `SocialContentPlan` (org, month `YYYY-MM`,
  pillars/items JSON, status) + `POST posts/ai-content-plan`:
  enforcement first, then grounded facts ONLY from the org's real
  ACTIVE products (name, formatted price, compare-at, category,
  stock) and Business Brain fields, plus the caller's focus. **No
  real LLM ⇒ an honest Bengali refuse — no plan row, no usage row**
  (unlike SP3 copy there is no dev-template fallback: a templated
  month plan would be fake AI). Every generated item passes a
  deterministic number guard (exported `extractSocialNumbers` /
  `ungroundedNumbers`, the inbox hallucination-guard pattern with
  Bengali-digit normalization): a caption number must appear in the
  grounded facts — calendar day numbers 1–31 are the one documented
  exception, because an item's `day` is a position in the month, not
  a factual claim. Guard-failed items are dropped and counted in
  `droppedItems`; if ALL items drop, the request 400s with nothing
  saved (the usage row from the successful provider call stands,
  mirroring SP3's zero-variant behaviour). One AIUsageRecord,
  feature `social_content_plan`. Plans are listed/read back via
  `GET content-plans[/:id]`.
- **Materialize.** `POST content-plans/:id/materialize
  {itemIndexes, socialAccountId}` creates REAL draft posts through
  the existing `SocialService.createPost` path only (approval rules
  and validation come free). Per-item results: an index that doesn't
  exist ⇒ failed; an already-materialized item ⇒ skipped (never a
  second draft); a product item with an `imageUrl` goes through the
  real PP3 importer and attaches the imported image — an importer
  failure fails that item with the verbatim error; a product without
  an image URL drafts without media. The plan records
  `materializedPostId` per item and its status moves to
  `partially_materialized` / `materialized`.
- **Reel/Short script.** `POST posts/ai-script {productId?, topic,
  language}` returns `{hook, onScreenText, shotList, captionDraft}`
  — RETURNED ONLY: no SocialPost and no MediaAsset row is created
  (spec-pinned by counting the fake tables), one AIUsageRecord with
  feature `social_script`, the same refusal without a real LLM.
  The web AI panel renders the script and offers "Caption হিসেবে
  ব্যবহার করুন".
- **Injection note.** `SocialAiService` gained three `@Optional()`
  constructor params appended at the end (SocialService,
  SocialImportService, AuditService): every existing 2-arg spec
  construction is untouched, Nest resolves all three in production
  (AuditService is @Global), and audit calls are `this.audit?.log`.

## Gates (coordinator-run on the final tree, 2026-10-13)

- **API jest FULL** (`NODE_OPTIONS=--max-old-space-size=4096`,
  `--runInBand`): 313 suites / 3072 tests — **1 failed suite,
  1 failed test: the known `cx3-debounce` flake** (the batching
  assertion answered about the second product instead of the
  combined batch; pre-existing, root cause still open per the CX
  package notes, untouched by this batch). **Standalone re-run of
  exactly that suite: 18/18 PASS.** No other failure; both numbers
  are recorded, nothing was retried into silence.
  - (Two earlier coordinator attempts are recorded for honesty: a
    default-parallel `npx jest` and a run without the 4096 heap
    option both died with V8 heap OOM on this 2-core/8 GB VM before
    producing results — an environment limit, which is why the
    4096 + runInBand method from the integration-2 gate is the one
    that counts.)
  - New SU specs: `social-su3.spec.ts` (11), `social-su4.spec.ts`
    (15) = **26 tests**; base was 311 suites / 3046 tests, now
    313 / 3072 — the arithmetic matches exactly.
- **Web vitest FULL:** 38 files, **274/274** (263 base + 11 new
  `social-media-library` tests).
- **tsc:** API 0, web 0, admin 0. **Prisma validate:** valid
  (generate also run by the worker).
- **Monorepo build:** all 7 packages Done (`/dashboard/social-posts`
  at 26.2 kB in the web build).
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL 16
  cluster, `prisma migrate deploy` from this tree — **147/147
  applied (146 through Batch 1 + 1 new), 0 unfinished/rolled back,
  194 public tables** (verified in `_prisma_migrations`, not just
  the CLI tail).

## Honest limits

- No live LLM call was made: plan/script generation, the number
  guard and materialize are proven against a stubbed provider at the
  service boundary; a real tenant-key plan generation is an SU0/SU12
  verification item.
- The ffmpeg cover path is seam-proven only (fake available/missing
  + fake frame bytes). ffmpeg 8.1.2 exists on this sandbox host, but
  no real video was decoded here and **production ffmpeg remains
  unverified** (the SU0/SU12 checklist item stands); where ffmpeg is
  absent the feature refuses honestly instead of failing obscurely.
- Cover frames are NOT wired into the Reels/YouTube publishers in
  this batch — the plan's wording ("যেখানে platform API দেয়") keeps
  that for the publishing-depth batch (SU8), where each platform's
  cover support is spike-verified first.
- No screenshot QA of the new library/AI-panel UI (no live app in
  the sandbox); the web gate is vitest + tsc + next build.
- The migration has never run against the production DB — it arrives
  with the next owner-authorized push + Dokploy Redeploy, together
  with the other tracks' pending migrations.
- Hashtag extraction truncates Bengali tags at vowel signs (above) —
  recorded, consistent on both sides, not hidden.
