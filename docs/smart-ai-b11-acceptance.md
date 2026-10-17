# Smart AI — SA-B11 Acceptance (Phase 2, W2: Inbox Actions)

Date: 2026-10-17. Branch `smart-ai` (worktree
`ai-marketing-saas-sai`), base `af794ee0` (SA-B10, W1 Action
Engine). Local commits only; nothing pushed. Plan of record:
`Smart-AI-Full-Master-Plan-2026-10-17.md` Phase 2 W2, law L5.

W2 gives the engine its inbox hands and its first proposers:
every catalog entry marked `b11` now executes through the
real staff service path with read-back verification, and
three deterministic triggers propose actions from real inbox
moments — the AI proposes, the engine (autonomy, dedupe,
approval, verification, audit) decides. No LLM invents
actions anywhere in this batch.

## Step-0 mapping (what reality actually is)

**(a) The b11 catalog entries → real staff paths.**

| Action | Real path (what the dashboard calls) | Verification (read-back) |
|---|---|---|
| assign_conversation | `InboxService.updateConversation({ assignedUserId })` | `conversation.assignedUserId` equals the payload value (incl. null = unassign) |
| tag_conversation | `InboxService.updateConversation({ tags: merged })` | every normalized added tag present in `conversation.tags` |
| close_conversation | *(SA-B10 reference — regression only in this batch)* | — |
| reopen_conversation | `InboxService.updateConversation({ status: "open" })` (clears `resolvedAt` itself) | `status === "open"` |
| mark_conversation_spam | `InboxService.updateConversation({ spamFlag: true })` | `spamFlag === true` |
| block_sender | `InboxService.setConversationBlocked({ blocked: true, reason? })` | `blockedAt != null` |

Findings that shaped the wiring:

- **mark_spam and block_sender are TWO actions, not one.**
  Marking spam only raises `spamFlag` (thread lands in the
  spam queue). `setConversationBlocked` stamps `blockedAt`,
  records who/why, stops ALL automation for the thread — and
  raises `spamFlag` as its own side effect so the blocked
  thread shows in the same queue. Catalog confirmed as-is.
- **Tags have no registry.** A conversation's tags are a
  free-form `string[]`; the inbox's ONLY rules are
  `normalizeTags` (trim, 30 chars, case-insensitive dedupe,
  max 10), applied inside `updateConversation` on write. The
  builder normalizes with that same function, drops tags the
  thread already has (refusing when nothing fresh remains),
  and the executor merges into the current set — exactly the
  merge the catalog promised in SA-B10.
- **Assignee validation lives inside the staff path.**
  `updateConversation` itself refuses a non-member
  ("Assignee is not a member of this organization") before
  writing anything. The builder therefore validates shape
  only and does NOT invent a parallel membership rule: a
  bad assignee produces a proposal that FAILS at execution
  with the service's error verbatim — a recorded failed
  outcome, not a crash, and the assignment never happens.
  (The builder does look the membership up for the preview,
  and warns the human in plain language when the assignee is
  not a current member.)

**(b) Where proposals naturally originate (intelligence flow).**

- **Order bot completion — the one real resolution signal.**
  When the bot's confirm step creates the order
  (`createChatOrder`), the session is stamped `completed`.
  The thread itself stays open (the team still calls to
  confirm) — so "the matter is settled, the thread can close"
  is a true, close-worthy moment that has NOT already closed
  anything. → **Trigger A.**
- **CSAT capture is NOT a close signal.** `csatSentAt` is set
  only by the close path in `updateConversation`, so a CSAT
  reply presupposes an already-closed thread — proposing a
  close there would be refused by the builder (already
  closed) every time. Recorded, not wired.
- **COD confirmation** resolves an order's COD state, not the
  conversation. Not a close signal. Recorded, not wired.
- **The autopilot never marks anything resolved** (it answers
  or escalates). **Escalation** (`escalateAutopilot`) raises
  priority and notifies humans, but no catalog action honestly
  maps to it — choosing an assignee for it would invent
  policy (the escalation team is a settings concept, not a
  catalog target). Mapped, deliberately not wired.
- **Spam detection** (`detectSpam` in
  `processInboundIntelligence`, before bot/autopilot):
  heuristic verdicts (same message 3+× in 10 min; first-message
  promo link) write `spamFlag: true` + `spamReason` DIRECTLY
  and skip automation for the message. It flags — it never
  blocks, never closes. → **Trigger B** scope is exactly the
  step the detector does not take (see Item 2).
