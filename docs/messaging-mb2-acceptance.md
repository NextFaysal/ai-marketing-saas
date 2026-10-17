# Messaging Advanced MB2 (MX4 + MX5 + MX6) — Batch Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `35e19d74` (MB1 head). **Local
commits only — nothing has been pushed.** No live provider proof
anywhere in this batch (M30 still owed); the two MB2 migrations
have NOT been run on any real DB (fresh-Postgres proof only, in the
Gates section below).

Per-item detail: [messaging-mx4-acceptance.md](messaging-mx4-acceptance.md) ·
[messaging-mx5-acceptance.md](messaging-mx5-acceptance.md) ·
[messaging-mx6-acceptance.md](messaging-mx6-acceptance.md)

## Commits

| Item | Commits |
|---|---|
| MX4 | `f511db3a` engine + API · `44c5d73c` web · `3ab0d045` acceptance |
| MX5 | `68799cbe` catalogue · `dafa59bf` install path · `7feb9267` scan enrollment · `06435ab6` specs · `ec443719` web · `29d078e0` acceptance |
| MX6 | `d27a049f` schema + migration · `5fc64201` service + API · `c32e9c80` inbox hook + reply port · `a6618bd4` specs · `ea535f0e` web · `7801bd69` acceptance |

## Step 0 — audit findings (before any MB2 code was written)

**Workflows engine (the MX4/MX5 foundation).** `Workflow.steps` is
a flat Json array executed by `WorkflowsService`
(apps/api/src/workflows/workflows.service.ts). Step types already
include `wait` (1..43200 minutes), `condition` (flat context lookup
via `evaluateConditions` in messaging/render.ts; ops eq/neq/gt/gte/
lt/lte/contains; a failed condition stops the run as completed) and
two-arm `branch` (arms may NOT contain a wait or a nested branch —
validator-enforced). Runs freeze a `stepsSnapshot` at start (W1);
waits pause a run (`waiting` + `resumeAt` + `nextStepIndex`) and a
leader-claimed 5-minute scan resumes them, already refreshing
conversation facts into the context at resume — the precedent MX4's
fact refresh follows. Workflow send steps call
`MessagingService.sendToRecipient({ workflowRunId })`, which
enforces MS2 suppression and writes `MessageDelivery` rows carrying
the run id. 17 triggers exist (order/lead/cart/inbox/shipment/
schedule families). MS8 journey presets (6) install through a
registered-port pattern (`registerWorkflowCreator`) — messaging
never imports workflows; presets install disabled.

**What the audit found missing (and how MB2 handled it).**
- `WorkflowRun.stepsLog` recorded no step index, so per-step counts
  were not honestly derivable → MX4 stamps `idx`/`ref` additively.
- Link tracking + the open pixel are **broadcast-only by pinned
  design**: `ms5-composer.spec.ts` asserts workflow sends are NEVER
  rewritten and `ms7-delivery-lifecycle.spec.ts` pins no pixel on
  workflow sends. The MX4 tracking extension therefore did **NOT**
  land (see MX4 NOT BUILT) — journey conditions are context /
  purchased / tag based, and opened/clicked conditions are not
  offered.
- `Customer` and `Lead` have **no date-of-birth field** → the MX5
  birthday preset is NOT BUILT; the anniversary preset uses the
  real `createdAt` date via scan enrollment.
- The `schedule` trigger's context carries no recipient (the reason
  MS8 dropped win-back) → MX5 win-back/anniversary/browse run on
  **scan enrollment** inside the engine's existing 5-minute scan,
  never on the schedule trigger.

**Inbox + inbound (the MX6 foundation).** The only real inbound
path is WhatsApp into the Unified Inbox: the Meta webhook parser
turns text, template-button (`button.text`) and interactive
(button_reply/list_reply titles) replies into message text on a
`ChannelConversation` (externalContactId = wa_id, customerId /
leadId links, tags). MS2's STOP/START hook
(`MessagingService.handleInboundKeyword`) is called best-effort
from the inbox ingest for WhatsApp only; Messenger is deliberately
not hooked (a PSID matches no send path). There is **no SMS
inbound path anywhere** and email replies are not hooked into
messaging. `MessagingService.sendToRecipient` sends email/SMS only
— WhatsApp conversation sends live in InboxService, so MX6
auto-replies go through a registered inbox-reply port (the MS8
anti-cycle pattern). The inbox web page selects conversations by
internal state only — no URL deep-link exists.

## MX4 — Visual Journey Builder (migration `20261019030000_mx4_journey`)

- `Workflow.journey` Json meta ({origin:"messaging",
  exitOnPurchase?}); journeys are ordinary workflows — the existing
  engine executes them; no second engine was built.
- Journey CRUD + meta catalogue under `messaging/journeys*` via the
  widened MS8 port; created disabled (preset review discipline);
  messaging-side step validation mirrors the engine validator.
