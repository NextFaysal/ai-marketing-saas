# Messaging Advanced MB1 / MX1 — Acceptance

Status: DELIVERED in the `ai-marketing-saas-mx` worktree (branch
`messaging-advanced`, base `4ac7f23c`). **Local commits only — NOT
pushed.** MX2/MX3 were NOT started. No live provider proof — M30
verification is still owed for everything below.

## MX1 — Recipient Table & Scale Engine v2 (shipped)

- **Schema** (migration `20261019000000_mx1_broadcast_recipients`,
  hand-written additive SQL, MS-migration style; NOT run on any
  real DB):
  - New `BroadcastRecipient` table/model — the primary recipient
    store for NEW broadcasts: `organizationId`, `broadcastId`
    (FK, cascade delete), `recipientType`, `recipientId`
    (SnapshotEntry.id semantics: entity id, or the normalized
    address for csv), `dedupeKey`, `name`, `email`, `phone`,
    `address` (channel address actually used, stamped at send
    time), `vars` (MS5 per-recipient personalization Json),
    `status` pending|sent|failed|skipped, `attempts`, `error`,
    `providerMessageId`, `sortIndex` (resolver order).
  - `@@unique([broadcastId, dedupeKey])` with
    `dedupeKey = ${recipientType}:${recipientId}` — the same
    recipient can never be written twice per broadcast, even
    when audience sources overlap. Indexes:
    `(broadcastId, status, sortIndex)` for chunk reads,
    `(broadcastId, sortIndex)`, `(organizationId, broadcastId)`.
  - `Broadcast.skippedCount` (additive, default 0) — the
    recipient-table path's derived skipped counter.
    `Broadcast.recipientSnapshot` is NOT touched and stays
    readable for legacy rows.
- **Snapshot choice (documented decision):** NEW broadcasts
  stamp **no snapshot at all** (`recipientSnapshot` stays NULL);
  the recipient rows are the only materialization. The progress
  the web displays derives from the broadcast counters, which
  the engine re-derives from the rows after every chunk —
  no web change was needed (counter shape unchanged;
  `broadcastProgress`'s counter fallback now also reads
  `skippedCount`, which reads 0 on every pre-MX1 row).
- **Streaming resolver:** `resolveBroadcastRecipients` (the ONE
  shared resolver for preview + prepare) is now built on a
  chunked form — the exclusion stages (previous recipients,
  recent-days, suppression, unsubscribed-column opt-out,
  frequency cap, WhatsApp opt-in; MS2/CX10) are built once and
  applied per recipient in the original order with the original
  stage counts, and recipients stream through in chunks; the
  base resolver (`resolveAudienceInChunks`,
  `resolveCustomAudienceInChunks`, `scanInChunks`) pages the DB
  scans (cursor, `AUDIENCE_SCAN_CHUNK`) and emits bounded slices
  without accumulating the audience. Segment (computeRfm) and
  csv (hard cap 5000 by design) sources are inherently
  materialized sets and are sliced in the same chunk sizes.
- **Prepare (table form):** kill-switch + plan cap are read
  BEFORE any row is written (policy, not a storage ceiling —
  cap values unchanged, refusal messages byte-identical). The
  A/B hash split applies per recipient. Recipients are written
  via `createMany` chunks of `BROADCAST_RECIPIENT_WRITE_CHUNK`
  (500, caller may lower it), deduped by dedupeKey; MS5 vars are
  built per chunk. If the streamed total passes the cap, the
  rest are only counted (the refusal names the true total), the
  written rows are deleted again, and the refusal leaves no
  partial recipient set. Empty-after-exclusions refuses with
  the exact pre-MX1 message, nothing written.
