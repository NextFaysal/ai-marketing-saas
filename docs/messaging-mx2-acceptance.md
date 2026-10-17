# Messaging Advanced MB1 / MX2 — Acceptance

Status: DELIVERED in the `ai-marketing-saas-mx` worktree (branch
`messaging-advanced`, on top of MX1 `7acd2584`). **Local commits
only — NOT pushed.** MX3 was NOT started. No live provider
proof — M30 verification is still owed for everything below.

## MX2 — Smart Channel Routing & Fallback Cascade (shipped)

- **Cascade config** (migration `20261019010000_mx2_cascade`,
  hand-written additive SQL, MX1 style; NOT run on any real DB):
  `Broadcast.cascadeConfig` (Json) holds
  `{ enabled, channels, smartRouting, ordering, smsBody?,
  emailSubject?, emailBody?, whatsappTemplateId? }`, validated
  strictly at create by the pure `parseCascadeConfig`
  (messaging/cascade.ts): channels must be a non-empty subset
  of email/sms/whatsapp, must include the broadcast's primary
  channel, and must number ≥ 2 — otherwise an honest 400. A
  cascade WhatsApp template id that is not this org's template
  404s at create. Disabled/absent config is stored as null, so
  every pre-MX2 broadcast (and every new single-channel one)
  behaves byte-identically. Clone + recurrence chaining carry
  the config forward.
- **Pure core** (`apps/api/src/messaging/cascade.ts`, no
  Prisma/providers): `parseCascadeConfig`/`readCascadeConfig`,
  `preferredChannel`, `engagementStats`, `cheapestFirstOrder`,
  `resolveAttemptOrder`, `SmsCircuitBreaker`,
  `cascadeBreakdown` — all spec-pinned.
- **Fallback engine** (recipient-table path — see deviation
  below): per recipient, the attempt order is resolved once
  (org order → cheapest re-order → smart-routing preferred
  first), then channels are tried until one confirms **sent**
  (provider confirmation only, as always). A per-channel
  opt-out `skipped` from inside the channel send path does not
  stop the cascade (the next channel may legitimately reach
  the recipient); resolve-time suppression/frequency stages
  are untouched, so a resolve-suppressed recipient has NO row
  and gets zero attempts/provider calls on every channel
  (spec-proven). Final recipient-row status: sent if any
  channel confirmed; failed if ≥1 real attempt failed and none
  succeeded; skipped when every attempt was a skip. The row's
  `attempts` counts channel attempts on this path.
- **Attempt linking**: every attempt is its own
  `MessageDelivery` row carrying `recipientRowId` (the
  BroadcastRecipient row), `attemptIndex` (0-based) and
  `cascadeGroupId` (= the recipient row id) — new nullable
  columns + `(broadcastId, recipientRowId)` index. All
  non-cascade deliveries keep null links.
- **Honest skips**: a recipient lacking the channel address
  (no email / no phone) gets a recorded `skipped` delivery for
  that attempt with the reason, and the provider is never
  called. A cascade channel with no content configured
  (email subject/body, smsBody, or a WhatsApp template) is
  skipped for the WHOLE broadcast with the reason recorded
  once in `Broadcast.cascadeReport.skippedChannels`.
  WhatsApp attempts go ONLY through an approved template
  (the broadcast's own for a WhatsApp primary, else the
  cascade's `whatsappTemplateId`, resolved through the
  existing run-scoped WhatsApp sender) — never free-form.
- **Per-channel content**: primary channel uses the
  broadcast's own subject/body/htmlBody/WhatsApp template;
  other channels use the cascade config's own content
  (`smsBody`, `emailSubject`+`emailBody`, `whatsappTemplateId`).
  Cascade WhatsApp reuses the broadcast's `templateParams`
  substitution; a cascade template needing different params
  is a documented limit (below).
- **SMS gateway failover + circuit breaker**: before MX2 an
  org had exactly ONE tenant SMS config
  (`MessagingSenderConfig.organizationId` is `@unique`).
  MX2 adds `MessagingSenderConfig.smsPriority` and a new
  `MessagingSmsGatewayConfig` table for additional gateways
  (same AES-256-GCM sealed-secret discipline, `priority`,
  `isEnabled`), with create/delete endpoints
  (`POST/DELETE senders/sms/gateways`, OWNER/ADMIN) and a
  secret-free list in the sender-settings view. Sends try
  tenant gateways in priority order (primary interleaved by
  its `smsPriority`); a provider failure moves to the next
  gateway, success on any gateway is the send's single
  delivery row, and if all fail the LAST gateway's error is
  the recorded failure. The platform SMS path is used only
  when NO tenant gateway exists (MS4 semantics unchanged).
  Circuit breaker: `SMS_CIRCUIT_BREAKER_THRESHOLD = 5`
  consecutive failures (per run, per gateway key
  `gateway:senderId`; a success resets the counter) — the
  gateway is then skipped for the rest of the run and the
  trip is recorded as a breaker event.
- **Preferred-channel hint / smart routing**: pure
  `preferredChannel(stats, orgOrder)` — highest real
  engagement wins (openedAt / readAt / deliveryStatus
  read|delivered / link clicks attributed via the delivery's
  broadcast, over confirmed-sent deliveries only); ties break
  by org cascade order; no history → null (org order). The
  service gathers a recipient's org history at send time
  (cached per run) only when `smartRouting` is on; csv/test
  recipients have no entity-keyed history and honestly fall
  back to org order.
