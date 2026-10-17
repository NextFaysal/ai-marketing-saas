# Smart AI — SA-B10 Acceptance (Phase 2, W1: Action Engine core)

Date: 2026-10-17. Branch `smart-ai` (worktree
`ai-marketing-saas-sai`), base `47cf7f55` (SA-B9, Phase 1
closed). Local commits only; nothing pushed. Plan of record:
`Smart-AI-Full-Master-Plan-2026-10-17.md` Phase 2 W1, law L5
(Action Law), decision D5 (autonomy default L1; L3 never
without a separate owner decision).

W1 gives the Smart AI its hands — under law: one catalog of
everything it may DO, an autonomy matrix per org per action,
and one pipeline (propose → approve → execute → verify) in
which every act runs through an existing real service path,
is verified from the actual operation before success is
claimed, and leaves a full audit trail. Failures are recorded
as failures. Money never moves through this engine.

## Step-0 inventory (what already existed)

**(a) Proposal/audit rails — Milestone 47.** `AIActionProposal`
(proposed | approved | rejected | executed | failed) +
`ProposalsService`: proposals validate targets against real
rows and store an exact preview; approval claims the row with
a conditional `updateMany` from `proposed` (exactly-once),
executes through confirmed service paths (CampaignsService,
MessagingService, ProductsService…), and records failure as
failure with the platform error verbatim. Every transition
writes an `AuditLog` row (global `AuditService`) and an
`AIAction` row. AP7 added a precedent this batch generalises:
an org-level autonomy setting auto-approves internal-only
types through the same approve() path. `AIProactiveSetting
.autonomyLevel` (M47 types only) is a different setting and
is untouched.

**(b) Staff action surfaces.** Inbox: every staff mutation
funnels through `InboxService.updateConversation` (status
open/pending/closed, `assignedUserId`, `tags`, `spamFlag`,
pipeline/outcome) plus `InboxService.setConversationBlocked`
(block/unblock sender). Comments:
`SocialCommentsService.updateCommentStatus` (hide/unhide,
Graph-first — the platform confirms before the local status
moves), `sendReply`, `sendPrivateReply` (one DM per comment,
Meta rule), `deleteComment`, `assignComment`. **Conversation
priority has NO staff-facing setter** — it is written only by
classification/escalation internals — so the draft catalog's
`set_conversation_priority` has no real service path and is
dropped from catalog v1 (below), not invented.

**(c) Audit patterns.** `AuditService.log` (global module) +
the `AIAction` table — the same pair ProposalsService uses.

**(d) Settings homes.** Per-org AI settings live in
`AIProactiveSetting` (M48) and Brain toggles on
`BusinessProfile` (SA-B4). Autonomy per catalog action is a
new, separate concern and gets its own table (below).

## Reuse decision — EXTEND, never duplicate

`AIActionProposal` is extended with additive nullable columns
(migration `20261031000000_sai_actions`): `actionId`,
`surface`, `proposedBy`, `autonomyLevel` (snapshot at
proposal time), `sourceRef`, `verification`; plus one index
`(organizationId, actionId, status)`. `userId` relaxes to
nullable because an AI-proposed row has no human proposer —
`proposedBy` records the truth (`ai` | `staff`) instead of a
fabricated user. Legacy M47 rows keep every value; all new
columns are null on them, and the legacy list/approve flow is
untouched (the engine filters its own rows with
`actionId != null`, and cross-flow ids 404). The one new
table is `AiAutonomySetting` (unique per org+action). The
transient status `executing` joins the proposal lifecycle
(the approved→executing claim is what makes concurrent
execution impossible).

## Item 1 — Action Catalog v1 (`ai/actions/action-catalog.ts`)

12 typed entries: `{ id, surface, title {bn,en}, riskClass,
moneyAdjacent, executorKey, verifierKey, payloadSummary,
undoable, wiring }`. Each maps to a real service method found
in Step 0:

| Action | Surface | Risk | Path (existing) | Wiring |
|---|---|---|---|---|
| assign_conversation | inbox | low | updateConversation {assignedUserId} | b11 |
| tag_conversation | inbox | low | updateConversation {tags} (merge) | b11 |
| close_conversation | inbox | low | updateConversation {status: closed} | **b10** |
| reopen_conversation | inbox | low | updateConversation {status: open} | b11 |
| mark_conversation_spam | inbox | medium | updateConversation {spamFlag: true} | b11 |
| block_sender | inbox | medium | setConversationBlocked {blocked: true} | b11 |
| request_refund | inbox | high | — none, by law — | **never** |
| hide_comment | comment | low | updateCommentStatus(HIDDEN) | **b10** |
| unhide_comment | comment | low | updateCommentStatus(PENDING) | b12 |
| reply_to_comment | comment | medium | sendReply | b12 |
| send_dm_to_commenter | comment | medium | sendPrivateReply | b12 |
| delete_comment | comment | high | deleteComment (irreversible) | b12 |

