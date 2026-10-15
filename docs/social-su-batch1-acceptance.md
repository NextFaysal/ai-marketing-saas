# Social Posts Update — Batch 1 Acceptance (SU1 + SU2)

**Status:** Delivered (local commits on `su-package`, base integration-2
`21dec09` + plan commit `263cc1a`; NOTHING pushed). Plan:
`docs/social-posts-update-plan.md`, Batch 1. Evidence ceiling, stated
plainly up front: **no live platform call was or could be made** (no real
Meta/TikTok/Google app or tenant account in the sandbox) — everything
below is proven at the stubbed-Graph boundary + fake-Prisma specs, the
package's standing discipline. SU0 live verification remains the owner's.

## Migration

One hand-written additive migration:
`20261013400000_su1_su2_composer_queue` — new tables `SocialPostGroup`,
`SocialPostingSlot`; `SocialPost` gains `postGroupId` (FK, SetNull),
`firstCommentText/Status/Error/Id`, `seriesId`, `recurrenceFrequency`,
`recurrenceInterval`, `isEvergreen`, `evergreenMinGapDays`,
`evergreenMaxCycles`, `evergreenCyclesUsed`, `evergreenLastRecycledAt`;
3 indexes, 4 FKs. The SU range starts at 20261013400000 exactly as the
plan reserved — the adv worktree held nothing past `20261013300000_cp_completion`
at claim time (verified before the first migration was written).
Fresh-Postgres sequence: **146/146 applied, 0 rolled back, 192 public
tables** (details under Gates).

## SU1 — Composer v2

- **Post group + per-platform variants.** `SocialPostGroup` (org, name,
  createdById) + nullable `SocialPost.postGroupId` — every pre-SU post is
  `null` and behaves exactly as before. `POST posts/group` validates ALL
  variants first (accounts org-scoped, captions non-empty, media refs
  real), then creates the group and one post row per variant, each with
  its own caption/link/media/firstComment; a failing variant cleans up
  what was created and rethrows. `GET groups`, `GET groups/:id` return
  the group with its serialized variant posts. Single-account creation
  keeps the old `POST posts` path (now also accepting
  `firstCommentText`, `recurrenceFrequency`, `recurrenceInterval`).
- **First comment.** Stored on the post (`firstCommentText`, status
  `pending|posted|failed`, `firstCommentError` verbatim, `firstCommentId`).
  After a Meta publish succeeds (`platformPostId` in hand) the finalize
  step posts it via `MetaSocialPublisher.postFirstComment` — FB Page:
  `POST /{post-id}/comments`, IG: `POST /{media-id}/comments`. A failure
  NEVER unpublishes the post: it stays `published` with
  `firstCommentStatus="failed"` and the platform's verbatim error, plus
  audit rows `social.first_comment_posted` / `social.first_comment_failed`.
  TikTok/YouTube posts never attempt it, and the composer only shows the
  field when a meta_page/instagram account is selected (with the honest
  note). `sent_to_creator` outcomes skip it by construction.
- **Pre-flight validation.** Pure `validateForPlatform`
  (`social-preflight.ts`): TikTok/YouTube keep the exact SP8 video-only
  message; IG reuses the SP6 zero-media and PP4 >10 messages verbatim,
  adds a 2200-char caption rule; YouTube checks the title (first
  non-empty caption line) ≤100 and caption ≤5000; FB reuses the SP6
  mixed-video message verbatim and allows text-only. Enforced in
  `schedulePost` (Bengali 400, never reaches the worker), in `publishNow`'s
  service path, and inside `publishToPlatform` as a
  `PermanentPublishError` for posts scheduled before the rules existed.
- **Platform preview.** Pure web helper `buildPlatformPreview`
  (`apps/web/src/lib/social-composer.ts`, 21 vitest): per-platform frame
  data — FB full caption, IG 2200-truncated, YouTube title/description
  split — media summary and the same warning matrix as the API
  pre-flight, all Bengali. The composer renders one preview card per
  selected account; no API call is involved.
- **Clone.** `POST posts/:id/clone` works from ANY status: new draft
  copying caption/link/media/firstComment (status back to `pending`),
  evergreen config copied with counters reset, recurrence deliberately
  NOT copied (a clone must never fork a series chain). A grouped source
  gets a NEW group containing only the clone. Approval follows the
  createPost rule (setting on + approver author ⇒ auto-approved, else
  null). Web: clone button on list/calendar/queue views.

## SU2 — Queue, Recurring, Evergreen

- **Posting slots.** `SocialPostingSlot` CRUD (weekday 0–6, `HH:mm`
  24h-validated, duplicate account+weekday+time ⇒ Conflict, foreign
  account ⇒ 404). `POST posts/:id/add-to-queue` computes the next free
  slot in the ORG timezone via the pure `computeNextSlot`
  (`social-queue-helpers.ts`: Intl-derived tz offset, 370-day scan,
  same-minute occupied instants skipped, disabled slots ignored), then
  delegates to the existing `schedulePost` — so the approval gate and
  pre-flight apply identically. No slots for the account ⇒ an honest
  Bengali 400 saying to add a slot first. Web: slot panel (add/toggle/
  delete, Bengali weekday labels) + "Queue-তে যোগ করুন" on drafts.
