# Smart AI — SA-B12 Acceptance (Phase 2, W3: Comment Actions)

Date: 2026-10-17. Branch `smart-ai` (worktree
`ai-marketing-saas-sai`), base `c0940ad8` (SA-B11, W2 Inbox
Actions). Local commits only; nothing pushed. Plan of record:
`Smart-AI-Full-Master-Plan-2026-10-17.md` Phase 2 W3 —
"Comment Actions: hide/unhide, DM, comment থেকে lead ও
follow-up তালিকা — সব logসহ" — law L5 (Action Law).

W3 completes the comment surface of the Action Engine: every
catalog entry marked `b12` now executes through the real
staff service path with read-back verification, and two
deterministic proposers bring the comment moments that
honestly map to engine actions — a repeat spam author, and
the complaint DM follow-through the pipeline drafted but did
not send. With this batch, **every executable entry in
catalog v1 is wired** (the only non-executable entry remains
`request_refund`, proposal-only by law since SA-B10).

## Step-0 mapping (what reality actually is)

**(a) The b12 catalog entries → real staff paths.** All four
live in `SocialCommentsService` and all are Graph-first
(IN8): the platform confirms before any local state moves,
and a Graph failure throws the platform error verbatim with
the local row untouched.

| Action | Real path (what the moderation queue calls) | Verification (read-back) |
|---|---|---|
| unhide_comment | `updateCommentStatus(id, "PENDING")` — from HIDDEN, Graph `setCommentHidden(false)` first, then local | row `status === "PENDING"` |
| reply_to_comment | `sendReply(actorId, id, { replyText })` — CC27 deny gate for the acting member, Graph `replyToComment` first, then local `MANUALLY_REPLIED` + replyText + Graph reply id | status + `replyText` equals payload + `metadata.graph.replyId` present |
| send_dm_to_commenter | `sendPrivateReply(actorId, id, message)` — Graph private reply, then local flags + inbox-conversation link | `isPrivateDmSent === true` + `metadata.graph.privateReplyId` (or the linked `dmConversationId`) |
| delete_comment | `deleteComment(actorId, id)` — Graph DELETE first (`{success:true}`), then local `DELETED` + `metadata.graph.deletedAt` | status `DELETED` **and** the Graph deletion marker — a local-only flip can never verify |

Findings that shaped the wiring:

- **`sendPrivateReply` carries its own precondition**: Meta
  allows ONE private reply per comment, and the service
  refuses up front when `isPrivateDmSent` is already set. The
  builder mirrors that refusal at propose time (known state),
  and the executor still meets it at execution time — a DM
  sent from the queue between proposal and approval lands as
  a FAILED proposal with the service's reason verbatim,
  never a second send (spec-proven).
- **The engine's actor is the approver.** `sendReply` /
  `sendPrivateReply` / `deleteComment` take an `actorId` (the
  CC27 deny gate and the audit read it). The engine passes the
  approving member's id — the human who approved IS the acting
  member, so the deny gate keeps its exact staff meaning.
  `updateCommentStatus` takes no actor (pre-existing shape).
