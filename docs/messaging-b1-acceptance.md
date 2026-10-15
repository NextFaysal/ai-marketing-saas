# Messaging B1 (MS1 + MS2) — Acceptance

Status: DELIVERED in the ms-package worktree (local commits only, NOT
pushed). Base: master `5b73021`. Migrations are hand-written additive
SQL and have NOT been run on any real DB. No live provider proof —
M30 verification is still owed for everything below.

Commits:
- `477798f` MS1 schema: Broadcast scheduledAt + recipientSnapshot
- `7ea9797` MS2 schema: MessagePreference + MessagingSetting
- `b8d3b5e` MS1 engine (+ the MS2 resolver/send-path surface in the
  same service pass) + automation wiring + MS1 specs
- `048a916` MS2 wiring: workflow skipped steps + inbox keyword hook
  + MS2 specs
- `995d251` Web: engine controls, consent card, unsubscribe page
- (docs commit — this file)

## Gate (baseline → final)

| Gate | Baseline (5b73021) | Final |
|---|---|---|
| API jest | 214 suites / 1915 tests, all pass | **216 suites / 1947 tests, all pass** (+2 suites, +32 tests = MS1 14 + MS2 18; zero regressions) |
| Messaging specs only | 3 suites / 22 tests | 5 suites / 54 tests |
| API tsc | clean | clean |
| Web vitest | 140/140 (no web test files touched by this batch) | 140/140 |
| Web tsc | clean | clean |
| Next build | green | green (route list includes the new ƒ /unsubscribe/[token]) |
| Prisma validate | valid | valid |

Baseline note: a bare checkout needs `pnpm --filter @repo/db
generate` + contracts/db builds before jest can run at all (189
suites fail on the unbuilt `@repo/db` otherwise) — that is a
checkout state, not a code failure; with the packages built the
baseline is 214/1915 clean.

## MS1 — Async send engine + scheduling (shipped)

- **Schema** (migration `20261013100000_ms1_broadcast_engine`):
  `Broadcast.scheduledAt`, `Broadcast.recipientSnapshot` (Json).
  Snapshot entries: `{ type, id, name, email, phone, status:
  pending|sent|failed|skipped, attempts, error?, providerMessageId?,
  address? }`. No new recipient table — the snapshot lives on the
  broadcast row like the Workflow.steps / templateParams Json
  precedents, so every existing fake-prisma fixture kept working.
- **prepareBroadcast**: the pre-MS1 send-time checks (exists,
  not-sent guard, kill-switch, plan cap, empty audience) + the ONE
  shared resolver + the deterministic A/B hash split; stamps the
  snapshot (all pending), `totalRecipients`, status `sending`.
- **processBroadcast**: chunks of 50 (`BROADCAST_CHUNK_SIZE`),
  optional inter-chunk delay from `BROADCAST_CHUNK_DELAY_MS`
  (default 0). The row is RE-READ between chunks: `paused` stops
  the loop leaving the rest pending; `cancelled` marks the rest
  skipped (reason `cancelled`) and stays cancelled. Snapshot +
  counters persist per chunk; counters are DERIVED from the
  snapshot, so they can never claim more than the deliveries
  actually recorded. WhatsApp sends go through a run-scoped sender
  (integration/template resolved once); a sender build failure
  becomes an honest per-entry failure instead of a stuck row, and
  the MS2 suppression guard applies inside it.
- **sendBroadcast keeps its contract**: prepare (if needed) +
  process to completion synchronously, returning the row with
  engine `progress`. Existing specs pass unchanged.
- **Controls** (all WRITE_ROLES, all audit-logged):
  `POST broadcasts/:id/schedule` (draft/scheduled only; null
  cancels the schedule back to draft), `/pause` (sending|scheduled),
  `/resume`, `/cancel` (draft|scheduled|paused|sending; terminal),
  `/retry-failed` (sent|partial|failed with failed entries only;
  attempts accumulate). Create accepts `scheduledAt` too.
