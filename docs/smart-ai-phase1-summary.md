# Smart AI — Phase 1 (Smart Reply) Close-Out Summary

Date: 2026-10-17. Branch `smart-ai` (worktree
`ai-marketing-saas-sai`), base `f6db663a` (SA-B6, Phase 0
closed) → Phase-1 final HEAD at SA-B9. Local commits only;
nothing pushed. Plan of record:
`Smart-AI-Full-Master-Plan-2026-10-17.md` §6 Phase 1
(R1–R3), laws L1–L5 (§2).

Phase 1 put every customer-facing reply surface on the one
Brain Phase 0 built — and on one reply-quality rule — without
moving the guard, the escalation, or any transactional
behaviour: the inbox's remaining compose paths (SA-B7), the
comment autopilot (SA-B8, with the CX3 production-bug fix the
plan made a precondition), and the shared quality layer
(SA-B9). Phase 1 added **zero migrations** — it is built
entirely on Phase 0's schema (227 migrations throughout).

## R1–R3 audit

| # | Item | Status | Batch | Evidence |
|---|---|---|---|---|
| R1 | Inbox Reply v2 — autopilot/draft/order bot on the Brain (semantic knowledge + customer memory; guard/escalation unchanged) | **Shipped** | SA-B7 | `docs/smart-ai-b7-acceptance.md` |
| R2 | Comment Reply v2 — Brain-grounded comment replies (policy/FAQ in the flow), spam shield, DM, hide in one flow; CX3 bug fix as a condition | **Shipped — condition met** (the CX3 debounce production bug is FIXED, fail-before/pass-after proven) | SA-B8 | `docs/smart-ai-b8-acceptance.md` |
| R3 | Reply Quality — language detection, brand voice, natural writing; one rule on all channels | **Shipped** | SA-B9 | `docs/smart-ai-b9-acceptance.md` |

**Audit outcome: 3 shipped, 0 partial, 0 not built,
0 silently dropped.** Two recorded decisions sit inside the
shipped items and are named here so the audit is honest
about them:

1. **The deterministic tier and (at R1) ghost-complete were
   deliberately left off the Brain** — the tier composes from
   the same live rows the Brain would serve (L4 in its
   purest form), and ghost-complete's guard derives its
   allowed set from the very JSON a migration would replace
   (SA-B7 Step-0 findings 4–5).
