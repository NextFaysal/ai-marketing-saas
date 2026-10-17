# Smart AI Phase 1 — Batch SA-B9 Acceptance (R3: Reply Quality)

Date: 2026-10-17. Branch `smart-ai`, base `c4849af9` (SA-B8).
Local commits only; nothing pushed.

Commits:
- `dbe21023` — Item 1: the shared reply-quality layer +
  the four compose-path migrations.
- `562bdc34` — Item 2: the ghost-complete decision corpus.
- `568a1789` — Item 3: specs (unit + path integration).
- (the tip commit) — this acceptance doc + the Phase-1
  close-out summary.

Plan of record: `Smart-AI-Full-Master-Plan-2026-10-17.md`
Phase 1 item R3 — "Reply Quality: ভাষা শনাক্ত, brand voice,
স্বাভাবিক লেখা — সব চ্যানেলে এক নিয়ম". Laws L1–L5 govern
throughout.

## Step 0 — the reply-quality matrix (brief vs code reality)

Every compose path, and how it decided language / style
before this batch:

| Path | Language decision | Style | Writing-style text |
|---|---|---|---|
| Inbox autopilot (`composeLlmGroundedReply`) | pack.replyLanguage (org `aiReplyLanguage` bn/en, or Desk override) → forced line; else the IN7d detected instruction. **Memory languagePref never consulted** | pack.styleInstructions under the label "Style guidance from the shop's learned brand voice (shapes WORDING ONLY…)" | Opener lines only ("Reply in the customer's language and style… Keep it short and helpful" + the facts rule) |
| `suggestDraft` LLM branch | brain.replyLanguage bn/en → forced line **only — no detected fallback, no memory fallback** | brain.styleInstructions, same label (a second copy of the rendering) | Its own opener ("Reply in the customer's language"), no natural-writing rules |
| Order bot (`botAnswerQuestion`) | Inherits the autopilot compose verbatim (usageFeature `order_bot`) | Inherits | Inherits |
| Comment compose (`composeGroundedCommentReply`, SA-B8) | brain.replyLanguage bn/en → forced; else detected instruction; else a memory-pref line — **a third copy of the logic**, with its own wording and a suppression quirk (org value "auto" blocked the memory rung) | brain.styleInstructions, same label (a third copy) | Comment-local lines (publicness, 1–3 sentences) |
| `toneRewrite` | Preserves the AGENT's own input language/script (a hard rule of the path) — no customer-language decision exists to unify | n/a (the tone parameter is the style) | Self-contained; consumes no business context (SA-B7 verdict) — **not migrated, by design** |
| `ghostComplete` | "SAME language/script as the partial" — the AGENT's half-written text, correct by design for a continuation | none | Self-contained continuation rules; its Brain question is Item 2 |

**The drift R3 removes:** three separate copies of the
language-line logic and the style-label rendering; the draft
path missing the detected + memory rungs entirely; the inbox
missing the memory rung; no shared natural-writing or
honesty-restatement block anywhere.

