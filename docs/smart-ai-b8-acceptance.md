# Smart AI Phase 1 — Batch SA-B8 Acceptance (R2: Comment Reply v2)

Date: 2026-10-17. Branch `smart-ai`, base `6210e0c8` (SA-B7).
Local commits only; nothing pushed.

Commits:
- `f0dd1e37` — Item 1: the CX3 debounce production-bug fix.
- `f2051839` — Item 2: Brain-grounded comment replies.
- `b60d6637` — Item 3: specs (7 tests).
- (the tip commit) — this acceptance doc.

Plan of record: `Smart-AI-Full-Master-Plan-2026-10-17.md`
Phase 1 item R2 — "Comment Reply v2: Brain-grounded comment
উত্তর (policy/FAQসহ), spam shield, DM, hide এক প্রবাহে; CX3 bug
fix শর্ত". Laws L1–L5 govern throughout.

## Step 0 — the map (brief vs code reality)

**The comment pipeline** — all in
`apps/api/src/inbox/social-comments.service.ts` (controller:
`social-comments.controller.ts`; DTOs: `social-comments.dto.ts`):

1. **Settings** — `SocialReplySetting` per org:
   `aiAutoReplyEnabled` (default true), `sendPrivateDm`,
   `autoHideSpam`, `replyDelaySeconds` (default 25),
   `tonePreference`, `bannedKeywords`, night-owl
   (`nightOwlEnabled`/`nightOwlMessage`), Telegram urgent
   alerts, `salesOrderUrl`, `freeDeliveryThresholdMinor`, and
   `updatedById` (the CC27 configuring actor the AI deny gate
   reads). A second gate reads `InboxSetting.aiScheduleByChannel`
   (CX12d channel AI schedule).
2. **Ingest** (`ingestComment`, from the Meta webhook / ingest
   DTO) — CX12d schedule gate → `buildReplyPlan` → spam/hide
   status → row upsert → Telegram alert + CRM lead creation
   (immediate) → Graph auto-hide when HIDDEN → delay-0 instant
   reply, or `aiReplyDueAt` for the sweep when a delay is set.
3. **The plan** (`buildReplyPlan`) — the ONLY compose the
   surface had: `CommentClassifier` (deterministic keyword
   classifier: spam/hide-words, complaint, competitor, bargain,
   price, delivery), a product match (name-in-text, else
   post-title keywords, over ≤20 ACTIVE products), and
   `CommentHumanizer` — deterministic Bengali templates per
   intent, with hardcoded copy (its canned delivery snippets
   quote fixed ৬০/১২০ টাকা charges regardless of the org's real
   profile). **No LLM, no policies, no knowledge documents, no
   Answer Store, no number guard anywhere in the path** — the
   "product match only" state the plan's Phase-1 note records.
4. **The sweep** (`runDueCommentReplies`, driven by the
   `comment_autoreply_sweep` automation job) — due PENDING rows
   newest-first, claimed by a conditional updateMany on the
   EXACT due timestamp; CC27 deny gate and CX12d schedule drop
   (claim already cleared the due → the comment stays PENDING
   for a human); `applyDueCommentReply` batches earlier
   same-author/same-post due comments into the latest one's
   reply (combined text ≤1200 chars), posts through the Graph
   layer FIRST (IN8: only a Graph-confirmed reply marks
   anything), discharges covered comments with `aiReplyBatchOf`
   + `metadata.aiReplyBatch`, and re-dues Graph failures 60s up
   to 3 attempts before leaving the comment PENDING.
5. **The send + DM layer** — `MetaMessagingClient` Graph calls
   (`replyToComment`, `privateReplyToComment`); the DM links an
   inbox conversation (`attemptPrivateDm`, with a context note)
   — the follow-up conversation then lives in the
   Brain-powered inbox, as the brief assumes.
6. **The moderation queue** — `listComments`, manual
   `sendReply` / `sendPrivateReply` / `deleteComment` /
   `assignComment` / `updateCommentStatus`, and
   `executeBulkAction` (AI_REPLY_ALL / HIDE_ALL /
   MARK_RESOLVED) — all Graph-first (IN8), all human-triggered.

**Commenter identity (brief item c)** — `SocialComment`
carries `authorSocialId`; the DM linker resolves the inbox
conversation as channel `instagram` for Instagram, else
`messenger`, with `externalContactId = authorSocialId` (or a
`comment:<externalCommentId>` fallback). That is exactly the
CustomerMemory key space (`<channel>:<externalContactId>`,
SA-B5), so a commenter with a social id resolves to their
memory with the same key rule the inbox fact pack uses.