- **Recurring series.** `seriesId` + `recurrenceFrequency`
  (daily|weekly|monthly) + `recurrenceInterval` (1–12) on the post; the
  series id is minted at creation when a frequency is set. The chain
  lives at the ONE finalize point (`attemptPublish` success, both the
  manual and worker paths): exactly one next instance is created with
  `scheduledAt = previous scheduledAt + interval` (pure `addInterval`;
  monthly clamps the day, Jan 31 → Feb 28 — spec-proven), **no drift**
  from publish time, and idempotent — an existing
  (seriesId, scheduledAt) row means no duplicate. The fresh source row
  is re-read first: if it is no longer published/sent or its recurrence
  was cleared, the chain stops (a cancelled source ends the series).
  The next instance copies content + firstComment (pending again) and,
  when the source was approved, its approval — a recurring series the
  owner approved does not silently stall on the approval gate.
- **Evergreen.** `setEvergreen` works on any post (draft or published).
  New automation job **`social_evergreen_sweep`** (JOB_TYPES + template,
  org target, 1440 min, description states it never publishes by
  itself): a published evergreen post whose `publishedAt +
  evergreenMinGapDays` has passed and whose cycles remain spawns exactly
  ONE **draft** clone — claimed by a conditional `updateMany`
  (`evergreenLastRecycledAt: null` + exact `cyclesUsed`), which is what
  makes repeat sweeps idempotent. The clone carries the evergreen config
  with the consumed cycle count, so the chain continues only when a
  human schedules and publishes it; deleting the draft spends the cycle
  (documented behaviour, not a silent loss — the source records the
  increment and the recycle audit). OWNER/ADMIN members get an
  AgentNotification (`social_evergreen_recycled`); notification failure
  never changes the outcome. Web: evergreen badge with cycle counts +
  gap/max editor on draft and published cards.
- **Best-time one-click.** `POST posts/:id/schedule-best-time` reuses
  SP7's `computeBestTime` over the org's published posts with insights.
  Below the evidence threshold it refuses with a Bengali 400 **stating
  how many scored posts exist** (e.g. "এখন আছে Xটি"); otherwise it
  schedules at the next occurrence of that weekday+hour in the org
  timezone (pure `computeNextBestTime`) via the same `schedulePost`
  delegate. Web: the button renders only when the insights summary has
  a `bestTime`.

## Design decisions taken inside scope

1. **AutomationService injection position:** `SocialQueueService` was
   appended as the LAST constructor parameter (not beside
   `socialPublish`): many existing specs construct the service
   positionally, and a mid-list insert would silently shift every later
   argument. Nest injects by type, so DI is unaffected; the reason is
   commented in the code.
2. **Pure helpers split** (`social-queue-helpers.ts`) so the publish
   service can use `addInterval` without importing the queue service
   (which itself depends on `SocialService`) — no import cycle.
3. `videoOnlyViolation` moved to `social-preflight.ts` and is
   re-exported from `social.service.ts`, so every existing import keeps
   working byte-identically.
4. Group creation validates before it writes and cleans up on failure
   instead of using a transaction — the codebase's services do not use
   interactive transactions, and validate-first makes the failure path
   unreachable for every checked rule.

## Gates (coordinator-run on the final tree, 2026-10-13)

- **API jest FULL:** 311 suites / 3046 tests. First run: 308/311 suites,
  3042/3046 tests — the 3 failed suites (cx3-debounce, u4-channels,
  social-pp2) were ALL 5-second test/hook **timeouts** while two other
  worktrees' full suites ran concurrently on this VM (u4 took 154s in
  that run vs ~7s normally). **Standalone re-run of exactly those 3
  suites: 3/3 suites, 36/36 tests PASS (21.5s).** cx3-debounce is the
  previously known flake; it passed standalone here too. No failure was
  hidden or retried into silence — the re-run result stands alongside
  the first run's numbers.
- New SU specs: `social-su1.spec.ts` (12), `social-su1-publish.spec.ts`
  (8, real `MetaSocialPublisher` over stub fetch — graph paths proven),
  `social-su2.spec.ts` (16) = **36 tests, all passing**; existing social
  suites 289/289 in the worker's regression run, included in the full
  run above.
- **Web vitest FULL:** 37 files, **263/263** (242 base + 21 new
  `social-composer` tests).
- **tsc:** API 0, web 0, admin 0. **Prisma validate:** valid.
- **Monorepo build:** all 7 packages Done (ui, contracts, db, api,
  worker, admin, web). The web build's first attempt stalled in static
  generation under the same parallel load; a clean re-run compiled in
  19.5s with `/dashboard/social-posts` at 22 kB.
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL 16.4
  cluster, `prisma migrate deploy` from this tree — **146/146 applied
  (145 base + 1 SU), 0 unfinished/rolled back, 192 public tables**
  (verified in `_prisma_migrations`, not just the CLI tail).

## Honest limits

- No live Meta/TikTok/Google call was made; first-comment graph paths,
  recurrence chaining and the evergreen sweep are boundary/spec-proven
  only. A real first comment and a real recurring publish are SU0/SU12
  verification items.
- No screenshot QA of the new composer UI (no live app in the sandbox);
  the web gate is vitest + tsc + next build.
- The migration has never run against the production DB — it arrives
  with the next owner-authorized push + Dokploy Redeploy, together with
  the other tracks' pending migrations.
- `social_evergreen_sweep` only fires for orgs that install the job
  template (the standing per-org job discipline); nothing runs it
  implicitly.
