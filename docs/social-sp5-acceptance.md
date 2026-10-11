# SP5 — Scheduling + Publish Worker — Acceptance

Scope: post scheduling (schedule / cancel-schedule / publish-now),
the publish worker with claim + retry/backoff + stale-claim
recovery, failure notifications, and the `social_publish_due`
automation job. Plan: `docs/social-posts-package-plan.md` (SP5).
Everything below is LOCAL ONLY — nothing was committed or pushed
by this batch; the coordinator reviews the working tree.

## What was built

### Schema
- `SocialPost.attempts Int @default(0)` — publish attempts used in
  the current scheduled run; migration
  `20261010940000_sp5_post_attempts`. `serializePost` now returns
  `attempts` (defaulting to 0 for pre-SP5 rows).

### Scheduling (`SocialService`)
- `POST organizations/:org/social/posts/:id/schedule`
  (`ScheduleSocialPostDto { scheduledAt }`, ISO 8601; WRITE_ROLES).
  Semantic validation lives in the service with Bengali errors:
  unparseable → 400 "সঠিক তারিখ ও সময় দিন।"; more than 5 minutes
  in the past → 400 "শিডিউলের সময় অতীতে হতে পারবে না —
  ভবিষ্যতের সময় দিন।" The 5-minute grace absorbs client clock
  skew — a time inside the grace is accepted and the worker simply
  finds the post due.
- `POST .../posts/:id/cancel-schedule` (WRITE_ROLES): only from
  `scheduled`, back to `draft` with `scheduledAt: null`.
- Audits: `social.post_scheduled` (metadata `scheduledAt`,
  `fromStatus`), `social.post_schedule_cancelled`.

### State machine

| Action | From | To | Notes |
|---|---|---|---|
| schedule | draft | scheduled | — |
| schedule | scheduled | scheduled | re-schedule (new time) |
| schedule | failed | scheduled | **attempts reset to 0; the last error is KEPT** — it stays visible until the next publish attempt replaces it, so the tenant can see why it failed while choosing when to retry |
| schedule | publishing / published / cancelled / sent_to_creator | — | 409 "এই অবস্থায় পোস্টটি শিডিউল করা যাবে না" (current status named) |
| cancel-schedule | scheduled | draft | `scheduledAt` cleared |
| cancel-schedule | anything else | — | 409 "শুধু শিডিউল করা পোস্টের শিডিউল বাতিল করা যায়।" |
| publish-now | draft / scheduled | publishing → (publish path) | claim, then the one publish path |
| publish-now | anything else | — | 409, platform never called |

### Publish worker (`SocialPublishService`) — one publish path
Both `publishNow` and the scheduled scan funnel into the single
private `attemptPublish()`; there is no second publish code path.

- **Claim design:** claiming is a status-conditioned
  `updateMany` (`draft|scheduled → publishing` for publish-now,
  `scheduled → publishing` in the scan). Two concurrent attempts
  can never both publish the same post — the loser sees `count: 0`
  (publish-now: 409 "পোস্টটি অন্য একটি প্রক্রিয়ায় প্রকাশ হচ্ছে";
  scan: silently skipped).
- **Stale-claim recovery:** a post still `publishing` with
  `updatedAt` older than 15 minutes (`STALE_CLAIM_MS`) is treated
  as an abandoned claim (the process died mid-publish). The scan
  returns it to `scheduled` for immediate retry with the honest
  error note "আগের Publish প্রচেষ্টা মাঝপথে থেমে গিয়েছিল —
  পোস্টটি আবার শিডিউল করা হয়েছে।" Attempts are NOT incremented —
  that attempt never completed. A fresh claim is never touched.
- **Honest at-least-once note:** a crash AFTER the platform call
  but BEFORE the result is recorded can re-publish the post on
  recovery. No platform idempotency key exists for Page posts, so
  the window is kept small (claim → publish → record, nothing in
  between) rather than eliminated. This is at-least-once delivery,
  stated plainly.