## Step 0 — the CX3 record (what the bug was, in code)

The CX3 debounce shipped 2026-10-12 (docs/cx3-acceptance.md)
with due timestamps in the DB fired by 1-minute sweeps — the
durable machinery was never the problem. A root-cause
investigation the same day (recorded in
`CX3-Debounce-Root-Cause-and-Fix-2026-10-12.md`, with a
verified patch) proved a real production bug in the INBOX
path, and it was still unapplied on this branch:

1. Ingest persists the inbound `ChannelMessage` row first,
   then runs the whole intelligence dispatch (classification,
   smart assign, COD/CSAT/review/spam, order bot) and only
   then reaches the CX3 defer point in `maybeAutoReply`.
2. The defer stamped `autoReplyBatchSince: new Date()` — i.e.
   AFTER the triggering message's `createdAt`, in production
   typically by tens of ms of DB round-trips.
3. The sweep (`runDueAutoReplies`) collects the batch with
   `createdAt: { gte: batchSince }` — so the triggering
   message is excluded from its own batch. A single-message
   burst (the common case) yields an empty batch text, and
   the sweep silently discharges it: **with a reply delay on,
   a lone message's deferred auto-reply could never fire**;
   multi-message bursts lost their first message from the
   composed reply.
4. The spec's fake prisma usually lands message creation and
   the defer stamp in the same millisecond, masking the slip —
   hence the "intermittent cx3 flake" recorded by many later
   batches. Default delay is 0, so only delay-enabled orgs
   were affected — exactly the feature's users.

The comment path does NOT share the shape: its batching
claims whole comment ROWS (same author/post, `createdAt <
firing row`, due stamp still set), so the first comment is a
claimed row, never a timestamp-window casualty. Item 1
therefore fixes the inbox stamp (the verified design), and
Item 3 proves the comment batching deterministically at
burst-of-3 rather than assuming it.

## Item 1 — the CX3 fix (commit f0dd1e37)

The verified fix, adapted to current line numbers (the patch
was written against an older tree; the three target sites are
unchanged in shape):

- `processInboundIntelligence` passes the persisted message's
  own timestamp: `maybeAutoReply(..., { messageAt: message.createdAt })`.
- `maybeAutoReply` accepts `opts.messageAt`; the defer stamps
  `autoReplyBatchSince = current.autoReplyBatchSince ??
  (messageAt ? new Date(messageAt) : null) ??
  current.lastMessageAt ?? new Date()` — the batch opens at
  the triggering message, with the ingest-stamped
  `lastMessageAt` as the fallback for callers that carry no
  message (recorded in a long comment at the site, carrying
  the root cause so it is never "simplified" back).
- Scheduling stays the existing durable machinery (DB due
  timestamps + the 1-minute sweep + exact-timestamp claim) —
  no in-process timers, exactly-once unchanged.
- Regression test (from the verified patch) added to
  `cx3-debounce.spec.ts`: message + `lastMessageAt`
  deterministically 5 s old at defer time; asserts the stamp
  equals the message time and the sweep fires exactly one
  reply. **Proven both ways during this batch**: the test
  FAILS against the pre-fix service (run with the fix stashed)
  and passes with it; the full spec is 19/19.

## Item 2 — Brain-grounded comment replies (commit f2051839)

A new private compose, `composeGroundedCommentReply`, runs at
BOTH autopilot application sites — `attemptInstantGraphReply`
(ingest, delay-0) and `applyDueCommentReply` (the CX3 sweep) —
after the CC27 deny gate and before any Graph call. The DM
text, the classifier, the spam shield / auto-hide, the
Telegram alert, lead creation, the CX12d schedule behaviour
and all manual/bulk surfaces are untouched: this item changes
where the public reply TEXT comes from, nothing else.