- **Sweep**: `runDueBroadcasts(orgId)` — due scheduled broadcasts
  are prepared + processed, and `sending` rows whose `updatedAt`
  is older than 10 minutes are recovered as interrupted; at most
  200 entries per broadcast per run (the rest stays `sending` for
  the next run). Returns `{ started, recovered, processed,
  finalized, errors[] }` — per-broadcast failures are reported,
  never hidden, and never stop the others. Wired as the
  `broadcast_send_sweep` automation job (JOB_TYPES + org template,
  1 minute, Bengali description) via an optional MessagingService
  injection in AutomationService (MessagingModule was already
  imported there for EmailProvider — no cycle).
- **Web**: status-aware actions per broadcast row, progress line
  (total/sent/failed/skipped/pending), scheduled time display,
  schedule field in the create form.

### MS1 decisions locked
- **Final-status rule**: sent>0 & (failed+skipped)>0 ⇒ `partial`;
  sent>0 alone ⇒ `sent`; sent=0 ⇒ `failed` — including a
  fully-skipped audience (nothing reached anyone; the per-entry
  `skipped` records + progress say why). Spec-proven.
- **Schedule / send-now rule**: a manual send of a broadcast whose
  schedule is still in the future is REFUSED with the scheduled
  time in the error; cancelling the schedule returns it to draft
  and frees the send. (No silent send-now override.) A due (past)
  schedule no longer blocks a manual send. Spec-proven.
- **Paused schedule**: pausing a `scheduled` broadcast parks it —
  the sweep only picks up `scheduled` rows; resume returns it to
  `scheduled` (or sends immediately if its time already passed and
  it has no snapshot).
- A pre-MS1 row stuck in `sending` WITHOUT a snapshot still
  refuses with the historical message: its recipient set was never
  recorded, so there is nothing honest to resume. All MS1-era
  sends carry snapshots and are sweep-recoverable.

## MS2 — Consent, opt-out & suppression (shipped)

- **Schema** (migration `20261013110000_ms2_messaging_preferences`):
  `MessagePreference` (unique org+channel+normalized address;
  status opted_out|opted_in; source unsubscribe_link|
  inbound_keyword|manual|import) and `MessagingSetting` (per-org
  row, CrmSetting pattern: `frequencyCapPerDay` default 1,
  0 = off; `whatsappOptInRequired` default false).
  `MessageDelivery.status` vocabulary extends with `skipped`
  (comment only — free String).