- **suggestNextAction (IN7)** is a staff-invoked read
  (`GET …/next-action`): it parses the model's JSON strictly
  against a closed allowlist (`share_tracking`, `cod_confirm`,
  `create_order`, `wait_customer`, `reply_manually`,
  `resolve`) plus `tags[]` and `pipelineStage`, and returns
  `{ proposal, provider, reason? }` — historically persisting
  nothing. Catalogued mappings: `resolve` →
  close_conversation; `tags` → tag_conversation.
  `pipelineStage` and the other five actions have NO catalog
  entry → no engine proposal is created for them (recorded;
  adding catalog entries is a W1 amendment, not B11 wiring).

**(c) Plan W2's wider wording** ("follow-up, lead তৈরি/tag,
courier সহায়তা") names capabilities that have no catalog
entries in W1's shipped catalog v1. This batch wires exactly
the catalog's `b11` set + `request_refund` (already
proposal-only since B10) and invents nothing beyond it.

## Item 1 — Executors + verifiers (commit `f2217c5c`)

All five register in `ActionExecutorsService` in the B10
style: builder validates the target org-scoped and renders
the exact Bengali title/preview (executing nothing);
executor calls the real service; verifier re-reads the row.
Builder refusals follow the reference pattern (already-open
reopen, already-flagged spam, already-blocked sender,
already-present tags — each a plain-language BadRequest).
`close_conversation` is regression-covered by the B10 suite
plus the trigger specs below.

## Item 2 — AI proposers (commit `557ce725`)

**Dedupe (engine-level, in `propose()`).** After the builder
runs, if an identical proposal is still OPEN (`proposed`) for
the same (organizationId, actionId, conversationId) — with
the normalized tag set also compared for tag_conversation,
since different tags are a different proposal — the existing
row is returned (`deduped: true`) and nothing is created.
Terminal rows never block: after a rejection, the same
trigger proposes afresh (spec-proven). Check-then-create, no
schema change (hence no migration); execution exactly-once
still rests on the engine's claim pipeline, not on this
check. Known limit, stated plainly: two truly simultaneous
fires could both pass the check and create two open
proposals — harmless duplicates in one approval queue, each
still executable exactly once; no path executes twice.

**Trigger transport: the event bus.** InboxService already
announces workflow events on the global `EventsService`;
this batch adds three announcements at the exact moments
(try/catch-isolated like every neighbouring emit — a failure
can never affect message handling):
`conversation.bot_order_completed`,
`conversation.spam_flagged` (only on the detector's fresh
flag write, never on its already-flagged early return),
`conversation.next_action_suggested` (only for a validated
proposal). `InboxActionProposerService` (in the leaf
ActionEngineModule) subscribes in `onModuleInit` and calls
`engine.propose(proposedBy: "ai", actorUserId: null)` —
InboxService gains NO dependency on the engine, so B10's
no-cycle discipline holds, and expected builder refusals
(stale targets) are swallowed by design inside the handlers.

- **Trigger A** — bot completion → propose
  `close_conversation`, sourceRef `{ trigger:
  "order_bot_completed", orderId }`.
