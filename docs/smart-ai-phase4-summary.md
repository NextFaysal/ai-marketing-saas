# Smart AI — Phase 4 (Competitor) Summary & Close-out

**Date:** 2026-10-17 · **Line:** `ai-marketing-saas-sai` (branch `smart-ai`) · **Phase-4 final HEAD:** see SA-B18 acceptance · **Local commits only — not pushed, not deployed, nothing live-proven (M30 owed).**

Phase 4 of the Smart AI Full Master Plan (C1–C2) is **code-complete**: the Brain can now *read* what an org's tracked rivals are doing (C1) and *propose responses* to it through the same governed channels as everything else in Smart AI (C2) — every number taken from rows the platform already collects, competitor intelligence INTERNAL-only at the data layer, and every response either a human-approved suggestion or a human-decided engine proposal. Nothing in this phase collects anything new, and nothing executes on its own.

## Audit table — C1–C2

| Item | Batch | Verdict | What shipped |
|---|---|---|---|
| **C1 — Competitor Brain** | SA-B17 (`71aebaf8`) | ✅ Shipped | `CompetitorIntelligenceService`: deterministic per-org digest over EXISTING collected rows only (Meta Ad Library official sync + robots-respecting website price scanner — both untouched): tracked count, new ads by real `firstSeenAt` (7d/30d windows), active vs ended, cadence, creative-theme COUNTS (CompetitorAd has NO performance data — counts only, never CTR/ROAS claims about rivals), price series (delta only with ≥2 same-currency observations — a single snapshot yields `deltaPercent` null, never 0). Threshold findings (price drop ≤ −5%, launch burst ≥5 new ads/7d, silence ≥14d worded "no new ads", never "inactive") filed as SUGGESTED `sourceType: "competitor"` facts, approval forces INTERNAL. Brain internal contexts gain the digest + approved facts; customer/own_customer contexts byte-clean (sentinel-proven). Tenant API `GET competitor-intelligence` + `POST .../suggest`; `competitor_intelligence_sweep` in the learning sweep family. |
| **C2 — Competitor → Action** | SA-B18 (this close-out) | ✅ Shipped (with the mapping analysis as a deliverable) | `CompetitorResponseService`: every C1 finding gains a RESPONSE suggestion in the same review queue — price_drop → a talking point quoting BOTH real prices (own live price only under an exact-normalised-name linkage rule vs an ACTIVE own product; comparative claim only when currencies match; near-matches never link); launch_burst → a counter-content IDEA carrying honestly-labelled aggregate theme evidence; silence → an opportunity note keeping C1's caution wording. Plus **exactly one engine bridge**, adopted because its rule needs no invented linkage: launch burst + an own Meta-confirmed PAUSED campaign (`metaStatus`, SA-B15 semantics) → propose `resume_campaign` at L1 via `CompetitorActionProposerService` (sourceRef names the burst; engine dedupe + autonomy untouched; L2 never auto-executes medium-risk). All other engine mappings were evaluated and REJECTED with recorded reasons (mapping table in the B18 acceptance doc). |

**Phase-4 totals: 2 shipped · 0 partial · 0 silently dropped** — with named notes carried openly: the counter-draft's *text generation* is Phase-5 G1 work (C2 ships the proposal form: idea + evidence + an executable-form engine proposal), and competitor website **traffic estimates were not built** because the owner's provider choice is still unmade (below).

## Cumulative gates (phase close)

| Gate | SA-B17 | SA-B18 |
|---|---|---|
| Targeted jest (ai + competitors + inbox + knowledge + organizations + automation) | 138 suites / 1,374 tests ✅ | **140 suites / 1,396 tests ✅** |
| API tsc | exit 0 | exit 0 |
| API build | exit 0 | exit 0 |
| Fresh-PG (`prisma migrate deploy`, empty DB) | 229/229 | **229/229, 0 unfinished, 0 rolled back** |
| New migrations in phase | 0 | 0 |