- **Outcomes:** success → `published` (+ `publishedAt`,
  `platformPostId`, `platformUrl`, error cleared). Transient
  error → attempts + 1 and back to `scheduled` with backoff:
  after failure #1 → **5 minutes**, after #2 → **30 minutes**
  (`BACKOFF_MINUTES = [5, 30]`); the error stays visible on the
  post. At `MAX_PUBLISH_ATTEMPTS = 3` → `failed` + notification.
  `PermanentPublishError` (exported for SP6's adapters — content
  problems that can never succeed) → `failed` immediately with
  attempts UNCHANGED.
- **Due scan** (`runDuePublishes`): stale recovery first, then due
  posts (`status scheduled`, `scheduledAt <= now`) claimed in
  `scheduledAt` ascending order, batch cap `DUE_BATCH = 20` per org
  per run. Returns `{ recovered, due, published, rescheduled,
  failed }` counts, which the automation run wrapper records as
  the job's AutomationRun result — health visibility needs no
  extra wiring.
- **Failure notification:** on terminal failure, ACTIVE
  OWNER/ADMIN members get an `AgentNotification` of type
  `social_post_failed` (ads pattern: per-recipient
  `.catch(() => undefined)`, whole fan-out failure-isolated, never
  throws). Title names the account; body carries the caption
  excerpt (first 120 chars), the verbatim error, and the recovery
  hint (fix and re-schedule/re-publish; reconnect the account if
  the token expired).

### `publishToPlatform` — SP5 stub
In THIS step `publishToPlatform` is a stub that throws
`Error("Publishing adapter unavailable in this build")`. The real
Meta Page / Instagram dispatch lands in SP6 of the same batch,
wired into this same method. Until then a due post's attempt
records that honest adapter-unavailable error and follows the
normal retry path — it is never claimed published. The method is
public so specs replace it per-instance.

### Job registration
- `JOB_TYPES` += `social_publish_due`; `JOB_TEMPLATES` += the
  `social_publish_due` template (org target, 5-minute interval,
  Bengali description covering retry cap + notification).
- `AutomationService.executeJob` case `social_publish_due` →
  `socialPublish.runDuePublishes(orgId)`; the service is the
  constructor's LAST parameter (`@Optional()`, 16th), so every
  existing positional construction in specs is untouched.
  `AutomationModule` imports `SocialModule` (which imports only
  `AiModule` — no cycle); `SocialModule` exports
  `SocialPublishService`.
- Automations page: the org job-type list gains "Social Post
  Publish (শিডিউল করা পোস্ট সময়মতো প্রকাশ — ৫ মিনিট অন্তর
  চালান)" alongside `ad_spend_watchdog`, and the template gallery
  picks the server template up automatically.
- Routes: `POST posts/:id/schedule`,
  `POST posts/:id/cancel-schedule`, `POST posts/:id/publish-now`
  — all WRITE_ROLES (OWNER / ADMIN / MARKETING_MANAGER) under the
  existing `social` permission area.

### Organization timezone decision
**`Organization.timezone` (stored, default `"Asia/Dhaka"`) is the
organization's timezone.** The server stores UTC only:
`scheduledAt` is an absolute instant end-to-end. The WEB converts
the tenant's wall-clock choice to UTC client-side before sending,
and displays stored instants converted back into the org
timezone. No server-side wall-clock interpretation exists, so a
schedule means the same instant regardless of where the API runs.

## Evidence ceiling (plainly)
- Specs + full suite + typecheck only: scoped jest (social SP1 +
  SP5 specs, automation a4) green; full API jest green; API
  `tsc -p tsconfig.build.json --noEmit` green.
- The sandbox has NO Postgres: the SP5 migration is UNAPPLIED
  locally — it applies via `migrate deploy` on the owner's server.
- NO live publish is claimed: `publishToPlatform` is the stub
  above; real-platform proof awaits SP6's adapters and the owner's
  Meta app/accounts (M30 pattern).