Dropped from the draft list, with reason: **set_conversation
_priority** (no staff-facing setter exists — Step 0b).
Added from Step 0 evidence: **delete_comment** (a real staff
action; high risk, irreversible). `request_refund` is the
catalog's money-adjacent entry: `moneyAdjacent: true`,
`executorKey: null` — the L5 wall is data, not a comment.

## Item 2 — Autonomy + engine (`ai/actions/action-engine.service.ts`)

- **Levels (D5).** Absent `AiAutonomySetting` row = level 1.
  L0: `propose()` refuses with a typed result
  (`autonomy_off`), creates no row, and audit-logs the
  refusal. L1: execution requires a recorded human approval —
  a direct `execute()` on a proposed row returns typed
  `approval_required`. L2: auto-executes ONLY `riskClass:
  "low"` entries, through the same claim + verify pipeline,
  with the approval audit-marked `autonomous: true` (the AP7
  precedent); medium/high behave as L1. L3: `setAutonomy`
  rejects it with a Bengali explanation AND an audit row
  (`ai.action_autonomy_rejected`, reason
  `level_3_requires_separate_owner_decision`); nothing is
  stored.
- **Lifecycle.** propose (builder validates the target
  org-scoped and renders the exact title/preview — executing
  nothing) → approve claims `proposed → approved`
  (conditional updateMany) → execution claims
  `approved → executing` → the registered executor runs the
  existing service path → the registered verifier re-reads
  the real state → `executed` (result outcome
  `verified_success`) or `failed`. A second approve throws
  "already decided" (M47 discipline); a second execute on a
  terminal row is a no-op returning the recorded outcome.
- **Verification wall.** Executor success + verifier
  disagreement = status `failed`, error
  `verification_mismatch`, result outcome
  `verification_mismatch`, verifier detail stored on the row.
  Success is never recorded unverified.
- **Money wall.** `execute()` refuses money-adjacent entries
  at every level (typed `money_adjacent_proposal_only`);
  `approve()` on one records the decision, stamps result
  outcome `proposal_only`, and the row stays `approved` — it
  can never become `executed` through this engine. L2 never
  auto-executes them either (money check precedes risk check
  in propose()).
- **Audit.** AuditLog + AIAction rows for propose (and
  propose-refusals), approve (incl. autonomous), reject,
  executed, failed — tool name `engine.<actionId>`, phase in
  args, mirroring ProposalsService's `logAiAction`.
- **APIs** (`ActionEngineController`,
  `organizations/:organizationId/ai/actions`, TenantGuard +
  RolesGuard + PermissionArea("ai")): `GET catalog`,
  `GET autonomy`, `PUT autonomy/:actionId` (OWNER/ADMIN —
  inbox-settings discipline), `GET proposals?status=`,
  `POST proposals`, `POST proposals/:id/approve|reject`
  (OWNER/ADMIN/MARKETING_MANAGER — M47 proposal discipline).
- **Module.** A leaf `ActionEngineModule` imports
  InboxModule + OrgBrainModule and is registered only in
  AppModule — no cycle is possible (InboxModule imports
  neither AiModule nor this module). AiModule and its M47
  ProposalsService are untouched.

## Item 3 — Reference actions end-to-end

- **close_conversation**: builder (org-scoped conversation
  read; already-closed refused) → executor
  `InboxService.updateConversation(..., { status: "closed" })`
  — the exact staff path, CSAT side-effect included → verifier
  re-reads `ChannelConversation.status === "closed"`.
- **hide_comment**: builder (org-scoped comment read;
  already-hidden refused) → executor
  `SocialCommentsService.updateCommentStatus(..., "HIDDEN")`
  — Graph-first, the platform confirms before local state
  moves → verifier re-reads `SocialComment.status ===
  "HIDDEN"`.
- **request_refund**: builder only (validates conversation /
  optional order, renders the proposal-only preview). No
  executor or verifier exists for it — by law.

Specs drive both reference actions through the REAL service
layer against fixture rows (the Graph client is stubbed in
the spec only — the SA-B8 pattern; production executors are
the real paths).

## Item 4 — Specs (`ai/actions/sa-b10-action-engine.spec.ts`, 18/18)

