# SA-B18 Acceptance — Smart AI Phase 4, C2: Competitor → Action Proposals

Batch: SA-B18 · Phase 4 (Competitor), item C2 · Worktree
`ai-marketing-saas-sai`, branch `smart-ai` · Base HEAD
`71aebaf8` (SA-B17) · Local commits only — nothing pushed.

**Process note (honesty):** the original SA-B18 coordinator
was lost to a daemon restart after committing Items 1–3 but
before running the gates or writing any doc. A recovery
coordinator then (a) read all three commits line-by-line
against this brief, (b) ran the full gate sequence below,
and (c) wrote this doc + the Phase-4 summary. No B18 code
was changed by the recovery — the gates passed on the code
exactly as committed.

C2 turns C1's competitor findings into RESPONSES. The
honesty frame set for this batch: a response must be a real
thing this system can do. Two legitimate channels exist —
the LearnedItem review queue and the Action Engine — and an
engine proposal is adopted ONLY where a catalog action
genuinely maps. Forcing one where it does not would be
fabrication; the mapping analysis below is therefore part
of the deliverable, not an appendix.

## Step-0 mapping analysis (the batch's core decision)

For each C1 finding type, every candidate response and its
real system home was enumerated:

| Finding | Candidate response | Verdict | Reason |
| --- | --- | --- | --- |
| price_drop | Talking point in the review queue, quoting the finding's real numbers + the org's OWN live price where a real linkage exists | ✅ **Adopted** (review queue) | Real data on both sides; a human approves before it can be used anywhere |
| price_drop | Any engine action (own price change, budget, pause…) | ❌ Rejected | No catalog action answers a rival's price. Setting the org's own prices is deliberately ABSENT from the engine catalog — a human/staff decision (L5). No honest mapping exists. |
| launch_burst | Counter-content IDEA in the review queue (evidence: the burst + the honestly-labelled aggregate theme counts) | ✅ **Adopted** (review queue) | The idea is a suggestion for humans; the actual draft is Phase-5 G1's generator work, and the suggestion text says exactly that |
| launch_burst | Engine: `resume_campaign` — burst at C1's threshold AND an own campaign Meta-confirmed PAUSED → propose resume for a human to decide | ✅ **Adopted** (the batch's one engine bridge) | The rule needs no invented linkage: an observable rival act + the org's own verified paused state. It proposes; it never executes on its own (below) |
| launch_burst | Engine: `set_campaign_budget` | ❌ Rejected | The budget builder requires a requested amount; any amount a proposer picked would be invented money |
| launch_burst | Engine: `pause_campaign` | ❌ Rejected | Going dark exactly when a rival gets loud is backwards; no honest rationale exists |
| silence | Opportunity note in the review queue | ✅ **Adopted** (review queue) | Keeps C1's caution wording ("no new ads observed" — never "inactive") |
| silence | Any engine action (incl. `resume_campaign`, budget) | ❌ Rejected | Nothing happened — there is no observed rival act to answer. Silence + a paused campaign is not a causal rule, it is a coincidence; proposing on it would manufacture urgency |

**Outcome: 3 review-queue responses + exactly 1 engine
bridge.** The rejected mappings are recorded in code
comments (`competitor-action-proposer.service.ts`) as well
as here.

### The own-product linkage rule (price_drop talking point)

