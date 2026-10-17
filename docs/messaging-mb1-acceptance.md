# Messaging Advanced MB1 (MX1 + MX2 + MX3) — Batch Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `4ac7f23c` (tree identical to
GitHub main `17a2c27`, 211 migrations). **Local commits only —
nothing has been pushed.** No live provider proof anywhere in this
batch (M30 still owed); the three MX migrations have NOT been run
on any real DB.

Per-item detail: [messaging-mx1-acceptance.md](messaging-mx1-acceptance.md) ·
[messaging-mx2-acceptance.md](messaging-mx2-acceptance.md) ·
[messaging-mx3-acceptance.md](messaging-mx3-acceptance.md)

## Commits (10, one+ per item)

| Item | Commits |
|---|---|
| MX1 | `e355d982` schema + migration · `7acd2584` engine + specs + acceptance |
| MX2 | `6532bc4e` cascade core + schema · `02ac4549` engine · `b7b425c2` web · `aa80d044` specs + acceptance |
| MX3 | `3ea1eba3` core · `d87f4612` specs · `9dbba5b5` web · `bfffdead` acceptance |

## MX1 — Recipient Table & Scale Engine v2 (migration `20261019000000_mx1_broadcast_recipients`)

- New `BroadcastRecipient` table is the primary recipient store for
  NEW broadcasts (orgId, broadcast FK, identity, address stamped at
  send time, status/attempts/error/providerMessageId, sortIndex;
  `@@unique([broadcastId, dedupeKey])`, dedupe key =
  `${recipientType}:${recipientId}`).
- Streaming resolver: cursor-paged chunked resolution feeding
  chunked `createMany` writes (write chunk 500); the whole audience
  is never held as one Json blob. MS2/CX10 exclusion stages apply
  identically (preview ≡ prepare set, spec-proven).
- Plan cap stays a POLICY refusal enforced before any row is
  written (message byte-identical, caps unchanged); the Json
  snapshot size is no longer the ceiling. New broadcasts stamp NO
  snapshot (`recipientSnapshot` stays null); counters are derived
  from recipient rows per chunk.
- Resume picks up only `pending` rows — a confirmed-sent recipient
  is never re-sent (spec: provider called exactly once per
  recipient across interruption + sweep recovery). Pause/cancel/
  retry-failed operate on rows. Specs: 15 tests incl. a
  3,000-recipient chunked scale run.
- Dual path: legacy snapshot-only broadcasts run the pre-MX1 engine
  unchanged; a stuck `sending` row with neither rows nor snapshot
  refuses with the historical message (a pre-MX1 engine quirk that
  finalized such rows as phantom-failed was corrected to the
  refusal the task requires — recorded in the MX1 acceptance).

## MX2 — Smart Channel Routing & Fallback Cascade (migration `20261019010000_mx2_cascade`)

- `Broadcast.cascadeConfig`/`cascadeReport` (Json); every cascade
  attempt is its own `MessageDelivery` row linked by
  `recipientRowId` + `attemptIndex` + `cascadeGroupId` (= recipient
  row id). Recipient final status = sent iff any channel confirmed.
- SMS failover, honestly extended: pre-MX2 the schema allowed ONE
  tenant SMS config (`organizationId @unique`); additional gateways
  now live in `MessagingSmsGatewayConfig` (sealed secrets, priority,
  OWNER/ADMIN CRUD) with `MessagingSenderConfig.smsPriority` for the
  primary. Circuit breaker: 5 consecutive failures per gateway per
  run trips it for the rest of the run; trips are persisted in
  `cascadeReport.breakerEvents` and shown in the report + web.
- Preferred channel: pure `preferredChannel()` in `cascade.ts`
  (engagement = opened/read/delivered/link-click over confirmed
  deliveries; ties → org order; no history → org order), applied
  only when the org enables smart routing on the broadcast.
- Cheapest-first BUILT on real org-entered rates
  (`smsCostPerPartMinor`, `whatsappCostPerMessageMinor`,
  `emailCostPerMessageMinor` on MessagingSenderConfig); any missing
  rate → org order kept + `ratesMissing`/`ratesNote` in the report.
  No price is ever invented.
- Suppression/frequency checks remain resolve-time only (a
  suppressed recipient has no row → zero attempts on every
  channel); WhatsApp attempts only via approved templates;
  channels without configured content are skipped once,
  broadcast-wide, with the reason in `cascadeReport.skippedChannels`.
- Web: composer cascade section + report per-channel attempt
  breakdown (in the single `page.tsx` this tree actually has).
- Specs: 17 tests.

## MX3 — Transactional vs Marketing Stream Separation (migration `20261019020000_mx3_quiet_hours`)

- Per-org sweep caps on MessagingSetting:
  `marketingMaxBroadcastsPerSweep` (total per-run budget, due phase
  first) + `marketingMaxEntriesPerSweep`; null = platform defaults
  (20/200) = pre-MX3 behaviour exactly. Excess broadcasts stay
  untouched; sweep returns a `skippedByLimit` count.
- Quiet hours on MessagingSetting (enabled/start/end), evaluated
  in the ORG timezone — `Organization.timezone` already existed
  (schema default `Asia/Dhaka`), so no new timezone field was
  invented. Pure helper `quiet-hours.ts` (overnight windows,
  start-inclusive/end-exclusive). The single gate is
  `processBroadcast`: sweep, manual send, resume and retry ALL
  defer inside the window (zero provider calls, nothing written,
  honest `deferred: "quiet_hours"` in the result; sweep counts
  `deferredBroadcasts`). Scheduled times are untouched — the next
  sweep after the window sends. Template test-sends are outside
  the gate (not broadcasts).