**Facts** — an `OrgBrainService` context (audience `customer`,
or `own_customer` when the commenter resolves to a memory
key), assembled by `buildCommentFacts` the way the inbox
fact pack assembles its pack: org name, the PUBLIC profile
fact lines (delivery/payment/contact/hours), up to 5 policies
with content, the audience-filtered knowledge matches
(hybrid — policy/FAQ included), the semantic product matches
(SA-B7's surface), and the LIVE matched product's name +
formatted price from `buildReplyPlan`'s live-row match
(price/stock are never indexed — the SA-B2 rule; the match
now also carries the product id so it can be recorded as a
store source). Sources (docIds / productIds / policyIds /
profile areas) are collected in the store's shape.

**Attempt order** (the SA-B3/SA-B7 discipline):

1. **Answer Store, channel `"comment"`** — consulted before
   the model (single-comment fires only; a batched fire
   answers a composite text and the store is keyed to single
   questions). A hit serves only after the store's own live
   re-verification (inside `lookup`, SA-B3) AND the shared
   deterministic number guard (`extractGuardNumbers`, the
   inbox guard's extraction) against THIS fresh fact set — a
   guard failure retires the entry (`number_guard_failed`)
   and the compose proceeds to the model. A served hit is
   recorded as a zero-token `answer_store_hit` usage row, the
   inbox ledger discipline.
2. **The org's LLM** (`providerForOrg`, the chat stack's own
   resolution) over the Brain context: facts-only prompt
   carrying the owner instructions and the learned brand
   voice as behaviour lines with the inbox's exact labels
   ("never override the verified facts" / "shapes WORDING
   ONLY"), language by the inbox precedence (org reply
   language → detected from the comment → the customer's
   remembered language preference), `NO_ANSWER` honoured, and
   usage recorded as `comment_autopilot`.
3. **The number guard on the model's text** — every number
   must appear in the fact set. An invented number returns
   `{ blocked }`: the model's text is NOT posted, the
   humanizer plan is NOT posted as a dodge, and the comment
   stays PENDING in the moderation queue (`listComments` IS
   the human path) with `metadata.graph.guardBlocked` +
   a `social_comments.guard_rejected` audit. In the sweep the
   firing comment's due was already claimed, so it simply
   stays PENDING (the CX12d drop semantics); earlier batched
   comments keep their own due stamps and are judged on their
   own merits by a later sweep.

**Confidentiality (L3)** — a comment reply is a PUBLIC post,
and the compose is built so a customer's own facts cannot
reach it: the fact set NEVER includes
`brain.customerMemoryFacts`; the memory is resolved (the
`own_customer` audience, the DM-linking key) and contributes
ONLY its `languagePref` as a language steer. The prompt
states the rule to the model as well: personal/order
questions get a polite invitation to message the inbox,
never a request to post personal details publicly.

**Fallback honesty** — night-owl holding replies are never
overridden (the office-closed assurance is a deliberate
business behaviour carried by the humanizer plan + DM); no
Brain, no real LLM, `NO_ANSWER`, a provider error, or an
empty fact set all decline to the pre-SA-B8 humanizer plan
byte-for-byte. An org without a working LLM sees exactly
today's behaviour (spec-proven in the burst-of-3 test, which
wires no LLM at all).

**Capture** — a guard-passed, Graph-confirmed grounded (LLM)
answer is captured fire-and-forget into the Answer Store
(channel `"comment"`, origin `autopilot_grounded`) with the
Brain sources — the store screens eligibility + PII itself.
Single-comment fires only; humanizer sends are never
captured (the deterministic-tier rule from SA-B3).

**DI** — `LlmFactory`, `OrgBrainService`, `AnswerStoreService`
are appended `@Optional()` constructor params on
`SocialCommentsService` (the InboxService pattern, lazy
same-prisma fallbacks for the Brain + store), so every
existing `(prisma, audit)` positional construction — all the
comment specs — keeps working unchanged. In production the
real services arrive via InboxModule's providers +
OrgBrainModule, which InboxModule already imports.

**Recorded non-changes** — `generateAiSuggestion` and bulk
`AI_REPLY_ALL` (staff-triggered surfaces) still return the
humanizer plan: they are a human's tool, not the autopilot
compose, and the brief's guard requirement targets autopilot
replies. The humanizer fallback's own fixed template copy
(e.g. its canned delivery snippets) is pre-existing platform
copy, not AI-composed text; the guard governs the Brain path
(store + LLM) in this batch — re-grounding the templates
themselves would be a product change, not R2 wiring, and is
recorded here rather than silently made.

## Item 3 — Specs (commit b60d6637)

New spec `apps/api/src/inbox/sa-b8-comment-v2.spec.ts` —
**7 tests, all pass**:

- **CX3 inbox, aged burst of 3**: messages 9/6/3 s old at
  defer time (the production shape); `batchSince` equals the
  FIRST message's time; the sweep fires exactly one reply,
  about the first message's product (the combined-text
  compose); a re-run sends nothing.
- **CX3 comments, burst of 3** (no LLM wired): one reply,
  byte-equal to the humanizer plan of the combined text that
  BEGINS with the first comment; both covered comments
  discharged via `aiReplyBatchOf` + metadata; the Graph post
  count is exactly 1 and a re-run fires nothing.