**One reconciliation, recorded deliberately.** The batch
brief's resolver order was *detected → memory → org setting →
bn*. The shipped product carries a spec'd rule the other way
for one rung: an explicit owner language always wins
(`in7-ai.ts`: "An explicit owner override
(BusinessProfile.aiReplyLanguage / Desk override) always
wins"; `in7-ai.spec.ts`: "owner override (en) wins over a
Bengali customer message — detected line absent"). An
explicit `aiReplyLanguage` is an owner standing instruction —
the same class as `ownerInstructions` — and demoting it
below a script-ratio heuristic would make the product
disobey its owner and break the shipped spec. The adopted
resolver therefore runs: **per-call override → explicit org
bn/en → detected → memory → Bengali default**. The brief's
chain governs every case the owner has not pinned; the
deviation is exactly one rung, and it is asserted by a unit
spec so it can never drift silently.

## Item 1 — the shared reply-quality layer (commit dbe21023)

**New module `apps/api/src/ai/reply-quality.ts`** (pure,
like `in7-ai.ts`):

- `resolveReplyLanguage({ override, orgReplyLanguage,
  detected, memoryLanguagePref })` → `{ language, source }` —
  the ONE resolver, precedence as recorded above. "auto"/null
  org values fall through; junk values never pin; "mixed" is
  reachable only through detection.
- `replyLanguageDirective(resolved)` — the ONE rendering,
  reusing the established wordings so unifying the decision
  does not churn any path's existing text for the same
  situation: in7-ai's own detected lines (spec-pinned), the
  plain "Always reply in …" forced lines for pinned/default,
  SA-B8's "usually writes in …" line for memory.
- `buildReplyQualityBlock({ language, styleInstructions,
  channel })` → the shared prompt section:
  `REPLY_QUALITY_MARKER` ("Reply quality (shared rules):"),
  the language directive, a natural-writing line (short clear
  sentences; no repeating the customer's/product's name every
  line; no same template opener), an honesty restatement
  (never invent offers/discounts/deadlines/promises; facts
  or "the team will confirm"), and — only when an ACTIVE
  learned voice exists — the Brain's `styleInstructions`
  under the established SA-B5 label, rendered identically
  everywhere because every path now calls this one function.
  Channel-invariant by design: what differs per channel is
  genuinely path-specific and stayed at the call sites.

**Migrations** (output contracts, guard and escalation
behaviour unchanged everywhere):

- **Autopilot compose** — the three ad-hoc spreads (SA-B5
  style spread, bn/en forced lines, IN7d detected line) are
  replaced by the block. `buildFactPack` additionally exposes
  `brainReplyLanguage` (the profile's own value — the pack's
  `replyLanguage` conflates it with a Desk override) and
  `memoryLanguagePref` (admitted only under `own_customer`),
  which is what lets the resolver see all four rungs. Kept
  local: the identity/facts opener, the NO_ANSWER rule, the
  Milestone-77 owner-instructions line.
- **`suggestDraft`** — the style spread + bn/en-only language
  spread replaced by the block, resolved from the Brain
  context it already fetches. **Behaviour change (the R3
  point):** a draft now follows the customer's detected
  language, then their remembered preference, when the owner
  has pinned nothing — before R3 it silently fell back to
  the opener's generic line. Kept local: the draft opener
  ("Return ONLY the draft text", the clarifying-question
  fallback).
- **Order bot** — migrates by construction: its grounded
  branch composes through `composeLlmGroundedReply`
  (usageFeature `order_bot`), so it carries the block; the
  spec proves the block + usage label on that exact call.
  Its state machine, re-ask lines and fallbacks are untouched
  (SA-B7 discipline).
- **Comment compose** — the style spread + three-branch
  language logic replaced by the block. One nuance improves:
  with the org language on "auto", the remembered preference
  now applies (previously a non-bn/en org value suppressed
  every language line). Kept local: the publicness rule
  (personal/order questions → inbox invitation), the 1–3
  sentence cap, NO_ANSWER, the facts opener.

## Item 2 — the ghost-complete decision (commit 562bdc34)

The corpus (`inbox/sa-b9-ghost-corpus.spec.ts`, 19 tests)
runs candidate completions through the REAL `ghostComplete`
(the legacy verdict) and through candidate guard sets built
from a REAL `OrgBrainService` read of the same fixtures:

- **Faithful reconstruction, shared read order — 14/14
  content cases AGREE**: matched/unmatched product price,
  stock, invented price, profile-description number, policy
  numbers, discount present/absent, the 400-char policy
  slice, thread numbers, partial numbers. Reconstructing the
  ghost's JSON shape from Brain reads (publicProfile +
  policies sliced to 10/400) is content-faithful.
- **The naive full-Brain set DIVERGES (2 cases)**: adding
  the Brain's fact lines + matched knowledge/product content
  (the fact-pack surfaces) ADMITS numbers the legacy guard
  rejects — the delivery charge (60, present only as a fact
  line) and a knowledge-doc number (48). That variant would
  WEAKEN the guard.
- **The policy window DIVERGES in both directions (2
  cases)**: the ghost reads policies `take: 10`, the Brain
  reads `take: 20`, and NEITHER query has an ORDER BY — two
  unordered reads may observe different orders, so the
  ghost's ten and the Brain's first ten are not provably the
  same rows. Simulated exactly as production can behave
  (each read observes its own order over 12 policies): policy
  #12's number — legacy REJECTS, Brain-derived ADMITS;
  policy #1's number — legacy ADMITS, Brain-derived REJECTS.