- Transactional exemption PROVEN, not built: OrderNotification
  (`apps/api/src/order-notifications/order-notifications.service.ts`)
  sends via ShopAccountService/InboxService/EmailProvider directly
  and never injects MessagingService; Shop OTP goes through
  ShopAccountService → SmsProvider directly. Quiet-hours logic
  lives only in the broadcast engine layer. A spec proves a
  transactional notify still sends while a broadcast defers.
  Transactional send code: zero lines touched.
- Unified READ-ONLY view (D4 as decided): `GET
  messaging/transactional-overview` — setting status (via ON5's own
  mergeConfig), latest 20 OrderNotificationLog entries, count
  summary; missing tables degrade to null/[]/null, never a
  fabricated 0. Web settings tab gains the caps/quiet-hours fields
  and a view-only transactional card with the Bengali scope note.
- Specs: 18 tests.

## Gates (coordinator-run, serial — recorded as each finished)

- **API jest (full): 483 suites / 5,430 tests — 5,429 passed, 1
  failed.** The single failure is
  `connections/cc26-payout-automation.spec.ts` (1 test) — the known
  pre-existing payout-sweep failure, adjudicated on the untouched
  base during the GC-stack release (reproduced identically there);
  MB1 touches no connections code. Run method, recorded honestly:
  two monolithic attempts died to environment causes unrelated to
  the code (default-heap OOM at 2 GB; runtime restarts killing the
  session), and a third exposed the root environmental cause —
  `/tmp` is a 512 MB tmpfs that filled up (ENOSPC in jest's
  transform cache), the same failure the MX3 builder hit. The
  recorded full run therefore executed every suite exactly once,
  grouped by top-level `src/` directory (58 groups), serially
  (`--runInBand`) with the jest cache on the workspace disk; group
  summaries were summed (baseline at base `4ac7f23c` per the GC
  release note: 479 suites / 5,361 tests with the same single
  cc26 failure). Messaging inside the full run: 15/15 suites.
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web vitest: 82 files / 703 tests, all pass** (same count as
  the base tree — MB1 added no web test files; the messaging page
  has no dedicated web spec, as in MS/MX2/MX3 item runs).
- **Web tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Next build (apps/web): green** — log shows `✓ Compiled
  successfully in 64s`, static pages 93/93, full route table
  printed incl. `/dashboard/messaging` at 31.5 kB, zero compile
  failures. (The wrapping exec session was killed by a runtime
  restart after the build had finished writing its log; the log
  itself is complete through the final route legend, which Next
  prints only at the end of a successful build.)
- **Prisma validate: valid.** Migration folders on this tree:
  **214** (211 base + MX1/MX2/MX3), as expected.
- **Fresh-Postgres migrate deploy: 214/214 migrations applied
  cleanly** (`All migrations have been successfully applied.`) on
  a newly created empty database; 317 public tables afterwards;
  `BroadcastRecipient` and `MessagingSmsGatewayConfig` present;
  `_prisma_migrations` records all three MX migrations
  (`20261019000000_mx1_broadcast_recipients`,
  `20261019010000_mx2_cascade`, `20261019020000_mx3_quiet_hours`).

**Batch gate verdict: GREEN** — the only failing test in the
entire suite is the pre-existing, base-adjudicated cc26
payout-sweep failure, which predates MB1 and is untouched by it.

## NOT BUILT / honest limits (batch-wide)

- Cascade is scoped to recipient-table broadcasts; legacy snapshot
  broadcasts cannot carry a cascade config (the field postdates
  them) and their engine is byte-identical. Every broadcast created
  after the MX1 migration is recipient-table, so every
  configurable broadcast is covered.
- Audience resolution stays primary-channel (shared MX1 resolver
  contract): a recipient lacking the PRIMARY channel's address is
  excluded at resolve even if a fallback channel could reach them.
- Recipient-local quiet hours NOT built — no recipient timezone
  exists in the schema; the org timezone is the only basis.
- No priority queue was built: the transactional/marketing
  separation was already structural; MX3 added marketing-side
  brakes + the proof, not a queue.
- Per-channel throttle NOT built (sweep caps + the existing
  `BROADCAST_CHUNK_DELAY_MS` only).
- Segment (RFM) and CSV audience sources are inherently
  materialized sets; they are sliced at the same chunk sizes
  rather than cursor-streamed. WhatsApp on the recipient-table
  path shares the run-scoped sender seam (email path spec-proven;
  legacy WhatsApp specs green; no MX1-specific WhatsApp spec).
- Cascade WhatsApp reuses the broadcast's `templateParams`;
  per-cascade-channel template params are not separately
  configurable. The report funnel's delivered/read/opened stages
  keep primary-channel semantics; per-channel outcomes live in
  the new `cascade` report section.
- All three MX migrations are proven only by the fresh-Postgres
  union run in the Gates section; none has run on a real DB, and
  nothing in MB1 has any live provider proof (M30 owed). Deploy
  additionally needs the per-org `broadcast_send_sweep` job
  enabled, as before.