- Per-step stats computed from real records: stepsLog idx counting
  (entered/ok/skipped/failed/waitingHere), `MessageDelivery.stepRef`
  delivery aggregates per step, `legacyRunCount` disclosed for
  pre-MX4 runs whose logs carry no idx. Clicks are reported at
  journey level only (step attribution is not honestly derivable).
- Resume-time fact refresh for journey runs only:
  purchasedSinceEntry (orders after run start, entry order
  excluded), customerTags (Customer Json / Lead String[]),
  journeyOpened/journeyClicked (computed from real rows; in
  practice false today — see NOT BUILT). Exit-on-purchase finalizes
  a waiting journey run at resume when a later purchase exists —
  polling evaluation only, recorded in the stepsLog with the order
  id. Non-journey workflows are untouched by the refresh.
- Web: "🧭 Journeys" section in the Messaging page — a structured
  visual flow editor (trigger node → step cards; branch arms side
  by side; meta-driven field editors), list + enable toggle + run
  chips + per-step stats detail. New specs: 14 (messaging) + 8
  (workflows engine).

## MX5 — Drip Sequences & Lifecycle Presets v2 (no migration)

- v2 catalogue (`journey-presets-v2.ts`, multi-template presets)
  installed through the SAME journey-presets endpoint, disabled,
  with journey meta: welcome_series (lead_created, 3 emails),
  post_purchase_care (order_delivered, care SMS → review ask, no
  invented review link), replenishment_reminder (order_delivered,
  21-day fixed default + exitOnPurchase — the copy states the
  interval is NOT computed from consumption data),
  abandoned_browse (new `browse_abandoned` trigger).