- **Grounding**: a return-policy comment is answered from
  the org's own public policy doc (the sentinel fact is in
  the captured prompt AND in the posted reply; the profile's
  delivery charge line is in the prompt); an INTERNAL doc, a
  foreign org's doc, and the profile's goals / budget /
  target-customers / USP sentinels reach NEITHER the prompt
  NOR the post; `comment_autopilot` usage is recorded;
  `metadata.graph.groundedVia = "llm"`.
- **Guard**: a mocked LLM inventing ৯৯৯ টাকা against the
  live 1250 is blocked — zero Graph posts, the comment stays
  PENDING with `guardBlocked.inventedNumbers = ["999"]` and
  the `social_comments.guard_rejected` audit present.
- **Sweep grounding + capture**: a delayed comment fires a
  Brain-composed reply through the sweep and the answer is
  captured into the Answer Store on the comment channel.
- **Answer Store, comment channel**: a `staff_approved` entry
  serves with ZERO LLM calls (zero-token `answer_store_hit`
  usage row, `groundedVia = "answer_store"`); after the live
  price moves 1250 → 1350 the lookup invalidates the entry
  (reason recorded), the next identical comment is composed
  by the LLM with the new price, and the guard-passed send
  re-grounds the entry — no active entry carries the stale
  price afterwards.
- **Public-comment confidentiality**: a commenter asking
  "আমার অর্ডার কোথায়?" resolves `own_customer` with key
  `messenger:fb-rakib` (asserted on the Brain call), yet the
  memory/order sentinels (and the commenter's name / social
  id) appear in NEITHER the prompt NOR the public post — the
  posted reply is the inbox invitation. An anonymous
  commenter takes the plain `customer` audience with no key.

Plus the patch's regression test inside `cx3-debounce.spec.ts`
(19/19 there — see Item 1).

## Gates (run strictly serially; each recorded as it finished)

| Gate | Result |
|---|---|
| Item specs along the way | cx3-debounce 19/19 (fix proven fail-before/pass-after) · comment-area suites after Item 2 (cx3 + in8 + cx12d + cx3-jobs + cc27) 95/95 · new SA-B8 spec 7/7 |
| Targeted jest: `src/inbox src/social src/ai src/knowledge src/automation src/connections --runInBand` | **173 suites / 2045 tests — 2044 pass; 1 failure, pre-existing (below)**. The first attempt OOM-aborted at the default heap (infrastructure, not a test result — the suite set is ~2× SA-B7's scope); the recorded run used the repo-standard 4096 heap (the SA-B3/SA-B6 precedent) |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG (throwaway local PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **227/227 migrations applied, 0 unfinished — unchanged** (this batch adds NO migration); `vector` extension 0.6.0 verified present; the throwaway DB was dropped afterwards |

**The one targeted-jest failure — pre-existing, proven, not
this batch's**: `connections/cc26-payout-automation.spec.ts`,
the wallet payout-sweep slot-day test (1 failed / 8 passed
solo — the identical shape SA-B3 recorded when it proved the
same failure on the pristine base `05b86e0c`: "rerun solo on
this branch and run identically on the pristine base (1
failed / 8 passed both ways)"). SA-B8's diff touches only
`apps/api/src/inbox/*` — zero connections/wallet files — and
the brief names this failure as known in advance. The known
TelegramClient boot block is likewise untouched and remains
owed to this line at integration.

## NOT BUILT (later batches / recorded decisions — named, not implied)

- **Reply-quality unification (R3)** — SA-B9, including the
  ghost-complete guard decision deferred by SA-B7 and the
  Phase-1 close-out.
- **Comment-thread conversation mining** — comments remain
  unmined as a learning source (SA-B4 deferred it to this
  phase; R2's scope is the reply flow — a mining batch can
  build on SA-B4's LearnedItem pipeline when scheduled).
- **The humanizer templates' own fixed copy** — not
  re-grounded and not guard-checked in this batch (recorded
  under Item 2): its canned snippets predate the Brain and
  changing platform template copy is a product decision.
- **`generateAiSuggestion` / bulk AI_REPLY_ALL Brain
  migration** — staff-triggered surfaces, recorded under
  Item 2.
- **Answer Store capture from batched comment replies** —
  batches are composites; capture stays single-question
  (recorded under Item 2).
- **Live verification of any kind** — no real Meta comment
  was posted, no real LLM/embedding call was made, and no
  migration has run on the real database (none is added
  here). Real comment posting under a real org is M30, still
  owed; the pre-existing TelegramClient/ThreadsClient boot
  block on this line is unchanged and remains owed at
  integration.
