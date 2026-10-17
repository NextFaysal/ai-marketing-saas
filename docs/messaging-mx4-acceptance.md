# MX4 — Visual Journey Builder (Messaging-native) — Acceptance

Status: **CODE-COMPLETE** (local commits only, no push). A journey IS a
Workflows-engine workflow (`Workflow.journey` non-null) — the definitions
the builder writes are executed by the existing engine; **no second
engine was built**.

Commits (branch `messaging-advanced`, base `35e19d74`):

- `f511db3a` — MX4: journey engine + API
- `44c5d73c` — MX4 web: Journeys section in the Messaging page
- (this doc's commit — see git log)

## Shipped, with file evidence

### 1. Migration `20261019030000_mx4_journey`
`packages/db/prisma/migrations/20261019030000_mx4_journey/migration.sql`;
schema in `packages/db/prisma/schema.prisma`:

- `Workflow.journey Json?` — `{ origin: "messaging", exitOnPurchase?: boolean, layout?: unknown }`.
- `MessageDelivery.stepRef String?` — engine step position ("3" / "3.then.0" / "3.else.1").
- `MessageLinkClick.broadcastId` → nullable; `MessageLinkClick.workflowRunId String?`
  + `@@index([organizationId, workflowRunId])`.

Additive only, no backfill. The migration has **not** run on any real DB
(same standing state as the rest of the MX package; M30 owed).

### 2. Workflows engine (`apps/api/src/workflows/workflows.service.ts`)
All additive; non-journey workflows behave byte-identically (guarded by
the full W1–W7 / engine-v2 / AB7 suites staying green, unmodified).

- `stepsLog` entries gain `idx` (top-level step index) on wait /
  condition / branch / plain / skipped / failed entries; branch sub-step
  entries additionally gain `ref` in the coupon format (`"3.then.0"`).
  No existing field removed or renamed.
- `executeStep` send_email/send_sms: passes `stepRef` through to
  `sendToRecipient`, and for email also `htmlBody: template.htmlBody ?? undefined`
  (sendToRecipient already supported it). Templates with null htmlBody —
  every MS8 preset template — pass `undefined` and behave exactly as before.
- `create`/`update` accept an optional `journey` dto field (the port's
  storage path); nothing else about them changed.
- **Resume-time journey fact refresh** in `resumeRuns`, ONLY when
  `workflow.journey != null`, merged into the run context before
  `executeSteps` (conversation-refresh precedent, same defensive
  `.catch(() => null)` style):
  - `purchasedSinceEntry`: an Order exists with the org + `context.customerId`,
    `createdAt > run.createdAt`, `id != context.orderId` (the exclusion
    applies only when an entry order id is in context). False when no
    customerId (a lead-only context attributes no orders).
  - `customerTags`: comma-joined `Customer.tags` (Json array) when a
    customerId is present, else `Lead.tags` (String[]) for a leadId, else `""`.
  - `journeyOpened`: any MessageDelivery of this run with `openedAt` non-null.
  - `journeyClicked`: any MessageLinkClick with this run's `workflowRunId`.
- **Exit on purchase**: when `workflow.journey.exitOnPurchase === true`
  and the refreshed `purchasedSinceEntry === true`, the run finalizes
  WITHOUT executing further steps — status `completed`, `resumeAt` null,
  a stepsLog entry `{ step: "exit", status: "ok", idx: run.nextStepIndex ?? 0,
  detail: "Journey exited on purchase: order <id> …" }`, refreshed context
  persisted. Evaluation is **polling-only** (at resume time); there is no
  real-time order hook — stated in the code comment and in the UI help text.

### 3. Workflow-send tracking extension — **NOT BUILT** (see below)
Only the non-tracking part of §3 landed: `sendToRecipient` accepts an
optional `stepRef` and `recordDelivery` stamps it onto the delivery row
(null everywhere else — broadcast sends, the coupon step — exactly as
before). This is what makes per-step delivery stats honest.

### 4. Messaging journey API (`messaging.service.ts` / `.controller.ts` / `.dto.ts`)
- `WorkflowCreatorPort` widened: create dto gains `journey?`; update dto
  widened to `{ enabled?, name?, trigger?, conditions?, steps?, journey? }`;
  `list` + `listRuns` signatures added. Every journey endpoint calls the
  port defensively (`typeof` check → `BadRequestException("Workflow engine
  is not available in this deployment")`, the installJourneyPreset
  precedent). Messaging NEVER writes the Workflow table directly.
- Endpoints (org-scoped, existing controller, WRITE_ROLES = OWNER /
  ADMIN / MARKETING_MANAGER for writes, like journey-presets):
  - `GET messaging/journeys/meta` → `{ triggers, conditionFields, stepTypes }`.
    Journey-usable triggers (verified against `resolveRecipient` +
    `enrichContext` + the MS8 preset audit): `order_created`,
    `order_delivered`, `order_cod_confirmed`, `lead_created`,
    `lead_stage_changed`, `cart_abandoned`, `inbox_message_received`.
    Excluded with cause: `schedule` (context `{date, scheduledFor,
    dayOfWeek}` — no recipient at all; the reason MS8 dropped
    winback_sweep) and the ops/status/shipment/conversation triggers.
    conditionFields: `total`, `status`, `source`, `stage` (the fields
    enrichContext really supplies) + `purchasedSinceEntry` (eq) +
    `customerTags` (contains). `journeyOpened`/`journeyClicked` are NOT
    offered (tracking not built — §3 outcome).
  - `GET messaging/journeys` → journeys (`journey != null`) with run
    summaries `{ total, waiting, completed, failed, skipped }` (port
    listRuns, take 200).
  - `POST messaging/journeys` → messaging-side validation (trigger in
    the meta list; step allowlist `[send_email, send_sms, wait,
    condition, branch, add_tag]`; branch arms only
    `[send_email, send_sms, add_tag]` — stricter than the engine, which
    would also refuse wait/nested branch in arms; send steps must
    reference an existing template of the matching channel via
    `getTemplate`; wait 1..43200; condition/branch field+op; add_tag
    tag + target), then port create with journey meta
    `{ origin: "messaging", exitOnPurchase }`, then port update
    `enabled: false` (preset discipline — a human reviews before it can
    act). Audit: `messaging.journey_create`.
  - `GET messaging/journeys/:workflowId` → the journey (404 unless it
    exists, belongs to the org and has `journey != null`) + per-step
    stats + recent runs (port listRuns, take 20).
  - `PATCH messaging/journeys/:workflowId` → name / trigger /
    conditions / steps / enabled / exitOnPurchase via port update
    (steps re-validated messaging-side; the engine re-validates the
    resulting definition). Response carries the note that in-flight
    runs keep their frozen `stepsSnapshot` (W1) — edits affect new
    runs only. Audit: `messaging.journey_update`.

**Per-step stats semantics** (computed in MessagingService from
WorkflowRun + MessageDelivery + MessageLinkClick rows directly; runs
read capped at 1000, deliveries/clicks at 20000):

- `entered/ok/skipped/failed` count stepsLog entries whose `idx`
  equals the step's top-level index. A branch step's idx covers its own
  log line PLUS its arm sub-steps' lines (same idx, with `ref`).
- `waitingHere` (wait steps only, `null` elsewhere): runs currently
  `waiting`/`resuming` with `nextStepIndex - 1 === idx`.
- `delivery` (send steps; branch steps via arm refs): MessageDelivery
  rows of this workflow's runs with `stepRef === String(idx)` — for a
  branch, `stepRef` starting with `${idx}.` — counted
  sent/failed/skipped + opened (`openedAt` non-null). `null` for steps
  that cannot send.
- Clicks are reported at journey level only (`totalClicks`):
  MessageLinkClick rows carry no stepRef, so per-step click
  attribution is not honestly derivable and is never invented.
- `legacyRunCount`: runs whose stepsLog has entries but none carries a
  numeric `idx` (pre-MX4 runs). They count in run-summary totals only,
  never in per-step rows; the UI discloses the count.

### 5. Web — Journeys section (`apps/web/src/app/dashboard/messaging/page.tsx`)
Adjacent to the Journey Presets card:

- List: name, trigger label (from meta), enabled toggle (PATCH),
  exit-on-purchase chip, run-summary chips, "বিস্তারিত" expand →
  per-step stats table + journey-level clicks note + legacy-run
  disclosure + recent runs.
- Create/edit editor: a **structured visual vertical flow** — trigger
  node card, then step cards connected vertically (↓), branch steps
  render then/else arms as two side-by-side columns of sub-step cards.
  Per-card move up/down + delete; "ধাপ যোগ করুন" menu (অপেক্ষা /
  ইমেইল পাঠান / SMS পাঠান / শর্ত / শাখা (branch) / ট্যাগ যোগ); field
  editors per type (wait → minutes; send → template select filtered by
  channel from the page's templates state; condition/branch → field
  select from meta conditionFields + op select + value input, boolean
  fields as হ্যাঁ/না select; add_tag → tag + target). Trigger select
  from meta. exitOnPurchase checkbox with the honest Bengali
  polling note (run resume-এর সময় যাচাই হয়). Save → POST/PATCH;
  created journeys start disabled with a clear note.

### 6. Specs (new files only; no existing spec modified)
- `apps/api/src/messaging/mx4-journey.spec.ts` (14 tests): meta shape
  (incl. journeyOpened/journeyClicked absent), honest refusal with no
  port, create via stubbed port (meta rides create, enabled:false via
  update, audit), list filtering + run summary, 404 discipline,
  messaging-side validation (bad trigger, unknown step type,
  wait/condition/nested-branch in arm refused, empty branch refused,
  template channel mismatch, missing templateId, wait range, update
  re-validation writes nothing on refusal), per-step stats math
  (idx counting, waitingHere, stepRef delivery aggregates incl. branch
  arm refs, legacyRunCount, journey-level clicks), stepRef stamping.
- `apps/api/src/workflows/mx4-journey-engine.spec.ts` (8 tests):
  stepsLog idx/ref stamping, stepRef + htmlBody on sends,
  resume-time refresh (purchased true with entry-order exclusion,
  purchased false, customerTags from Customer and from Lead,
  journeyOpened/journeyClicked gating conditions), exit-on-purchase
  finalizes without calling the provider and names the order,
  pre-entry orders do not exit, non-journey workflows get NO refresh
  (context untouched).

## Tracking extension outcome — NOT BUILT, with evidence

§3 asked for workflow-send link rewriting + open pixel (token payloads
gaining optional `workflowRunId`, `broadcastId` optional, exactly-one
verification; `performOpenTracking`/`performLinkRedirect` workflow
branches). It cannot land without breaking a pinned, unmodifiable spec:

- `apps/api/src/messaging/ms5-composer.spec.ts`, test **"toggle ON wraps
  SMS bodies too; workflow sends are NEVER rewritten"**: calls
  `sendToRecipient` with `workflowRunId: "run-1"` (link tracking ON by
  default) and asserts the email body stays verbatim —
  `toContain("Visit https://shop.example/sale now")` and
  `not.toContain("utm_")`. The §3 rule "rewrite applies when
  (broadcastId || workflowRunId)" rewrites exactly this send, so the
  test fails by construction.
- `apps/api/src/messaging/ms7-delivery-lifecycle.spec.ts`, test
  "text-only broadcasts and **workflow sends carry no pixel**" pins the
  same product rule for the open pixel.

Per the MX4 guardrail (existing specs pass UNMODIFIED; on a pinned
conflict, revert only the tracking sub-part), the token / rewrite /
pixel / public-handler changes were **not made**: `open-token.ts` and
`link-tracking.ts` are untouched, workflow sends remain unrewritten and
pixel-free, and the unsubscribe footer stays broadcast-only as today.
Consequences, all honest:

- `journeyOpened` / `journeyClicked` are computed by the resume refresh
  from real rows, but no code path can produce an opened workflow
  delivery or a workflow click today, so they read `false` in practice.
  They are therefore **not offered** in the meta conditionFields and
  not shown in the builder — the canvas offers context / purchased /
  tag conditions only.
- The schema half that a future landing needs (nullable
  `MessageLinkClick.broadcastId` + `workflowRunId` + index) DID land in
  the migration, so revisiting the MS5 pin later needs no further
  migration.
- Journey per-step `opened` counts are real (they count delivery rows
  with `openedAt`); they will simply be 0 until tracking exists.

## NOT BUILT

- **Workflow-send tracking extension** (open/link tokens for workflow
  sends, rewrite + pixel on workflow sends, workflow branches of
  performOpenTracking/performLinkRedirect; opened/clicked journey
  conditions) — MS5/MS7 pinned behaviour; evidence above.
- **WhatsApp send step in journeys** — the engine has no WhatsApp step
  type (STEP_TYPES has none; `send_inbox_message` is a conversation
  reply, not a broadcast send). Not in the allowlist, not in the UI.
- **Free-drag x/y canvas** — pre-decided deviation: engine steps are a
  linear array + one branch level; a free canvas would need a compile
  layer that can drift from the engine's real shape. The editor is a
  structured vertical flow instead.
- **Real-time purchase exit** — exit-on-purchase is polling-only,
  evaluated when a waiting run resumes (documented in code, API-shaped
  behaviour and UI copy). No order-event hook was added.
- **journey.layout** — omitted, not invented: the editor stores steps
  in the engine's own array order and has no x/y or ordering state of
  its own, so there was no layout data to persist. The schema comment
  keeps `layout?` as a possible future field of the meta shape.
- Cascade on journey sends, per-recipient personalization beyond the
  engine's existing context vars — out of MX4 scope (MX5/MX6 items).

## Gates run (scoped, this worker)

- `npx jest src/messaging src/workflows --runInBand` (apps/api):
  **31 suites passed, 353 tests passed, 0 failed** — includes the new
  mx4 specs (22 tests) and every pre-existing messaging + workflows
  suite UNMODIFIED (ms1/ms2/mx1/mx2/mx3, ms5-composer,
  ms7-delivery-lifecycle, ms8-bridge, w1–w7, workflow-engine-v2, ab7).
- `npx tsc --noEmit -p tsconfig.json` (apps/api): green.
- `npx tsc --noEmit -p tsconfig.json` (apps/web): green.
- `npx vitest run --passWithNoTests` (apps/web): **82 files, 703 tests passed**.
- `npx prisma validate` (packages/db, with a dummy DATABASE_URL — the
  env var is absent in this sandbox, which is the pre-existing state
  on the base tree too): **schema valid**.

NOT run (coordinator runs them serially at batch level): the full API
suite, a Next build, and any live-DB migration run. M30 live proof for
MX4 (a real journey firing end-to-end on the deployed build) is owed,
like the rest of the package.