- **`reply_to_comment`'s text source**: the catalog's B10
  note imagined the SA-B8 grounded compose as the text source.
  In the shipped wiring the payload carries the exact
  approved text (staff-written, or a later proposer's draft),
  and the SA-B8 discipline enters as the **execution-time
  number guard** (Item 1) — the autopilot compose itself
  remains the autopilot's own path, unchanged.

**(b) The comment pipeline's decision points — and what it
already does itself.** (The B11 honesty rule: propose only
acts not already performed.)

- **Classifier SPAM** (`CommentClassifier`, keyword verdicts)
  with `autoHideSpam` on → the comment is set HIDDEN at
  ingest and the Graph auto-hide is attempted immediately
  (outcome recorded on `metadata.graphHide`). *Hide is
  performed* → never proposed. **Delete is never performed**
  by the pipeline → Trigger E's scope.
- **Number-guard block** (SA-B8) → the model's reply is not
  posted; the comment stays PENDING in the moderation queue
  with `metadata.graph.guardBlocked` stamped and a
  `social_comments.guard_rejected` audit written. → Trigger
  D's decision point (Item 2).
- **COMPLAINT intent** → the humanizer's public reply is the
  DM-invitation case ("অর্ডার নম্বরটি ইনবক্সে জানান"), and
  its plan drafts a private follow-up DM
  (`aiPlan.privateDmText`, stored on the row). The pipeline
  sends that DM in the same pass ONLY when the org's
  `sendPrivateDm` setting is on and the Graph attempt
  succeeds. When it does not go out, the follow-through W3
  names ("DM … follow-up") is genuinely missing →
  Trigger F's scope.
- **PRICE_QUERY / PRODUCT_INFO / BARGAIN** → a CRM lead is
  created at ingest (the plan's "comment থেকে lead" — already
  a pipeline act since before this program; recorded, not
  re-built).
- **No comment-side author-block exists** — neither in
  `SocialCommentsService` nor in the catalog. Trigger E
  therefore proposes delete only; no block was invented.

## Item 1 — Executors + verifiers (commit `fac161e6`)

All four register in `ActionExecutorsService` in the
B10/B11 style: builder validates the target org-scoped and
renders the exact Bengali title/preview (executing nothing);
executor calls the real staff method; verifier re-reads the
row (table above). Builder refusals follow the reference
pattern, in plain language: unhide a non-HIDDEN comment,
reply/DM on a DELETED comment, DM when one was already sent,
delete an already-DELETED comment, missing/over-long text
(1000 chars — the SA-B8 compose cap, mirrored for both
text-carrying entries).

**The execution-time number guard (reply_to_comment).** An
approval can age — the approved text was grounded against
the facts of its moment. The executor therefore re-runs the
SA-B8 guard BEFORE posting, via a new public method on the
staff service itself, `SocialCommentsService
.checkCommentReplyGuard(orgId, commentId, replyText)`, which
re-assembles the fact set exactly as the grounded compose
does (Org Brain context for the comment, audience-filtered,
plus the LIVE matched product's lines through
`buildCommentFacts` — which never includes the commenter's
own memory facts, so the check runs over public facts only,
the L3 rule) and returns every number in the candidate text
the fresh fact set does not support. Any unsupported number
→ the executor throws the guard reason (numbers named) →
the engine records a FAILED proposal and **nothing is
posted** (spec-proven with a price that moved 1250 → 1350
between proposal and approval). A text with no numbers
passes trivially — the compose guard's own semantics.

## Item 2 — Comment proposers (commit `5f996743`)

**Dedupe generalised (engine).** B11's open-proposal dedupe
keyed on `conversationId`; comment proposals have no
conversation. `propose()` now also dedupes on the payload's
`commentId` when no conversation target exists, and
`sameProposalPayload` compares, per comment target, the text
for the two text-carrying actions (`reply_to_comment`:
`replyText`; `send_dm_to_commenter`: `message`) — the same
comment with a different text is a different proposal,
mirroring B11's tag-set rule. Conversation-action behaviour
is unchanged (spec suites B10/B11 green, below).

**Transport: the event bus** (the B11 pattern).
`SocialCommentsService` gains the global `EventsService` as
an appended `@Optional()` constructor param — the exact
InboxService discipline — and only ever EMITS;
`CommentActionProposerService` (leaf ActionEngineModule)
subscribes. No DI cycle, every emit try/catch-isolated.

- **Trigger E — repeat spam author → propose
  `delete_comment`.** Ingest announces `comment.spam_flagged`
  whenever the classifier's verdict is SPAM and an
  `authorSocialId` exists. The proposer counts the author's
  SPAM-classified rows in the org (row count, so a webhook
  redelivery of the same comment does not inflate it) and,
  at **`REPEAT_SPAM_AUTHOR_THRESHOLD = 3`** (a named constant
  on the proposer — no moderation setting exists for repeat
  offenders; `SocialReplySetting` carries `bannedKeywords` /
  `autoHideSpam` only), proposes deleting the newest spam
  comment, sourceRef naming the trigger, author and count.
  Without a social id there is no reliable "same author"
  (names are neither unique nor stable) — the trigger stays
  silent. `delete_comment` is high-risk: even an org at L2
  never auto-executes it (spec-proven). Known limit, stated
  plainly: after a rejection, a *later* spam comment from the
  same author (or a webhook redelivery re-announcing one)
  re-fires the count check and may propose again for the new
  comment — that is the trigger working as designed, and
  dedupe still prevents duplicates for the same comment
  while a proposal is open.
- **Trigger F — complaint DM follow-through → propose
  `send_dm_to_commenter`.** Emitted from BOTH reply-fire
  sites (`attemptInstantGraphReply`, and
  `applyDueCommentReply` for single-comment fires only — a
  batch's plan text is a composite, so its drafted DM is not
  one commenter's follow-up text) via
  `emitCommentDmFollowup`, when ALL hold: the posted reply's
  intent is COMPLAINT (the pipeline's one true "personal
  matter — take it private" case, per the humanizer's
  complaint branch), a drafted `privateDmText` exists, and no
  DM was sent in the pass (setting off, or the Graph attempt
  failed with its error already recorded on the comment).
  The proposal's message is **the plan's own drafted text**
  — nothing is authored by the proposer. Preview discipline
  (L3): the preview quotes the author name, the public
  comment and the DM text; the DM text itself asks the
  customer for THEIR details and contains none of the
  commenter's stored facts (no memory, no order data exists
  in this path — spec asserts the drafted text rides the
  payload verbatim). Scoping record: generic order-status
  phrasing under other intents is deflected publicly by the
  SA-B8 compose's prompt rule — an LLM behaviour, not a
  deterministic signal — and is deliberately NOT a trigger;
  Trigger F stands on the classifier's deterministic
  COMPLAINT verdict only.
- **Trigger D — guard-blocked reply → NOT WIRED, by
  decision.** Three reasons, from reality: (1) the blocked
  comment already sits PENDING in `listComments` — the
  moderation queue IS the human path, with the rejection
  recorded on the row (`metadata.graph.guardBlocked`) and in
  audit (`social_comments.guard_rejected`); a second queue
  for the same human task is the noise the brief warns
  against. (2) A `reply_to_comment` proposal must carry
  executable text; the only grounded candidate — the model's
  reply — is precisely what the guard rejected for invented
  numbers, and this batch's execution-time guard would
  reject it again: the proposal would be designed to fail.
  (3) The remaining candidate text, the humanizer fallback,
  is pre-Brain platform copy whose canned numbers SA-B8
  deliberately left outside the guard; importing it into the
  guarded engine path would smuggle unguarded numbers in
  through the side door. Staff answer guard-blocked comments
  from the moderation queue, as they do today.

## Item 3 — Specs (commit `d5f3c402`)

`ai/actions/sa-b12-comment-actions.spec.ts` — **24/24 pass:**

- Executors (13): unhide happy path (Graph `is_hidden:false`
  + read-back) + non-HIDDEN builder refusal + Graph refusal
  FAILED-verbatim with the row left HIDDEN; reply happy path
  (Graph-first, status/text/Graph-id verified) + **stale-price
  guard failure (1250 → 1350 after approval): FAILED with the
  guard reason, zero Graph posts, row untouched** + Graph
  refusal verbatim + DELETED/foreign-org builder refusals;
  DM happy path (flag + Graph id verified) + already-DM'd
  builder refusal + the propose→approve race (DM sent
  meanwhile → FAILED verbatim, no second Graph send);
  delete happy path (status AND Graph marker read back) +
  Graph refusal FAILED-verbatim with the row NOT dressed as
  deleted; the B10 hide reference regression alongside.
- Dedupe (2): same delete proposal twice → the open row
  returned (`deduped`), rejection frees re-proposal;
  reply dedupe is text-aware (same text dedupes, different
  text is a new proposal).
- Trigger E (5): through the REAL ingest path — silent at 1
  and 2, fires at 3 (proposal shape, sourceRef count, the
  auto-hide itself untouched and never re-proposed), a 4th
  spam comment proposes for THAT comment; handler re-fire
  deduped; silent without `authorSocialId`; **L2 never
  auto-executes the high-risk delete**; L0 creates no rows.
- Trigger F (4): through the REAL ingest reply path — fires
  when the drafted DM was not sent (setting off), the payload
  carries the row's own `privateDmText` verbatim, approval
  executes the follow-through DM for real; silent when the
  pipeline's DM was sent (setting on); silent for a
  non-complaint comment; handler-level blank-text and L0
  silence.
- **B10 suite evolved, not weakened** (same commit): the
  catalog-integrity spec now requires b10+b11+b12 fully
  registered; the not-wired refusal test exercises the
  engine branch by removing a registration inside its own
  test instance (no production entry remains unwired); the
  L2-medium gate test's premise comment is refreshed (it
  replaces `reply_to_comment`'s registrations in-instance to
  isolate the engine gate — per-instance maps, production
  wiring proven by the integrity spec and this suite).
  B10: **18/18 pass**. B11: **20/20 pass** (dedupe
  generalisation is behaviour-preserving for conversations).