2. **The ghost-complete question was then CLOSED at R3, not
   left open**: a 19-case corpus (SA-B9 Item 2) proved a
   faithful Brain reconstruction agrees on all 14 content
   cases, but the naive full-Brain set weakens the guard
   (fact-line and document numbers become admissible) and the
   policy window diverges in both directions (the ghost reads
   policies take-10, the Brain take-20, neither ordered — the
   windows are not provably the same rows). **Ghost-complete
   stays legacy — final**, with the corpus pinning the
   shipped verdicts. One further recorded reconciliation: the
   shared language resolver keeps an explicit owner
   `aiReplyLanguage` above detection (the shipped IN7 owner
   rule, spec'd since IN7d) and applies the plan's
   detected → memory → default chain to every case the owner
   has not pinned (SA-B9 Step 0).

## What each batch shipped (one line each)

- **SA-B7 (R1)** — the Brain's product semantic matches got
  their first retrieval consumer (SA-B2/B4 had indexed
  catalog text nobody searched); `suggestDraft` migrated to
  the Brain with the Answer Store as its first suggestion
  source; the order bot answers mid-order questions through
  the grounded compose at its three parse-failure points
  without ever moving session state; the PgVectorStore SQL
  visibility filter was tightened to every customer-class
  audience.
- **SA-B8 (R2)** — the CX3 fix (the batch opened at the
  triggering message's timestamp instead of the defer time —
  lone delayed replies could never fire, bursts lost their
  first message); comment replies became Brain-grounded at
  both fire sites with the Answer Store on the comment
  channel and the shared number guard in front of the Graph
  post (an invented number posts NOTHING and routes to the
  human moderation queue); the L3 public-comment rule made
  structural (memory steers language only; order questions
  get a DM invitation).
- **SA-B9 (R3)** — `ai/reply-quality.ts`: one language
  resolver (override → explicit org language → detected →
  remembered preference → Bengali default) and one quality
  block (language directive, natural-writing rules, honesty
  restatement, the learned brand voice under its one label),
  consumed by the autopilot compose, the draft's LLM branch,
  the comment compose, and — by construction — the order bot.
  The draft gained the detected + memory language rungs it
  never had.

## Cumulative gates across Phase 1

| Batch | New specs | Targeted jest | Fresh-PG |
|---|---|---|---|
| SA-B7 | 12/12 (Brain products 7, inbox v2 5) | 107 suites / 993 tests | 227/227 (no new migration) |
| SA-B8 | 7/7 (+ cx3-debounce 19/19, fix proven fail-before/pass-after) | 173 suites / 2045 tests (2044 pass; cc26 pre-existing, base-proven) | 227/227 (no new migration) |
| SA-B9 | 42/42 (unit 13, path integration 10, ghost corpus 19) | 176 suites / 2087 tests (2086 pass; cc26 pre-existing, base-proven) | 227/227 (no new migration) |

API tsc + API build exit 0 at every batch. Every gate ran
strictly serially. The only failure seen anywhere in the
phase is the pre-existing cc26 wallet-sweep test, proven on
the pristine base at SA-B3 and unchanged in shape since; no
Phase-1 diff touches its area.

## Permanent-gate evidence added in this phase

- **Number guard** — extended, never weakened: stored
  answers and comment replies now pass the same deterministic
  guard as fresh inbox compositions, and the ghost corpus
  proves the one guard whose source was questioned was left
  exactly as strong as it shipped.
- **Customer-audience leak specs (L3)** — SA-B7's draft
  prompt sentinel scan (internal doc / goals / budget / USP /
  another customer's memory all absent); SA-B8's public-
  comment confidentiality spec (memory/order sentinels in
  neither prompt nor post).
- **Cross-org isolation (L1)** — SA-B7's product-match
  isolation (archived + foreign products never surface);
  SA-B8's foreign-doc sentinel in comment prompts.
- **Exactly-once** — the CX3 fix preserves the durable
  machinery (DB due stamps + sweep claims); burst-of-3 specs
  on both surfaces prove one reply, first message included,
  and silence on re-run.

## Honest limits — what Phase 1 does NOT prove

- **Nothing here is live-proven.** No real LLM call, Meta
  comment post, or production conversation was involved;
  reply quality is prompt-level until it meets real traffic.
  Live proof is M30's, and it is still owed.
- **Reply wording will shift** where the shared block now
  governs (drafts most visibly — they gained the detected +
  memory language rungs). Guard, escalation, Answer Store and
  transactional behaviour are unchanged; phrasing is not
  byte-frozen and was never promised to be.
- **Semantic product knowledge is hybrid-mode only**: an org
  whose provider cannot embed (e.g. Anthropic-only) gets the
  keyword behaviour exactly as before — labelled, never
  papered over (Phase-0 limit, unchanged).
- **The humanizer templates' fixed copy** (comment fallback)
  still predates the Brain and is not guard-checked; changing
  platform template copy remains a product decision, recorded
  at SA-B8 and unchanged here.
- **Full-app boot on the sai line is still blocked by the
  pre-existing TelegramClient/ThreadsClient bug** (Social
  Module constructor params), owed to this line at
  integration exactly as recorded at SA-B6 — Phase 1 did not
  touch it.

## What Phase 2 (W1–W4, AI Worker) starts from

- **The Talk layer is unified**: one Brain, one Answer Store
  discipline, one number guard, one reply-quality rule across
  inbox + comments + drafts + order bot. Phase 2 adds the
  Work layer on top of it — the AI stops only answering and
  starts *doing*, under law L5 (real service paths only,
  autonomy levels, verified outcomes, honest failure
  records).
- **W1 (Action Catalog + Autonomy)** starts from rails that
  already exist in the ads surface (`AIActionProposal`
  approve-gated exactly-once execution + `AIAction` audit) —
  the catalog generalises that pattern; it does not invent a
  second one. Default autonomy is level 1 (propose) per the
  plan; level 3 (supervised auto) is catalog-only and stays
  off without a separate owner decision.
- **W2 (Inbox Actions)** builds on surfaces this phase left
  in their strongest state: the order bot already creates
  real orders through the existing path, lead/tag and courier
  helpers exist as staff actions — the work is wiring the AI
  to *propose and (at level) execute* them with the same
  audit discipline, not building the actions themselves.
- **W3 (Comment Actions)** starts from the comment pipeline
  SA-B8 mapped end-to-end: hide/unhide, DM and lead creation
  already exist as human-triggered, Graph-first operations
  with audit — the AI-facing step is proposal/execution
  wiring under the catalog, with every action logged.
- **W4 (Control Center foundation)** — module on/off,
  autonomy levels, caps and the kill switch for the working
  AI, from the first day the AI can act. The existing
  kill-switch + plan-limit machinery (`checkAiAllowed`,
  platform settings) is the base it extends.
- **Per-batch gates gain two permanent members** in Phase 2
  (plan §6): the action exactly-once spec and the honest-
  failure-recording spec join the leak/guard/fresh-PG gates
  every batch already runs.