- **ONE resolver, extended**: `resolveBroadcastRecipients` now
  applies, in order — CX10 previous-recipient exclusion →
  suppression by the CHANNEL's normalized address (an email
  opt-out never blocks SMS) → frequency cap over CONFIRMED
  broadcast deliveries in the rolling 24h → WhatsApp opt-in
  (only when the org setting is on). Preview returns
  `excludedSuppressedCount`, `excludedFrequencyCount`,
  `excludedNoOptInCount` next to the CX10 fields, and a spec runs
  preview + prepare on one fixture proving the sets are identical.
  All preference/setting reads are defensive (.catch → "no
  preferences / defaults"), so pre-migration orgs and older
  fake-prisma fixtures behave exactly as before — the existing
  CX10 spec needed NO edits. One honest subtlety: a delivery
  without a readable timestamp never counts toward the cap (it
  cannot be shown to be inside the window); real rows always
  carry `createdAt`.
- **sendToRecipient guard** (broadcasts AND workflows): an
  opted_out recipient is never sent to — the provider is not
  called; a `skipped` MessageDelivery records
  `Recipient opted out (<source>)` and the result type gains
  `skipped`. The workflow caller logs such a step as **skipped**
  (StepSkippedError — not ok, not failed, run still completes),
  in both the main step loop and branch arms; spec-proven through
  a real WorkflowsService run.
- **Unsubscribe (email)**: HMAC-signed token helper
  (`messaging/unsubscribe-token.ts`, admin-token pattern; payload
  org/channel/address; 1-year expiry). Broadcast email bodies gain
  a plain-text footer with `${WEB_URL}/unsubscribe/<token>` —
  ONLY in the broadcast path (spec: captured provider body
  contains the link; a workflow send's body does not). If
  JWT_SECRET is unset no token can be signed and the mail sends
  without a footer rather than crashing the loop. Public
  controller `public/messaging/unsubscribe/:token`: GET validates
  and returns only channel + MASKED address; POST performs the
  opt-out (source `unsubscribe_link`); invalid/expired → Bengali
  400, nothing written (spec-proven with a tampered token).
  Public web page `/unsubscribe/[token]` in the /review style —
  the write happens only on the visitor's confirm click.
- **Inbound keywords**: `handleInboundKeyword` hooked best-effort
  into `processInboundIntelligence` for **WhatsApp only** —
  STOP / STOP ALL / UNSUBSCRIBE / বন্ধ করুন / স্টপ → opted_out;
  START / চালু করুন → opted_in, flipping the same row
  (source `inbound_keyword`). Exact whole-message match after
  trimming. No auto-reply is sent; the message flow is untouched.
- **Management**: `GET/PATCH messaging/settings` (PATCH
  OWNER/ADMIN; strict service validation — cap integer 0..20,
  boolean opt-in), `GET/POST messaging/preferences`,
  `DELETE preferences/:id` (OWNER/ADMIN), `POST
  preferences/import` (cap 1000, per-row errors returned, never
  all-or-nothing silent), `GET preferences/export` (CSV of
  opted_out rows, OWNER/ADMIN, audited). Messaging page gains the
  "সম্মতি ও অপ্ট-আউট" card with all of it.

### MS2 decisions locked
- **Messenger keyword scope: WhatsApp only.** No broadcast or
  workflow send path can address a Messenger PSID today, so a
  PSID-keyed preference could never match a send — recording it
  would be dead data. When a Messenger send path exists (MS6),
  the hook extends by one channel check.
- **Transactional vs broadcast boundary**: suppression applies to
  EVERY send through sendToRecipient (broadcasts + workflows);
  the frequency cap and WhatsApp opt-in-required are
  BROADCAST-only (resolver-level). A workflow order confirmation
  is never frequency-capped, but an opted-out customer is never
  messaged at all.
- **Owner-decision item from the plan** (WhatsApp marketing
  opt-in default): shipped as org setting `whatsappOptInRequired`
  default **false** per the brief's schema default — each org
  turns it on explicitly; the plan's "default ON" proposal is
  recorded here as NOT taken, so the owner can revisit it.

## Honest limits
- Migrations `20261013100000` / `20261013110000` are NOT run on
  any real DB; deploy needs them + `prisma generate` (the API's
  defensive reads keep pre-migration orgs working meanwhile for
  preferences/settings, but scheduled/snapshot columns must exist
  for MS1 paths — prepare/sweep writes would fail honestly
  without the migration).
- The sweep only runs for orgs that enable the
  `broadcast_send_sweep` job (same honest limit as IN4's SLA
  sweep) — a scheduled broadcast in an org without the job simply
  waits, and its row says so in the UI copy.
- Snapshot size: bounded by the per-send plan cap (max 5000
  recipients on AGENCY) as a single Json column — acceptable for
  B1; a recipient table is the scale path if caps grow.
- No live provider proof: no real SMTP / SSL Wireless / Meta send
  was made; footer, DLR-free statuses and keyword flips are
  spec-proven only (M30 still owed). There is still NO delivered/
  read tracking (that is MS7) and no per-tenant senders (MS4).
- Migration-number note for integration: MS uses the reserved
  `2026101310xxxx` / `2026101311xxxx` slots — no collision with
  EC's `2026101300–050000` series or AP7's `20261013000000`.