- Pipeline: propose-executes-nothing, approve → executed +
  verified (close + hide), audit phases proposed/approved/
  executed present in both AuditLog calls and AIAction rows.
- Exactly-once: double approve + execute → executor called
  once, one executed AIAction row, recorded outcome returned.
- Autonomy: L1 direct-execute refusal; L0 typed refusal +
  no row + refusal audit; L2 auto-executes low-risk (with
  autonomous approval audit, `decidedById` null for an AI
  proposer); L2 does NOT auto-execute a medium-risk entry
  (engine gate exercised via test-registered wiring on the
  real `block_sender` catalog entry — production maps are
  untouched, proven by the integrity spec); L3 rejected +
  audit-logged + nothing stored; settings are per-org.
- L5 wall: request_refund approve → `proposal_only`, stays
  `approved`, `execute()` refused, never `executed`; at L2
  it does not auto-execute.
- Honest failure: a spec-only lying executor → FAILED with
  `verification_mismatch` (observed status recorded); a Graph
  refusal on hide → FAILED with the error verbatim, comment
  left PENDING.
- Isolation/validation: org B approve/reject/execute/list on
  org A's proposal all 404/empty and the row is untouched;
  unknown action / missing target / foreign target /
  already-closed target all refused; unwired b11 actions
  refuse with typed `action_not_wired` and create no row.
- Catalog integrity: b10 entries fully registered; b11/b12
  entries declare keys with nothing half-registered;
  money-adjacent entries have no executor; the dropped
  `set_conversation_priority` stays absent.

## Gates (strictly serial, recorded as each finished)

| Gate | Result |
|---|---|
| New specs (`sa-b10-action-engine.spec.ts`) | **18/18 pass** |
| Targeted jest (`ai + inbox + social + automation + connections + knowledge + campaigns`, 4096 heap, runInBand) | **210 suites / 2350 tests — 2349 pass**. The one failure is `connections/cc26-payout-automation` (wallet sweep slot-day) — pre-existing, base-proven at SA-B3 on the pristine base (identical solo shape), re-recorded at SA-B8/B9; this batch's diff touches zero connections/wallet files |
| API tsc (`tsc --noEmit`) | **exit 0** (the `userId` nullable relaxation produced no fallout anywhere) |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** (engine compiled into `dist/ai/actions/`) |
| Fresh-PG (throwaway local PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **228/228 migrations applied, 0 unfinished** (base 227 + `20261031000000_sai_actions`); `AiAutonomySetting` table + its `(organizationId, actionId)` unique index verified in the catalog; all 6 new `AIActionProposal` columns present; `userId` nullable verified; `vector` extension 0.6.0 present; **live proof**: a duplicate `(organizationId, actionId)` insert is rejected by the unique constraint on the real migrated DB; the throwaway cluster was dropped afterwards |

Every gate ran strictly serially, each recorded here as it
finished.

## Commits (one per item, local only)

| Commit | Item |
|---|---|
| `b77689c5` | Item 2 schema: `AiAutonomySetting` + `AIActionProposal` engine extension, migration `20261031000000_sai_actions` |
| `895e6f8e` | Item 1: Action Catalog v1 (12 entries) |
| `e633319b` | Items 2+3: engine + executors (reference actions) + APIs + leaf module wiring |
| `95eb29e9` | Item 4: specs (18 tests) |
| (this doc) | Acceptance record |

Final HEAD is recorded in the delivery report; the tree is
clean at close.

## NOT BUILT (named)

- **Full inbox action wiring = SA-B11** (assign / tag /
  reopen / spam / block builders+executors+verifiers; the AI
  callers that propose from conversations).
- **Comment action wiring = SA-B12** (unhide / reply / DM /
  delete; SA-B8's grounded compose as the reply text source).
- **Control Center UI = SA-B13 (W4)** — module on/off,
  autonomy screens, caps, kill switch UI. This batch ships
  the APIs only; no web changes.
- **Ads actions = Phase 3** (the M47 ads proposals keep their
  own flow; cataloguing them is A2's work).
- **Undo execution** — `undoable` is catalog metadata in v1;
  no engine undo path is built.
- **A dedicated `decide()` HTTP route** — approve/reject
  routes are the decision surface; `decide()` exists on the
  service for B11/B12 callers.
- **Live verification** — no real Meta Graph call, no real
  conversation, no migration on the real DB. M30 still owed.
  The pre-existing TelegramClient boot block on this line is
  unchanged and still owed at integration (not this batch's).