- **Trigger B** — fresh spam flag → propose `block_sender`
  (the detector's reason rides along). **Honesty record:**
  the detector's own flag write happens outside the engine
  (pre-existing behaviour, unchanged); `mark_conversation_spam`
  is deliberately NOT proposed here, because an engine
  proposal for an act already performed would be a duplicate
  record, not a proposal. The engine path for that action
  exists for proposals from other surfaces.
- **Trigger C** — suggestNextAction bridge: `resolve` →
  `close_conversation` proposal; non-empty `tags` →
  `tag_conversation` proposal (sourceRef names
  `next_action_suggested` + the AI's reason). **The response
  contract is byte-identical** — same shape, same values;
  the method's header comment was updated so the code tells
  the truth about the additional record. Nothing is executed
  by the suggestion itself: at L1 the proposals wait like
  any other; at L2 an org has explicitly opted into
  auto-executing low-risk actions.

## Item 3 — Specs (commit `05252656`)

`ai/actions/sa-b11-inbox-actions.spec.ts` — **20/20 pass:**

- Executors (9): assign happy path + read-back; unassign;
  non-member assignee → FAILED with the service's verbatim
  error, assignment never made, preview had warned; tag
  merge/normalize with existing tags preserved; builder
  refusal for already-present tags; reopen (+ `resolvedAt`
  cleared) and open-thread refusal; mark-spam + flagged
  refusal; block (+ its spamFlag side effect) + blocked
  refusal; cross-org builder 404s.
- Dedupe (3): same trigger twice → one open proposal
  (returned, flagged); rejected → fresh proposal allowed;
  tag-set-aware dedupe (case-insensitive same set dedupes,
  different set does not).
- Proposers at handler level (4): Trigger A proposal shape +
  re-fire dedupe; Trigger A autonomy interplay — **L2
  auto-executes + verifies the close, L0 creates no rows**;
  Trigger B proposal + approval blocking through the real
  path; Trigger C mapping + non-catalogued action → none.
- Proposers through the REAL inbox paths over the bus (4):
  `detectSpam` flag → exactly one block proposal, already-
  flagged re-run adds none, benign text none; bot confirm
  step (real `botStep` completion bookkeeping; order
  creation/send stubbed at the instance edge — their own
  pipelines have suites) → session `completed` + close
  proposed, thread open; `suggestNextAction` with a fake
  real-LLM provider → response contract asserted unchanged
  AND both proposals recorded, repeat call deduped, nothing
  executed; a full ordinary `processInboundIntelligence`
  dispatch proposes nothing.
- **B10 suite evolved, not weakened** (same commit): the
  catalog-integrity spec now requires b10+b11 entries fully
  registered and b12 entries unregistered; the not-wired
  refusal test stands on `unhide_comment` (b12); the L2
  medium-risk gate test registers its test wiring on
  `reply_to_comment` (b12) instead of the now-really-wired
  `block_sender`. B10 suite: **18/18 pass**.

## Gates (strictly serial, recorded as each finished)

| Gate | Result |
|---|---|
| New B11 specs (`sa-b11-inbox-actions.spec.ts`) | **20/20 pass** |
| B10 regression (`sa-b10-action-engine.spec.ts`) | **18/18 pass** |
| Targeted jest (`ai + inbox + automation + social`, 4096 heap, runInBand) | **147 suites / 1711 tests — all pass** (includes both suites above) |
| API tsc (`tsc --noEmit`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** (engine + proposer + executors compiled into `dist/ai/actions/`) |
| Fresh-PG (throwaway local PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **228/228 migrations applied, 0 unfinished** — NO new migration in this batch (dedupe + triggers are logic only), exactly as briefed; `vector` extension 0.6.0 verified present; the throwaway cluster was dropped afterwards |

No in-scope failures occurred, so no base-comparison was
needed. The known out-of-scope items stand as before: the
`cc26` wallet-sweep failure is in `connections/` (not in
this run's pattern set, untouched by this diff, base-proven
pre-existing at SA-B3), and the pre-existing TelegramClient
boot block is unchanged and not this batch's.

## Commits (one per item, local only)

| Commit | Item |
|---|---|
| `f2217c5c` | Item 1: the five b11 inbox executors + catalog wiring note |
| `557ce725` | Item 2: engine dedupe + three event-bus emits + `InboxActionProposerService` + module wiring |
| `05252656` | Item 3: B11 specs (20) + B10 integrity-spec evolution |
| (this doc) | Acceptance record |

Final HEAD is recorded in the delivery report; the tree is
clean at close.

## NOT BUILT (named)

- **Comment action wiring = SA-B12** (unhide / reply / DM /
  delete executors; the b12 catalog entries still refuse
  proposals with typed `action_not_wired`, spec-asserted).
- **Control Center UI = SA-B13 (W4)** — module on/off,
  autonomy screens, proposal approval screens. Until then,
  proposals are approved/rejected through the SA-B10 APIs
  (`POST organizations/:organizationId/ai/actions/proposals/
  :id/approve|reject`); no web changes in this batch.
- **LLM-freeform action invention** — proposers are the
  three deterministic triggers + the IN7 suggester bridge
  only. No model output anywhere creates an action outside
  IN7's closed allowlist, and only its two catalogued items
  are bridged.
- **Escalation / pipeline-stage / COD / lead / courier /
  follow-up triggers** — mapped in Step 0, not wired: no
  catalog entry honestly maps to them in catalog v1
  (catalogue expansion is a W1 amendment decision).
- **A database-level dedupe constraint** — dedupe is
  check-then-create at the engine (see the stated limit in
  Item 2); no schema change was made for it.
- **Live verification** — no real Meta send, no real
  conversation, no migration on the real DB. M30 still owed.
  The pre-existing TelegramClient boot block on this line is
  unchanged and still owed at integration (not this batch's).
