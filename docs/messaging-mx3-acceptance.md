# Messaging Advanced MB1 / MX3 — Acceptance

Status: DELIVERED in the `ai-marketing-saas-mx` worktree (branch
`messaging-advanced`, on top of MX2 `aa80d044`). **Local commits
only — NOT pushed.** MX3 completes MB1 (MX1 + MX2 + MX3). No live
provider proof — M30 verification is still owed for everything
below.

## MX3 — Transactional vs Marketing Stream Separation (shipped)

- **Schema** (migration `20261019020000_mx3_quiet_hours`,
  hand-written additive SQL, MX1/MX2 style; NOT run on any real
  DB): `MessagingSetting` gains `marketingMaxBroadcastsPerSweep`
  (Int, nullable), `marketingMaxEntriesPerSweep` (Int, nullable),
  `quietHoursEnabled` (Boolean, default false),
  `quietHoursStart` / `quietHoursEnd` (String, nullable "HH:mm").
  No other table is touched — in particular nothing on
  `OrderNotificationSetting` / `OrderNotificationLog` /
  `ShopOtpChallenge`.

- **1 · Marketing concurrency/chunk limits (sweep caps).** What
  the sweep did before MX3: `runDueBroadcasts` fetched up to 10
  due-scheduled broadcasts and up to 10 stale-"sending"
  broadcasts, and processed each for at most
  `BROADCAST_SWEEP_MAX_ENTRIES` (200) entries per run. MX3 makes
  both numbers per-org settings on `MessagingSetting`:
  `marketingMaxBroadcastsPerSweep` is a TOTAL budget for one
  org's sweep run shared by both phases (due phase first, stale
  recovery gets what is left; each phase still fetches at most
  the historical 10), and `marketingMaxEntriesPerSweep` replaces
  the 200 for that org. Null (every pre-MX3 row) reads as the
  platform defaults — budget 20, entries 200 — which reproduce
  the pre-MX3 behaviour exactly. Broadcasts beyond the budget
  are NOT touched: they stay queued for the next run and the
  sweep result counts them honestly in the new `skippedByLimit`
  field. Validation: null or integer 1–50 (broadcasts) / 1–5000
  (entries); anything else is a 400 at the settings write.

- **2 · Quiet hours.** Pure helper `isQuietHoursActive`
  (`apps/api/src/messaging/quiet-hours.ts` — no Prisma, no
  providers): strict "HH:mm" bounds, start inclusive / end
  exclusive, overnight windows (start > end, e.g. 22:00–08:00)
  handled on both sides of midnight, disabled / empty
  (start == end) / invalid inputs never activate. The gate
  lives in ONE place — `MessagingService.processBroadcast`,
  before any chunk is processed and before the WhatsApp sender
  is even built — so sweep sends, manual sends, resume and
  retry-failed all defer identically, on both engines
  (recipient-table and legacy snapshot). While the window is
  active: no provider is called, nothing is written, the
  broadcast keeps its status with every recipient still
  pending, and the result carries `deferred: "quiet_hours"`
  with the honest per-status counts. `runDueBroadcasts`
  short-circuits the same way for the whole run, returning
  `deferred: "quiet_hours"` + `deferredBroadcasts` (how many
  broadcasts were waiting). A broadcast scheduled inside the
  window is simply started by the first sweep after the window
  ends — its `scheduledAt` is untouched (no notBefore field was
  added; the sweep IS the retry mechanism). Settings writes
  validate strictly: real boolean, "HH:mm" format, enabling
  requires both bounds set and different.
  **Timezone decision (from the code):** the org timezone
  ALREADY exists — `Organization.timezone` (String, schema
  default `"Asia/Dhaka"`, `packages/db/prisma/schema.prisma`)
  — so MX3 evaluates the window in `Organization.timezone` and
  adds NO timezone field of its own. The service reads it
  defensively (`getOrgTimezone`): a missing delegate/row/value
  or a zone Intl cannot evaluate falls back to `"Asia/Dhaka"`,
  which is that field's own schema default. The settings view
  returns the timezone actually used, and the web shows it.

- **3 · Transactional exemption — verified, NOT built (proof
  below).** No bypass was needed because no transactional send
  passes through the broadcast engine. The quiet-hours gate and
  the sweep caps exist ONLY in `MessagingService.processBroadcast`
  / `runDueBroadcasts`; the shared low-level providers
  (`email.provider.ts`, `sms.provider.ts`) contain no stream
  logic at all.