- **Cheapest-first: BUILT** — the rate fields DO exist per
  channel on `MessagingSenderConfig`
  (`smsCostPerPartMinor`, `whatsappCostPerMessageMinor`,
  `emailCostPerMessageMinor`, MS4 org-entered rates). Ordering
  compares per-message figures (SMS = per-part rate × the
  cascade SMS body's segment count). If ANY cascade channel's
  rate is missing, the org order is kept AND the report says
  so (`cascade.ratesMissing` + a Bengali `ratesNote`) — never
  a silent choice, never an invented price.
- **Report**: `getBroadcastReport` gains a `cascade` section
  (null for non-cascade broadcasts — pre-MX2 reports are
  unchanged): per-channel `{ attempts, sent, failed, skipped,
  finalSuccesses }` and per-recipient chains (capped at 200)
  derived from the linked delivery rows, merged with the
  stored run facts (`breakerEvents`, `skippedChannels`,
  `ratesMissing`). The funnel's delivered/read/opened stages
  keep their primary-channel semantics (documented limit).
- **Web** (`apps/web/src/app/dashboard/messaging/page.tsx` —
  the messaging UI is this single page in the current tree;
  there are no separate Composer.tsx/ReportPanel.tsx files):
  the composer gains a cascade section (enable toggle,
  fallback channel order with move-up, smart-routing toggle,
  org/cheapest ordering select, per-channel fallback content
  fields incl. a WhatsApp template picker) wired into the
  create payload on both channel branches; the report panel
  renders the per-channel attempt breakdown, final-channel
  success counts, chains (first 20), breaker events, skipped
  channels and the missing-rates note. Bengali copy style
  kept. The web cascade UI always leads the attempt order
  with the primary channel (the org's fallback order follows);
  arbitrary API orders remain possible via the API itself.

## Gate (MX2 item only, run serially)

| Gate | Result |
|---|---|
| Baseline messaging jest (pre-MX2, MX1 state) | 13 suites / 232 tests, all pass |
| Final messaging jest (`npx jest src/messaging`) | **14 suites / 249 tests, all pass** (+1 suite, +17 MX2 tests; zero regressions) |
| API tsc (`npx tsc --noEmit` in apps/api) | clean |
| Web tsc (`npx tsc --noEmit` in apps/web) | clean |
| Web vitest | no test file covers the messaging page; a sample lib suite run green (3/3). Full web vitest is a batch-end coordinator gate. |
| Prisma validate | valid |

Full repo jest / production build were NOT run (coordinator
runs full gates at batch end), per the MX2 brief.

## MX2 spec coverage (`mx2-cascade.spec.ts`, 17 tests)

Pure: preferred channel (most-engaged, tie→org order,
no-history→null); engagementStats (sent-only, open/click);
cheapest-first (rates present sort, missing rate → org order
+ named channel); breakdown final-success attribution.
Engine: fallback email-fail → SMS success (linked attempts,
recipient final sent, report chain + finalSuccesses);
all-channels-fail (final failed, full chain, attempts=2);
resolve-suppressed recipient (no row, zero deliveries, zero
provider calls); no-phone recipient (SMS attempt = recorded
skip, no provider call); WhatsApp without template (channel
skipped once with reason, zero WhatsApp rows); WhatsApp with
template (Meta-only send, fallback succeeds); create
validation (missing primary → 400, bogus cascade template →
404). Failover: primary gateway down → backup confirms (one
delivery row, platform path untouched); circuit breaker
trips at exactly 5 consecutive failures, gateway skipped
for the rest of the run, event surfaced in broadcast +
report. Ordering: cheapest with rates (SMS first, email
never attempted); cheapest with rates missing (org order +
report `ratesMissing`/`ratesNote`); smart routing on (order
starts with the engaged channel) vs off (org order). Legacy:
pre-MX2 snapshot broadcast — single-channel send, null links,
`report.cascade` null.

## Deviations / honest limits / NOT BUILT

- **Cascade is scoped to recipient-table (MX1) broadcasts.**
  Legacy snapshot broadcasts never carry a cascade config
  (the field did not exist when they were created) and keep
  the legacy loop byte-for-byte; in any deployment where the
  MX1 migration has run, ALL new broadcasts are
  recipient-table broadcasts, so the cascade covers every
  broadcast that can have one configured. Recorded here per
  the brief — not silent.
- **Audience resolution stays primary-channel** (the shared
  MX1 resolver's contract): a recipient reachable only on a
  fallback channel but lacking the PRIMARY channel's address
  is excluded at resolve, exactly as pre-MX2. Cascade uses
  the addresses present on the resolved recipient rows.
- **Migration NOT run on any real DB; nothing live-proven**
  (M30 owed). Fresh-Postgres union proof is a batch-end
  coordinator gate.
- Cascade WhatsApp attempts reuse the broadcast's
  `templateParams`/`templateComponents`; a cascade template
  needing different parameters is not separately
  configurable in MX2.
- The report funnel's delivered/read/opened stages remain
  primary-channel semantics for cascade broadcasts; the
  cascade section is where per-channel outcomes live.
- SMS failover does NOT fall through to the platform gateway
  after tenant gateways fail (MS4 tenant-over-platform
  semantics preserved deliberately); the recorded failure is
  the last tenant gateway's real error.
- MX3 (stream separation) was NOT started, per the brief.