## Gates (strictly serial, recorded as each finished)

| Gate | Result |
|---|---|
| New B12 specs (`sa-b12-comment-actions.spec.ts`) | **24/24 pass** |
| B10 + B11 regression (run together, serially after) | **38/38 pass** (18 + 20) |
| Targeted jest (`ai + inbox + social + automation`, 4096 heap, runInBand) | **148 suites / 1735 tests — all pass** (SA-B11 baseline 147/1711; the delta is exactly this batch's new suite, +1/+24 — includes the SA-B8 comment suites and the CX3 suites, all green) |
| API tsc (`tsc --noEmit`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** (proposer + executors compiled into `dist/ai/actions/`) |
| Fresh-PG (throwaway local PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **228/228 migrations applied, 0 unfinished** — NO new migration in this batch (executors, dedupe and triggers are logic only), exactly as briefed; `vector` extension 0.6.0 verified present; the throwaway cluster was dropped afterwards |

No failures occurred in scope, so no base comparison was
needed. The known out-of-scope items stand as before: the
`cc26` wallet-sweep failure lives in `connections/` (not in
this run's pattern set, untouched by this diff, base-proven
pre-existing at SA-B3), and the pre-existing TelegramClient
boot block is unchanged and not this batch's.

## Commits (one per item, local only)

| Commit | Item |
|---|---|
| `fac161e6` | Item 1: the four b12 comment executors + `checkCommentReplyGuard` on the staff service |
| `5f996743` | Item 2: engine comment-target dedupe + `CommentActionProposerService` + bus emits in `SocialCommentsService` |
| `d5f3c402` | Item 3: B12 specs (24) + B10 integrity-spec evolution |
| (this doc) | Acceptance record |

Final HEAD is recorded in the delivery report; the tree is
clean at close.

## NOT BUILT (named)

- **Control Center UI = SA-B13 (W4)** — module on/off,
  autonomy screens, proposal approval screens, and with it
  the Phase-2 close-out. Until then, comment-action proposals
  are approved/rejected through the SA-B10 APIs
  (`POST organizations/:organizationId/ai/actions/proposals/
  :id/approve|reject`); no web changes in this batch.
- **Trigger D (guard-blocked reply proposals)** — decided
  against with the three recorded reasons in Item 2; the
  moderation queue remains the human path for guard-blocked
  comments.
- **A comment-side author block** — no such action exists in
  the service or the catalog; none was invented for
  Trigger E.
- **Guard-at-execution for the autopilot's own sends** — the
  SA-B8 compose already guards its own texts at compose time;
  this batch's guard addition covers the ENGINE's reply path
  only.
- **Comment-thread conversation mining** — unchanged from
  SA-B8's record (not a W3 item).
- **Live verification** — no real Meta Graph call, no real
  comment, no migration on the real DB. Real Graph comment
  actions under a real org are M30, still owed. The
  pre-existing TelegramClient boot block on this line is
  unchanged and still owed at integration (not this batch's).