(Per-batch detail: `docs/smart-ai-b17-acceptance.md`, `docs/smart-ai-b18-acceptance.md`. Process honesty: SA-B18's original coordinator was lost to a daemon restart after its Item-3 commit; a recovery coordinator verified the three commits line-by-line and ran the full gate sequence on the code exactly as committed — no B18 code was changed in recovery, and no gate needed a fix.)

## Honest limits (phase-wide)

- **Competitor data is sync/scanner-bound.** C1–C2 read only what the Meta Ad Library sync and the website price scanner already collect. Ad Library coverage, scanner reach (robots, site structure), and per-competitor daily job cadence bound everything the Brain can say; gaps in collection appear as absent data, never as filled-in claims.
- **No competitor performance data exists.** `CompetitorAd` has no impressions/clicks/spend, so rival analysis is activity, price and text-theme facts only. Any future claim about a rival's ad *performance* would be fabrication on this data.
- **Traffic estimates NOT BUILT.** The owner's competitor website-traffic idea (daily visits + traffic sources) reached its planned turn in this phase, but the provider choice between the paid BYOK options — Similarweb (channel sources, monthly-leaning) vs Semrush Trends Premium (true daily + sources) — was put to him at SA-B17 dispatch and still awaits his tap. No traffic data source is built, and no surface claims traffic numbers.
- **Responses never execute themselves.** C2's outputs are suggestions in a review queue and one L1 engine proposal type. Own-price changes are deliberately absent from the engine catalog (L5); budget responses were rejected because a proposer-chosen amount would be invented money.
- **Nothing is live-proven.** All Phase-4 proof is unit/fixture-level plus fresh-database migration proof. No real Meta account, tenant data or LLM key has touched this code — M30 live verification remains owed for the whole Smart AI line. The `competitor_intelligence_sweep` (the trigger both C2 consumers hang off) still needs the owner's per-org enable.
- **Boot block still owed at integration:** the TelegramClient/ThreadsClient undecorated-param bug exists on this line; the proven fix lives on the nf line (`b6dcc457`) and must be applied at union/integration. Known pre-existing failure, untouched: `cc26-payout-automation` wallet-sweep spec (base-proven since SA-B3).
- **Push/deploy:** the whole Smart AI line is local-only. A release needs the owner's explicit push instruction (ls-remote/fetch first), his manual Dokploy Redeploy, and per-org job enables.

## Phase 5 entry notes — Growth Content (G1–G3)

Per the Master Plan, Phase 5 is **Growth Content (G1–G3)**. Entry conditions and assets already in place:

- **G1 — Social Content** is the natural consumer of three shipped queues: C2's approved counter-content ideas (Phase 4), A3's winning creative patterns + read-through exemplars (SA-B16), and the learned brand voice (`AiBrandVoiceProfile`, SA-B5). The B18 response text already tells tenants the draft step is Phase 5 — G1 must honour that promise's shape: generation grounds on Brain-approved facts only (L2), in the org's voice, and files drafts for humans, not posts.
- **G2 — Broadcast Personalised** builds on `CustomerMemory`'s `own_customer` audience (SA-B5) and RFM/segment surfaces from earlier packages; the Messaging package's cap / quiet-hour / consent rails are stated in the plan as UNCHANGED — personalisation varies the message, never the sending rules.
- **G3 — Owner Copilot**: the Action Engine (SA-B10–B12, B15, B18) is the copilot's only hands (L5), and the deterministic digest services (performance SA-B5, ads SA-B14, creative SA-B16, competitor SA-B17) are its briefing sources — a daily briefing assembled from those digests needs no new analytics, only composition with the number guard on any narration.
- **Before building:** re-run a Step-0 inventory on the then-current tree (the sai line will have moved), and re-check the still-open owner decisions that touch Phase 5 only if a G item actually requires one — the traffic-provider choice does NOT block G1–G3.