**DECISION: ghostComplete STAYS LEGACY — final.** Per the
close-out rule (any divergence → do not migrate), the
migration is not proven equivalent and is not made. The
corpus is the permanent evidence, and its last test pins the
shipped verdicts so the legacy behaviour cannot change
unnoticed. The question is closed; reopening it would
require a deterministic policy ordering shared by both reads
(e.g. an ORDER BY in the Brain's policy read AND the
ghost's) plus a corpus re-run — a deliberate future change,
not a silent one. Ghost-complete also does not consume the
quality block: it composes no Brain context after this
decision, and its language rule follows the agent's partial
by design.

## Item 3 — Specs (commit 568a1789)

- `ai/sa-b9-reply-quality.spec.ts` — **13 tests**: the
  resolver precedence matrix (override > org > detected >
  memory > default; "auto"/junk never pin; detected beats
  memory), the directive wording per source (in7-pinned
  strings byte-exact), block composition + ordering, style
  segment presence, artefact-freedom without a profile, and
  channel invariance.
- `inbox/sa-b9-reply-quality.spec.ts` — **10 tests**: real
  prompt capture per path — Bengali/English/Banglish
  directives on the autopilot; org-pinned English through the
  block; the memory rung on a letter-less message; the
  Bengali default with no signal; no-profile artefact
  freedom; the SAME rendered style segment extracted from
  the autopilot, draft and comment prompts of one voice-
  active org; the order-bot branch carrying the block under
  its `order_bot` usage label; and owner brandVoice
  precedence intact inside the block.
- `inbox/sa-b9-ghost-corpus.spec.ts` — **19 tests** (Item 2).

## Gates (run strictly serially; each recorded as it finished)

| Gate | Result |
|---|---|
| New specs along the way | corpus 19/19 · unit 13/13 · integration 10/10 (the comment case first caught the shared scripted reply being correctly guard-blocked on the comment fact set — the fixture was split per path, the guard was right) |
| Targeted jest: `src/inbox src/social src/ai src/knowledge src/automation src/connections --runInBand` (repo-standard 4096 heap) | **176 suites / 2087 tests — 2086 pass; 1 failure, pre-existing (below)**. Baseline SA-B8: 173/2045; the delta is exactly this batch's +3 suites / +42 tests. Guard + escalation + CX3 + comment suites all green (in7, cx2, cx3-debounce, u3-autopilot, sa-b5, sa-b7, sa-b8 unchanged and passing) |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG (throwaway local PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **227/227 migrations applied, 0 unfinished — unchanged** (this batch adds NO migration); `vector` extension 0.6.0 verified present; the throwaway cluster was dropped afterwards |

**The one targeted-jest failure — pre-existing, proven, not
this batch's**: `connections/cc26-payout-automation.spec.ts`,
the wallet payout-sweep slot-day test — the identical shape
SA-B3 proved on the pristine base `05b86e0c` (solo 1 failed /
8 passed both ways) and SA-B8 recorded again. SA-B9's diff
touches only `apps/api/src/ai/reply-quality.ts`,
`apps/api/src/inbox/inbox.service.ts` and
`apps/api/src/inbox/social-comments.service.ts` plus specs and
docs — zero connections/wallet overlap. The known
TelegramClient boot block is likewise untouched and remains
owed to this line at integration.

## NOT BUILT (later phases / recorded decisions — named, not implied)

- **Ghost-complete Brain migration** — decided AGAINST with
  corpus evidence (Item 2); the question is closed, not
  deferred again.
- **`toneRewrite` quality/Brain migration** — it rewrites
  the agent's own text and consumes no business context; its
  preserve-the-input-language rule is the correct rule for
  that path (SA-B7 verdict, reaffirmed in the Step-0 matrix).
- **Comment-thread conversation mining** — still unbuilt
  (deferred since SA-B4); not an R3 item.
- **`generateAiSuggestion` / bulk AI_REPLY_ALL Brain
  migration** — staff-triggered surfaces; the SA-B8 record
  stands.
- **Humanizer template re-grounding** — pre-Brain platform
  copy; a product decision, not R3 wiring (SA-B8 record
  stands).
- **Any quality measurement against real traffic** — R3's
  rules are prompt-level. Whether replies actually read
  more naturally, and in which language customers convert,
  is measurable only on live traffic (M30); no real LLM
  call, Meta post or production data was involved here.
- **Live verification of any kind** — no migration has run
  on the real database (none is added in this batch); the
  pre-existing TelegramClient/ThreadsClient boot block on
  this line is unchanged and remains owed at integration.