- **Process (table form):** pending rows are read in sortIndex
  order in chunks of `BROADCAST_CHUNK_SIZE` (or the caller's
  chunkSize); each outcome persists to its row immediately; the
  broadcast row is re-read between chunks (pause stops leaving
  the rest pending, cancel marks the rest skipped
  "cancelled"); counters (`totalRecipients`, `sentCount`,
  `failedCount`, `skippedCount`) are re-derived from the rows
  per chunk, so they can never exceed recorded deliveries. The
  WhatsApp run-scoped sender, suppression guard, recurrence
  chaining on finalize and the MS1 final-status rule are
  unchanged. Resume IS this loop — it selects only pending
  rows, so a confirmed-sent recipient is never re-sent.
  Pause/resume/cancel/retry-failed and the sweep
  (`runDueBroadcasts`, incl. stale-"sending" recovery) operate
  on rows for table broadcasts.
- **Dual path:** a broadcast WITH recipient rows uses the table
  engine; a broadcast with ONLY a `recipientSnapshot`
  (pre-MX1) keeps the legacy snapshot engine byte-for-byte —
  including the refusal for a stuck "sending" row whose
  recipient set was never recorded (no snapshot, no rows →
  `processBroadcast` throws the historical "already sent (or
  is sending)" message; this case previously finalized a
  phantom "failed" from an empty snapshot — the refusal is the
  documented MS1 behaviour, now enforced on this path too).
  When the `broadcastRecipient` delegate does not exist
  (pre-migration deployment / pre-MX1 fixtures), prepare and
  process fall back to the snapshot engine exactly as before —
  every pre-MX1 spec passes untouched.
- **Reports:** `broadcastRevenue` / `broadcastReplies` read
  customer ids / phones from the recipient rows when a
  broadcast has no snapshot (snapshot-first precedence, so
  legacy reports are unchanged); the funnel's progress comes
  from the counters as above.

## Gate (MX1 item only, run serially)

| Gate | Result |
|---|---|
| Baseline messaging jest | 12 suites / 217 tests, all pass |
| Final messaging jest (`npx jest src/messaging`) | **13 suites / 232 tests, all pass** (+1 suite, +15 MX1 tests; zero regressions) |
| Neighbour spot-checks (not required, run for safety) | ms6 WhatsApp templates + cc27 deny + inbox phase-f: 56/56; workflows service spec: 4/4 |
| API tsc (`npx tsc --noEmit` in apps/api) | clean |
| Prisma validate | valid |

Full repo jest / production build were NOT run (coordinator
runs full gates at batch end), per the MX1 brief.

## MX1 spec coverage (`mx1-recipient-table.spec.ts`, 15 tests)

Chunked writes (createMany calls [2,2,2] at chunk size 2; 12 ×
≤250 for 3000 recipients), no snapshot stamped on new rows,
dedupe (duplicated audience rows written once + the unique
constraint itself refuses), preview ≡ prepare set with
suppression applied, plan-cap refusal (exact message, rows
cleaned, broadcast stays draft), kill-switch before any write,
empty-after-exclusions refusal, chunked processing with
counters == deliveries, pause/resume without re-sends,
interruption + sweep recovery (provider called exactly once per
recipient), cancel via API and mid-process (pending rows
skipped, counters derived), retry-failed (only failed rows,
attempts accumulate), 3000-recipient scale run, legacy
snapshot-only broadcast (snapshot path, zero recipient rows
written), stuck-sending refusal.

## Honest limits / NOT BUILT

- The migration has NOT run on any real DB and nothing is
  live-proven (M30 owed). Fresh-Postgres union proof is a
  batch-end coordinator gate, not run here.
- No web changes (by design — progress already derives from
  broadcast counters; no counter/field shape changed).
- The WhatsApp table path reuses the snapshot engine's
  run-scoped sender via the row→entry conversion; it is
  covered by code symmetry with the email path (spec-proven)
  and the legacy WhatsApp specs, but has no dedicated MX1
  WhatsApp spec.
- MX2 (channel routing/fallback) and MX3 (stream separation)
  were NOT started, per the brief.