- **4 · Unified READ-ONLY transactional view (D4 = combined
  view only).** New endpoint `GET messaging/transactional-overview`
  (read roles, same as the other messaging GETs) →
  `MessagingService.getTransactionalOverview`: the org's
  `OrderNotificationSetting` status — the stored Json merged
  over the ON5 defaults with that module's OWN `mergeConfig`
  (imported from the pure `order-notifications.ts`, so
  "enabled" means exactly what the transactional engine itself
  would use) — as `{ configured, enabledEvents, totalEvents,
  channelsInUse, events[] }`; the latest 20
  `OrderNotificationLog` rows (order ref = the order's
  `externalNumber`, else `externalId`, else the raw `orderId` —
  never invented; plus event/channel/status/error/createdAt);
  and a count summary `{ total, sent, failed }` over ALL the
  org's log rows. Every read is defensive in the MS2 style: a
  missing delegate reads as `setting: null` / `recent: []` /
  counts `null` — never a fabricated 0, never a crash. NO
  writes, NO sender changes, NO changes to the commerce/orders
  modules (the only import from that side is the pure config
  helpers). Web: the messaging page gains the MX3 fields in the
  existing settings form (sweep caps, quiet-hours toggle +
  start/end, the org timezone and a live "quiet hours active
  now" note) and a new read-only card "📦 অর্ডার নোটিফিকেশন
  (Transactional) — শুধু দেখার জন্য" showing the setting
  status, per-event on/off chips, the count summary and the
  recent log, with the scope note: «এটি শুধু দেখার জন্য —
  অর্ডার নোটিফিকেশন সেটিংস তার নিজের জায়গা থেকে বদলায়».

- **5 · Manual-send decision (documented + spec-pinned):** a
  manual `sendBroadcast` inside quiet hours DEFERS, exactly
  like sweep processing — `processBroadcast` is the single
  gate, and MX3 deliberately does not carve out a manual
  exception (a "quiet" window that a button can silently
  override is not quiet). The response is honest about it: the
  returned broadcast carries `deferred: "quiet_hours"`, its
  status stays `sending` with all recipients pending, the
  audit metadata records the deferral, and a later send/sweep
  after the window completes it. Test sends of a single
  template (`testSendTemplate`) are NOT broadcasts and are not
  gated — they are one-off operator diagnostics, unchanged.

## Transactional code-path proof (grep-verified 2026-10-16)

Which code sends transactional mail/SMS, and why the broadcast
engine can never touch it:

- **Order notifications:** `OrderNotificationService.notify`
  (`apps/api/src/order-notifications/order-notifications.service.ts`)
  is the single entry. Its channel loop calls, directly:
  SMS → `ShopAccountService.sendShopSms` (line ~372);
  WhatsApp → `InboxService.sendAutomatedMessage` (line ~389);
  Email → the injected `EmailProvider.send` (line ~421). Its
  module (`order-notifications.module.ts`) imports
  `MessagingModule` **for `EmailProvider` only** (its own header
  comment says so) — `MessagingService` is never injected, and
  `notify` never calls `processBroadcast`, `sendBroadcast` or
  `runDueBroadcasts`. It also never throws (a notification
  failure must never break an order flow).
- **Shop OTP:** `ShopAccountService.requestOtp`
  (`apps/api/src/storefront/shop-account.service.ts`, line ~211)
  sends via its own `sendShopSms` (line ~183), which calls the
  low-level `SmsProvider` (`sendWithGateway` / `send`) directly.
  That file does not inject `MessagingService` either (its only
  mention is a comment citing a defensive-read precedent).
- **The other direction:** inside `apps/api/src/messaging/`, the
  only references to `orderNotificationSetting` /
  `orderNotificationLog` are MX3's read-only overview queries
  (findFirst/findMany/count — no create/update anywhere), and
  `messaging/quiet-hours.ts` is imported ONLY by
  `messaging.service.ts` (and the MX3 spec). The MX3 spec also
  proves it behaviourally: with quiet hours active and the
  broadcast engine deferred (zero provider calls),
  `OrderNotificationService.notify` still sends (SMS confirmed
  via a fake `ShopAccountService`) and writes its `sent` log
  row. The low-level providers being SHARED (EmailProvider /
  SmsProvider) is expected and safe: the stream logic lives in
  the broadcast engine/sweep layer above them, never inside
  them.

## Gate (MX3 item only, run serially)

| Gate | Result |
|---|---|
| Baseline messaging jest (pre-MX3, MX2 state) | 14 suites / 249 tests, all pass |
| Final messaging jest (`npx jest src/messaging`) | **15 suites / 267 tests, all pass** (+1 suite, +18 MX3 tests; zero regressions) |
| Neighbour spot-checks (not required, run for safety) | order-notifications + automation: 15 suites / 101 tests, all pass |
| API tsc (`npx tsc --noEmit` in apps/api) | clean |
| Web tsc (`npx tsc --noEmit` in apps/web) | clean |
| Web vitest | no test file covers the messaging page; a sample lib run green (17/17). Full web vitest is a batch-end coordinator gate. |
| Prisma validate | valid (run with a dummy DATABASE_URL, which this sandbox requires) |

Note: jest was run with `--cacheDirectory ~/workspace/.jest-cache`
because this sandbox's /tmp tmpfs filled up mid-run (ENOSPC in
the transform cache) — an environment limit, not a code issue.