The scanner's `productName` links to an own product **iff**,
after normalisation (trim, whitespace collapse, case-fold),
it EQUALS the product's `name` or `nameEn`, the product is
`ACTIVE`, and it belongs to the same org (earliest
`createdAt` wins a tie; the productId is recorded in the
suggestion for audit). Substring/fuzzy near-matches NEVER
link — a wrong pairing would put a fabricated comparison in
front of the team. A comparative claim ("their new price is
below yours") is made ONLY when the two currencies match;
on a mismatch both prices are stated with their currencies
and no comparison is claimed. When nothing links, the
suggestion says so and quotes only the rival's real prices.

## Item 1 — CompetitorResponseService (commit `08c79986`)

`apps/api/src/ai/competitor-response.service.ts` (+18 lines
in `competitor-intelligence.service.ts`, registration in
`org-brain.module.ts`):

- `deriveCompetitorFindings(digest)` reads the structured
  findings off the C1 digest's OWN fields
  (`priceMovements`, `competitors`) using C1's exported
  threshold constants, C1's sort order and C1's cap of 3 —
  parity with `digest.findings` is spec-proven. The digest
  is computed ONCE by `CompetitorIntelligenceService`; raw
  rows are never recomputed here. The i-th response carries
  the digest's i-th finding statement verbatim as evidence.
- Responses (deterministic, NO LLM anywhere — every number
  comes from the digest or the org's live product row):
  - **price_drop → talking point** (Bengali): rival's prior
    → latest price + delta %, own live price under the
    linkage rule above, and team guidance that explicitly
    states no price was changed (price decisions are the
    team's — L5).
  - **launch_burst → counter-content idea**: the burst
    counts + the digest's aggregate theme counts, labelled
    in-text as all-competitor aggregates ("শুধু এই
    প্রতিদ্বন্দ্বীর নয়"), and an explicit statement that
    this is an idea, not a draft — drafting is Phase 5.
  - **silence → opportunity note**: days since last new ad
    + last-seen date, C1's caution wording preserved, and
    an explicit statement that no budget/campaign change
    was made.
- Filing: SUGGESTED LearnedItems, kind `fact`,
  **sourceType `"competitor"`** — approval therefore forces
  INTERNAL via `LearningService` exactly like the findings
  themselves (L3). A separate `"response"` kind was
  evaluated and REJECTED: `LearningService.approve()` throws
  on kinds outside faq_pair/fact/product_note, and the
  queue + Brain rendering key on those three; the response
  travels as a structured `response` block inside the
  fact's content with zero new surface.
- Dedupe: the LearnedItem content-hash wall (the content
  carries the finding's numbers + the response) makes a
  re-run over unchanged data a no-op; `sourceRef` records
  period + rule + competitorId.
- Trigger: `CompetitorIntelligenceService.suggestFindings`
  now announces every computed digest on the bus
  (`competitor.findings_filed`) — the competitor sweep and
  the on-demand suggest endpoint both land there. The emit
  is wrapped so the findings path never depends on the bus;
  the subscriber is fire-and-forget safe (`catch` → the
  B11/B15 discipline). Module direction stays acyclic.

## Item 2 — The engine bridge (commit `3e9a0703`)

`apps/api/src/ai/actions/competitor-action-proposer.service.ts`
(registered in `ActionEngineModule` on the same bus):

- **Rule:** the digest contains a launch burst
  (`newAds7d ≥ COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS`, applied
  over the digest's competitor entries directly — NOT the
  findings list, which C1 caps at 3 org-wide) AND the org
  has a `CampaignPlan` with `metaStatus === "PAUSED"` and a
  non-null `externalCampaignId` → propose `resume_campaign`
  (platform `meta`) for the most recently updated such
  plan. Cap: ONE proposal per digest event — the loudest
  burst, the freshest paused plan.
- **Why `metaStatus` is an honest signal:** SA-B15
  established that `metaStatus` is written only from
  Meta-confirmed reads — a plan whose `metaStatus` says
  PAUSED really is dark on Meta. No local guess is treated
  as platform truth.
- **Evidence:** `proposedBy: "ai"`, `actorUserId: null`,
  and `sourceRef` names the burst (source
  `competitor_burst`, competitor id/name, `newAds7d`,
  `activeAds`, planId, digest period) — the human deciding
  sees exactly why the proposal exists.
- **Engine governance unchanged:** the proposal waits at
  the org's autonomy level (default **L1 — a human
  approves**; `resume_campaign` is medium-risk, so **L2
  never auto-executes it either** — spec-proven), the
  engine's open-proposal dedupe stops repeats for the same
  campaign while one is open (a deduped propose counts as
  *not* proposed), and the builder's no-op refusal (the
  plan is meanwhile ACTIVE again) simply means no proposal,
  quietly. Nothing in this bridge executes anything by
  itself.

## Item 3 — Specs (commit `12b42774`)

- `apps/api/src/ai/sa-b18-competitor-response.spec.ts` —
  **13 tests**: derive-parity with `digest.findings`
  (rules, order, cap); a linked drop quotes BOTH real
  prices + the same-currency comparison; a near-match
  fabricates NO pairing (and says so in the text);
  `nameEn` normalisation links; a non-ACTIVE product never
  links; a currency mismatch states both prices with no
  claim; burst idea + silence note fire at thresholds and
  stay silent below them; dedupe on re-run; approval forces
  INTERNAL; cross-org isolation; bus end-to-end via
  `suggestFindings`.
- `apps/api/src/ai/actions/sa-b18-competitor-actions.spec.ts` —
  **9 tests**: burst + PAUSED plan → exactly one
  `resume_campaign` proposal at L1 with the hub untouched;
  the freshest paused plan is targeted; no-plan /
  no-external-id / below-threshold all stay silent; engine
  dedupe honoured; L2 still waits (no auto-execution);
  cross-org isolation; bus end-to-end.
- Regression: the full SA-B17 C1 spec (12 tests) + all
  engine suites (SA-B10–B15) green inside the gate below.

## Gates (strictly serial, run by the recovery coordinator, recorded as each finished)

| Gate | Result |
| --- | --- |
| Targeted jest (ai + competitors + inbox + knowledge + organizations + automation, `--runInBand`) | **140 suites / 1396 tests, all pass** — +2 suites / +22 tests over SA-B17 (138/1374), exactly the two new B18 spec files (13 + 9); the C1 + B18 specs re-run standalone: 3 suites / 34 tests pass |
| api tsc (`tsc --noEmit`) | **exit 0** |
| api build | **exit 0** |
| Fresh-PG (throwaway PG 16 + pgvector, empty DB, `prisma migrate deploy`; verified in `_prisma_migrations`; cluster dropped after) | **229/229 applied, 0 unfinished, 0 rolled back — NO new migration** (zero changes under `packages/db` since base `71aebaf8`; 229 folders in tree — no `20261102000000_sai_*` claim was needed) |

**Fixes required by the gates: none.** No pre-existing
failure surfaced inside the targeted scope, so no
base-proof was needed; the known pre-existing items remain
untouched and are NOT this batch's: the cc26 wallet-sweep
spec (base-proven since SA-B3, outside the targeted suites)
and the TelegramClient/ThreadsClient undecorated-param boot
block (fix `b6dcc457` lives on the nf line, owed to sai at
integration).

## NOT BUILT (explicit)

- **Counter-content DRAFTS** (actual post/campaign text for
  a burst response): the plan's C2 counter-draft is
  delivered here as an evidence-carrying IDEA in proposal
  form; generating the draft itself is Phase-5 **G1** (the
  social content generator, which consumes approved ideas
  + A3's winning angles + brand voice). Nothing in B18
  writes a post or a campaign.
- **Any automated rival-response execution**: every C2
  output is a suggestion or an L1 proposal. No price, post,
  campaign or budget changes happen without a human —
  by design (L5).
- **Competitor website TRAFFIC estimates** (daily visits +
  traffic sources): the owner's provider choice between the
  paid BYOK options (Similarweb vs Semrush Trends Premium)
  was still unmade at this batch (an options prompt was put
  to him at SA-B17 dispatch and awaits his tap) — **no
  traffic source is built or claimed**.
- **New collection**: no new scrapers, no new external
  calls; C2 reads the C1 digest + the org's own live rows
  (products, campaign plans) only. The Meta Ad Library sync
  and the website price scanner are unchanged.
- **Live verification = M30**: nothing in the Smart AI line
  is live-proven; no migration has run on the real DB (this
  batch adds none). The `competitor_intelligence_sweep`
  findings path — the trigger both C2 consumers hang off —
  still needs the owner's per-org enable, like every sweep.