- Scan enrollment (`scanJourneyEnrollment` + `scanBrowseAbandoned`
  in the engine's existing leader-claimed scan): triggers
  `winback_due` (latest-order inactivity, threshold from workflow
  conditions, default 60d clamp 7..365, 90-day dedupe, cap
  50/workflow/scan), `anniversary_due` (createdAt month/day,
  Asia/Dhaka per the schedule-trigger convention, ≥300 days old,
  300-day dedupe), `browse_abandoned` (identified product_view-only
  visitors via the same Visitor identify linkage the shipped
  product_viewers audience uses; unidentified visitors are never
  enrolled — no dead runs). Bare {customerId} enrollment proven
  end-to-end in specs.
- MS8 parity: `ms8-bridge.spec.ts` does not pin the port-create
  payload, so MS8 installs gained `journey:{origin,preset}` meta
  with steps/trigger/name byte-identical (deep-equal pinned in the
  MX5 specs) — MS8 presets now also appear in the Journeys list
  with per-step stats. The presets listing carries
  `unavailable: [birthday]` with the no-DOB reason, rendered as a
  greyed card. New specs: 11 (messaging) + 7 (workflows).

## MX6 — Two-way & Interactive Campaigns (migration `20261019030200_mx6_keyword_campaigns`)

- `MessagingKeywordRule` (kind keyword|poll; one `tag` string +
  `applyTagTo[]`; autoReplyText; pollOptions) +
  `MessagingKeywordHit` (per-action outcomes, AI suggestion
  fields). Rule CRUD + tally + hits + classify/apply endpoints.
- Processing: in the inbox ingest chain, a STOP/START match is
  exclusive — campaign matching never runs after it. Otherwise
  `handleKeywordReply` matches the normalized text against enabled
  WhatsApp rules (reserved STOP/START keywords are unclaimable at
  validation, structurally excluded in the chain, and re-checked
  in the handler — defense in depth). Actions: tag the linked
  customer (Json append + dedupe; falls back to the linked lead —
  the outcome records the actual entity) and/or conversation;
  auto-reply in the same conversation through the registered
  inbox-reply port (sent only with a real platform message id;
  failures recorded with the real error; absent port → skipped,
  never claimed). An opted-out sender's auto-reply is skipped with
  the reason recorded; tags from their own reply still apply.
- Polls: a vote is a hit row; tallies count DISTINCT conversations
  per option with latest-vote-wins semantics.
- AI classification: classify stores an LLM suggestion via the MS9
  guard path verbatim (kill switch / daily cap; dev provider →
  honest 502). Nothing applies until a human confirms; confirming
  interest/complaint tags the conversation; confirming an opt-out
  suggestion stores the label ONLY — it never writes a
  MessagePreference (spec-pinned), because suppression belongs
  exclusively to the real STOP path.
- Delivery → Inbox bridge: broadcast deliveries gain
  `conversationId` for WhatsApp rows whose digits match a real
  ChannelConversation (batched lookup); null elsewhere. The web
  shows a 💬 link to /dashboard/inbox (no deep-link exists — see
  NOT BUILT).
- Web: Keyword Campaigns section (rules, poll editor + tally bars,
  hits with per-action outcomes and AI confirm/dismiss).
  New specs: 22 (messaging) + 6 (inbox hook).

## Gates (coordinator-run, serial — recorded as each finished)

- **API jest (full): 489 suites / 5,498 tests — 5,497 passed, 1
  failed.** The single failure is
  `connections/cc26-payout-automation.spec.ts` (1 test) — the known
  pre-existing payout-sweep failure, adjudicated on the untouched
  base during the GC-stack release and reproduced identically in
  MB1's full run (483 suites / 5,430 tests, same single failure).
  MB2 touches no connections code. Run method: every suite executed
  exactly once, grouped by top-level `src/` directory (61 groups),
  serially (`--runInBand`), jest cache on the workspace disk,
  `NODE_OPTIONS=--max-old-space-size=4096` (a combined
  messaging+workflows+inbox run OOM-aborted at the default ~2 GB
  heap during MX6's scoped run — an environment limit, not a test
  failure). Delta vs MB1 is exactly the six new MB2 suites
  (mx4-journey 14, mx4-journey-engine 8, mx5-presets 11,
  mx5-scan-enrollment 7, mx6-keyword-campaigns 22, mx6-inbox-hook 6
  = 68 tests; 483+6 suites, 5,430+68 tests). The cx3-debounce
  flake did not appear in this run; its root cause remains open
  (pre-existing, not MB2's).
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Web vitest: 82 files / 703 tests, all pass** (same count as
  MB1 — MB2 added no web test files; the messaging page has no
  dedicated web spec, as in prior batches).
- **Web tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Next build (apps/web): green** — `✓ Compiled successfully`,
  static pages 93/93, `/dashboard/messaging` at 40.3 kB (MB1:
  31.5 kB — the growth is the Journeys + Keyword Campaigns
  sections).
- **Prisma validate: valid.** Migration folders on this tree:
  **216** (214 after MB1 + MX4 + MX6; MX5 added none — its
  triggers are TypeScript constants).
- **Fresh-Postgres migrate deploy: 216/216 migrations applied
  cleanly** (`All migrations have been successfully applied.`) on
  a newly created empty database; 319 public tables afterwards
  (317 at MB1 + MessagingKeywordRule + MessagingKeywordHit);
  verified in the fresh DB: `Workflow.journey` present,
  `MessageDelivery.stepRef` present, `MessageLinkClick.broadcastId`
  nullable with `workflowRunId` present, both MX6 tables present.

**Batch gate verdict: GREEN** — the only failing test in the
entire suite is the pre-existing, base-adjudicated cc26
payout-sweep failure, which predates MB1 and is untouched by MB2.

## NOT BUILT / honest limits (batch-wide)

- **Workflow-send link/open tracking + opened/clicked journey
  conditions** — pinned OFF by existing MS5/MS7 specs ("workflow
  sends are NEVER rewritten"; no pixel on workflow sends).
  MB2 did not change those pins. The schema half landed in MX4
  (MessageLinkClick.broadcastId nullable + workflowRunId) so a
  future pin-revisit needs no migration. Consequence:
  journeyOpened/journeyClicked refresh honestly computes `false`
  from real rows today and the fields are not offered as journey
  conditions.
- **Birthday preset** — no date-of-birth field on Customer or Lead;
  org-defined customFields keys are not a system guarantee.
  Surfaced as an unavailable preset with the reason, not hidden.
- **WhatsApp send step in journeys** — the engine has no WhatsApp
  step type; workflow sends are email/SMS. Journey sends also do
  not use the MX2 broadcast cascade (cascade lives on broadcasts).
- **Keyword campaigns on SMS / email / Messenger** — no SMS
  inbound path exists; email replies are not hooked into
  messaging; Messenger PSIDs match no send/preference keying (MS2
  dead-data rationale). The API refuses non-WhatsApp rule channels
  with that reason.
- **Free-drag canvas** — the journey editor is a structured visual
  flow (the engine's steps are a linear array + one branch level;
  a free x/y canvas would need a compile layer that can drift from
  the engine's real shape). `journey.layout` was not invented.
- **Real-time purchase exit** — exit-on-purchase evaluates when a
  waiting run resumes (the engine's 5-minute scan), not at the
  moment of purchase.
- **Conversation deep-link** — the inbox page has no URL parameter
  for selecting a conversation; delivery rows link to the Inbox
  itself. The inbox page was not modified (bridge-only scope).
- **Per-product replenishment intervals** — no consumption-cycle
  data exists; the preset's 21-day default is an org-editable
  fixed value and says so.
- **Scan triggers in the journey builder meta** — winback_due /
  anniversary_due / browse_abandoned are installed via presets and
  editable afterwards; the MX4 meta endpoint's trigger list is
  pinned by its spec and was not widened.
- **Poll tags/auto-replies** — v1 polls record votes only; the
  validator refuses those fields on poll rules.
- No MX4/MX6 migration has run on a real DB; no live provider
  proof exists for any MB2 feature (M30 owed). Journey sends ride
  the workflow engine's in-process 5-minute scan (leader-claimed),
  as all workflow runs do today.