Full repo jest / production build were NOT run (coordinator
runs full gates at batch end), per the MX3 brief.

## MX3 spec coverage (`mx3-streams.spec.ts`, 18 tests)

Pure helper: HH:mm validation; `localMinutesOfDay` in-zone vs
UTC vs invalid zone; overnight window active on both sides of
midnight and inactive midday; boundary minutes (start inclusive
22:00, 07:59 in, end exclusive 08:00); normal window; disabled,
empty-window, missing-bound and wrong-timezone cases never
activate. Engine (fixture clock via jest fake timers, Dhaka
23:30 inside 22:00–08:00): recipient-table broadcast defers on
manual send (zero provider calls, zero deliveries, rows stay
pending, `deferred` in the response) and sends after the
window; legacy snapshot broadcast defers with honest counts;
sweep defers the whole run (`deferredBroadcasts` = due + stale)
and the next sweep after the window starts + recovers both;
disabled setting never defers. Caps: broadcast budget 2 over 3
due broadcasts (`started` 2, `skippedByLimit` 1, remainder sent
next run); entries cap 2 over 3 recipients (first run processes
2, next run finishes exactly the remaining one, no re-sends);
unset caps read as the platform defaults (20 / 200) in the
settings view. Settings: bad HH:mm, enable-without-both-bounds,
empty window and out-of-range caps all rejected; PATCH → GET
round-trip incl. null clearing a cap; the pre-MX3
`getMessagingSetting` shape is byte-unchanged. Overview:
aggregation shape from fake prisma (logs with order refs,
override-aware setting status, count summary), honest empty
state (no row ⇒ `configured: false` with defaults shown, zero
counts), missing tables ⇒ null/empty/null. Exemption:
`OrderNotificationService.notify` sends + logs while the
broadcast engine is deferred in the same fixture.

## Honest limits / NOT BUILT

- **Migration NOT run on any real DB; nothing live-proven**
  (M30 owed). Fresh-Postgres union proof is a batch-end
  coordinator gate, not run here.
- **Recipient-local quiet hours are NOT built:** the MX plan
  mentioned "প্রাপকের স্থানীয় সময় যেখানে জানা আছে" — no
  recipient timezone exists anywhere in the schema (customers/
  leads carry no timezone field), so the window is the ORG's
  timezone only. Nothing was invented to fill that gap.
- **No priority queue was built** (the plan's MX3 headline
  metaphor): the separation is achieved structurally — the
  transactional paths never shared the broadcast engine, so a
  marketing send cannot block them; MX3 adds the marketing-side
  brakes (caps + quiet hours) and proves the separation rather
  than building a queue nothing was queued on.
- **Channel-wise throttle (per-channel rates) is NOT built:**
  the MX3 brief scoped throttling to the per-org sweep
  caps + `BROADCAST_CHUNK_DELAY_MS` chunk pacing (unchanged,
  still read per process run); per-channel send-rate limits
  remain an MX15-era governance topic.
- Observed pre-existing behaviour (not changed by MX3): a
  partially processed due SNAPSHOT broadcast keeps its
  `scheduled` status (the legacy engine writes a status only
  at finalize/pause/cancel), so the next sweep continues it
  through the due phase — the MX3 entries-cap spec pins this.
- The transactional overview caps `recent` at the latest 20
  log rows by design; the count summary covers all rows.
  There is deliberately NO write path from Messaging to order
  notification settings (D4).
- MB1 is now code-complete (MX1 + MX2 + MX3). Integration,
  push and deploy remain owner-gated, as always.
