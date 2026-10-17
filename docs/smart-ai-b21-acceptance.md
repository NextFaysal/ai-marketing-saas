# SA-B21 Acceptance — G3 Owner Copilot + Phase-5 Close-out

**Date:** 2026-10-17 · **Worktree:** `ai-marketing-saas-sai` (branch `smart-ai`) · **Base:** `8842cec6` (SA-B20) · **Local commits only — not pushed.**

- **Scope:** Smart AI Master Plan Phase 5, item **G3 (Owner Copilot)** — "Dashboard Assistant পুরো Brain জানে — প্রশ্নের উত্তর নিজের ডেটায়, কাজ Action Engine দিয়ে; daily briefingও Brain থেকে". Built as a stateless ask surface over EXACTLY what exists: questions are answered from the org's deterministic digests + Brain internal facts under the shared number guard; action asks become Action Engine **proposals** through a deterministic intent layer. No new analytics, no new actions, no execution path.
- **Migration:** none — the copilot stores nothing (stateless by design; the client may pass recent turns). Fresh-PG confirms **230/230** (see Gates for the recorded environment deviation, identical in kind to SA-B20's).
- **Laws in force:** L1 (the pack, the campaign candidates and every query are org-scoped; cross-org sentinel spec), L2 (answers may only restate pack facts — the guard + one regeneration + facts-fallback enforce it; absent data is a plain "জানি না" / a deterministic no-data answer), L3 (the pack is INTERNAL class and the endpoint is OWNER/ADMIN only; SECRET-class profile fields — trade licence, billing emails — are deliberately never rendered into the pack), L4 (the guard's verdict is final — prose is withheld rather than edited into compliance), L5 (the copilot calls `propose()` only; it holds no path to `execute()` — spec-proven by spy; money-adjacent asks stay proposals by the engine's wall, said out loud in the answer).

---

## Step 0 — scoping against what exists (verified)

**The digests are already services with read surfaces.** Performance = stored `PerformanceSnapshot` rows (SA-B5 sweep-written, both 7d and 30d windows) rendered by the exported `performanceFactLines`; Ads = `AdsIntelligenceService.computeDigest` (SA-B14, `factLines` are Bengali, period-labelled, guard-ready); Competitor = `CompetitorIntelligenceService.computeDigest` (SA-B17); Creative = `CreativeLearningService.computeReport` (SA-B16 — its patterns carry an owner-facing `statement` with their numbers); Brain internal facts = `OrgBrainService.getContext(audience: "internal")` (internal profile + question-matched knowledge, internal documents included). **The engine** is `ActionEngineService.propose()` (SA-B10) with the SA-B15 ads builders resolving `{platform, campaignExternalId, adAccountId}` (+ `requestedBudgetMinor` for budget) against live hub rows. **The queue** is the SA-B13 Control Center — proposals land there unchanged.

**Placement (recorded):** `CopilotService` + `CopilotController` live in `ActionEngineModule`, not `OrgBrainModule` — the copilot stands on the Brain's exports AND the engine, and ActionEngineModule is the one leaf that already imports both; OrgBrainModule would force a cycle. `LlmFactory` is provided directly in the module (the MessagingModule/InboxModule precedent).

**Roles (recorded narrowing):** OWNER/ADMIN only. The other Smart AI write surfaces admit MARKETING_MANAGER; the copilot speaks from INTERNAL-class facts (goals, monthly budget, ads/competitor figures) and files proposals in the owner's name, and the plan casts G3 as the owner's own instrument — so the manager role is excluded here, and a spec pins the metadata.

**The older `GrowthCopilotService`** (a deterministic ads-opportunities audit in AiModule) is a different, pre-existing surface and is untouched — G3's copilot is the conversational Brain layer, not a rename of it.

## Item 1 — CopilotService + `POST organizations/:organizationId/copilot/ask`

`apps/api/src/ai/copilot.service.ts` + `copilot.controller.ts` + `copilot.dto.ts`, registered in `ActionEngineModule`.

**Enforcement (family shapes, before any work):** the platform AI kill switch gates the whole surface (403) — `ask()` checks it first, for every path. The daily AI cap (own bucket `copilot`) gates only the LLM-consuming Q&A path: the deterministic action path creates no usage and is never blocked by an exhausted text budget. Each provider call writes its `AIUsageRecord` after success (a regeneration is a second real call, accounted as one). Audit rows: `ai.copilot_ask`, `ai.copilot_answer_dropped`, `ai.copilot_action_proposed`.

**The pack (Q&A).** Sections, each labelled `{source, window}` and returned in the response so the dashboard can show what an answer stands on: `performance_snapshot` 7d + 30d (latest stored snapshot per window, read-only — an ask never triggers a recompute or files suggestions), `ads_digest` 7d (its fact lines carry their own prior-period deltas), `competitor_digest` 30d, `creative_report` 30d (baseline CTR + computed pattern statements ONLY — never raw exemplar texts; another surface's numbers discipline, the SA-B19 rule), `brain_internal` (goals, monthly budget via `formatMinor`, business model, USP, target customers, owner instructions, top-3 question-matched knowledge). A section with no data is omitted; a loader failure degrades that section to omitted, never to invented content. Language: DTO `language` → org `aiReplyLanguage` → bn.

**The guard (L2/L4).** The allowed-number set is `extractGuardNumbers` over the pack text ONLY (the question's own numbers are not admitted — a question is not a verified fact). An answer with an outside number is NOT returned: ONE regeneration runs with the offending numbers named in the corrective instruction; if the rewrite is clean it is served with `guardNote: "regenerated"`. If it still invents (or comes back empty), the prose is withheld and the response carries the honest line + the verified `sections` + `guardNote: "dropped_unsupported_numbers"` + the dropped numbers — the SA-B14 narration discipline: facts always available, prose is the bonus.

**Unknown data.** Two honest shapes, both spec'd: an org with NO pack data at all gets a deterministic no-data answer with **zero** LLM calls (spending a model call to phrase an absence would only risk invention); a question whose topic the pack does not hold is governed by the system rule (say plainly "এই তথ্যটা আমার কাছে নেই") and a compliant answer passes through untouched.

**Actions (deterministic intent layer — the LLM never decides an act).** Verbs are matched in code (bn + en), targets resolved against live rows (published `CampaignPlan`s + synced `AdCampaign`s, deduped by the engine's campaignKey; the plan's name wins):
- **pause_campaign / resume_campaign** — a unique name match (full name in the ask, else verb/filler-stripped remainder containment) → `engine.propose()` with `proposedBy: "staff"`, `sourceRef: {via: "copilot"}`; the answer composes the proposal's own title + preview + the queue line ("Control Center-এর প্রস্তাব তালিকায় অনুমোদনের অপেক্ষায়"). A repeat ask dedupes against the open proposal (engine rule) and says so. Multiple matches → `clarification` listing exactly those campaigns; no match → `clarification` listing the org's real campaigns (max 10 + a count of the rest); no campaigns at all → `refusal` naming the sync/connect step. A builder refusal (already-paused no-op, CSV/manual account) surfaces the builder's own Bengali reason as the answer — nothing created. A lifecycle verb with no campaign context and no name match is not an ads ask and falls through.
- **set_campaign_budget** — the amount is parsed from the ask (Bengali digits honoured; the matched campaign name's own digits are removed first, so "Eid 2026 … বাজেট ৫০০০" reads 5000) with a trailing k/হাজার multiplier; no amount → clarification asking for it, naming the campaign. The proposal rides the engine's money wall: `moneyAdjacent`, proposal-only at every autonomy level, and the answer repeats that approval never makes the engine move the budget itself (L5).
- **request_refund** — honestly NOT proposable from here: the engine's refund proposal is anchored to ONE conversation and a bare dashboard ask carries none, so the copilot refuses with the wall explained (proposal-only forever, L5) and the real path named (open the conversation in the Inbox; even after approval the team completes the refund through the staff path). Nothing is created; no conversation linkage is fabricated.
- **Conversation/comment catalog acts** (close/tag/assign/block, hide/delete/reply) — matched deterministically and refused with the real surface named (the specific conversation in the Inbox / the moderation queue / the Control Center proposal queue). The refusal never depends on the LLM remembering it cannot act.
- **execute() is never called** — the copilot has no reference path to it, and the ads set it can reach is medium-risk + money-adjacent, which the engine never auto-executes at any autonomy level either; the spec spies on `execute()` across every action test.

**Statelessness (recorded choice):** the DTO accepts up to 6 recent turns (`COPILOT_HISTORY_MAX_TURNS`), truncated per turn, used as context only (their numbers are NOT in the guard's allowed set — the guard judges against the CURRENT pack). No copilot table was created; a history/activity store is Phase-6/T4 scope, not smuggled in here.

**No-LLM org:** the Q&A path throws the typed 503 `{code: "LLM_NOT_CONFIGURED"}` (`CopilotLlmNotConfiguredError`, the family pattern of B19/B20's local classes) — never a template. The action path does not need an LLM and keeps working (spec'd).

## Item 2 — Specs (`apps/api/src/ai/copilot.spec.ts`, 16 tests, all passing)

Run against the REAL `ActionEngineService` + REAL `ActionExecutorsService` (SA-B10 harness: real InboxService/SocialCommentsService constructions on a fake prisma), so proposals are built by the actual SA-B15 builders:
- **Grounded Q&A:** fixture digests → the captured prompt carries all six labelled sections and the org's sentinel facts; an answer quoting only pack numbers passes with `guardNote: null`; exactly one `copilot`-bucket usage row.
- **Cross-org isolation:** org A's prompt contains none of org B's sentinels (goal text, the 777777 revenue figure, org B's campaign name).
- **Guard:** invented number → exactly one regeneration → clean rewrite served (`guardNote: "regenerated"`, 2 calls, 2 usage rows); second invention → prose withheld, `droppedNumbers` names the offender, sections attached.
- **Unknown/absent:** compliant "জানি না" passes through; the empty org gets the deterministic no-data answer with the provider never called.
- **No-LLM:** Q&A rejects with the typed 503; the action path still files its proposal.
- **Actions:** unique match → exactly one `pause_campaign` proposal (status `proposed`, `proposedBy: "staff"`, `sourceRef.via: "copilot"`), `execute()` spy silent, LLM never called; repeat ask dedupes to the same open row; remainder-ambiguity ("winter") → clarification with both real matches, zero proposals; unknown name → clarification listing only the asker's campaigns; budget ask → money-adjacent proposal with `requestedBudgetMinor: "500000"` parsed past the campaign name and the builder's live current budget (`"200000"`) in the payload; budget without amount → clarification, nothing created; refund ask → refusal naming L5 + the Inbox path, nothing created; conversation-act ask → deterministic refusal, nothing created.
- **Role gate:** the ask handler's role metadata is exactly `["OWNER", "ADMIN"]`.

## Gates (run strictly serially, recorded as each finished; numbers copied from real, unmasked output)

| Gate | Result |
|---|---|
| Targeted jest (ai + messaging + social + inbox + knowledge + organizations, `--runInBand`, 4096 heap) | **175 suites / 2,199 tests — all passed** (includes the new `copilot.spec.ts`, 16 tests; the run's log shows 175/175 suites and 0 FAIL entries) |
| API typecheck (`tsc --noEmit`) | **exit 0** |
| API build (`npm run build`) | **exit 0** |
| Fresh-PG (throwaway local PG, empty DB, `prisma migrate deploy`) | **230/230 applied, `migrate status`: "Database schema is up to date!"**, `_prisma_migrations` verified **230 finished / 0 unfinished** — with the environment deviation below. Throwaway cluster dropped afterwards |

**Fresh-PG deviation (environment, recorded honestly — the SA-B20 deviation, persisting).** This VM has **no pgvector and no system PostgreSQL at all** (no `/usr/lib/postgresql`, no docker; SA-B20's bundled PG is likewise absent). The untouched real chain applied 223 migrations and stopped exactly at `20261027000000_sai_vector`'s `CREATE EXTENSION vector` — "extension \"vector\" is not available" (error output captured) — environmental, not this batch's: SA-B21 adds **no migration** (`git status` over `packages/db` is clean for this batch; the chain's last folder remains B20's). The throwaway cluster for this run was a self-contained PostgreSQL 18.6 (Zonky embedded binaries, fetched to /tmp for this gate only, dropped after). To still prove the full chain, on the THROWAWAY DB ONLY, SA-B20's documented procedure was repeated exactly: a `vector` TEXT-domain stand-in was created, sai_vector's remaining DDL (its table/indexes/FK — everything except the extension line, copied verbatim from the shipped file) was applied, the migration was marked applied via `migrate resolve`, and `migrate deploy` then applied the remaining chain end-to-end — **230 finished, 0 unfinished**. The shipped migration files were never modified; on any pgvector-capable Postgres (the deployment's `pgvector/pgvector:pg16` image) the chain runs untouched, as it did for SA-B2…B19. The throwaway DB's `_prisma_migrations` keeps the original rolled-back sai_vector attempt row alongside its resolved record — a product of the recovery path on a disposable DB, not of the chain.

Pre-existing issues **not** touched (per brief): the `cc26-payout-automation` wallet-sweep spec failure (outside the targeted folders; base-proven pre-existing since SA-B3); the TelegramClient/ThreadsClient undecorated-param boot bug on this line (proven fix on the nf line, `b6dcc457`, owed at integration).

## NOT BUILT (G3)

- **A separate daily-briefing artifact/schedule** — the plan's "daily briefingও Brain থেকে" is served by the copilot itself: the pack IS the day's deterministic digests (performance/ads/competitor/creative), and "আজকের অবস্থা কী?" is answered from it with the guard applied. No new briefing document, push schedule or delivery surface was invented in this batch.
- **Copilot conversation history storage / activity UI** — stateless by design (client-carried turns only); the persistent activity record is Phase-6 T4's Control Center scope.
- **Web dashboard chat UI** — no chat panel was built in the tenant web app; the API is complete and tenant-reachable, and the response carries `sections` precisely so a UI can show an answer's sources. Recorded as a follow-up, not half-done.
- **Actions beyond the ads lifecycle/budget set from chat** — inbox/comment acts are refused with their real surfaces named (they need a concrete conversation/comment the dashboard ask does not carry); no catalog action was added, and none of the copilot's answers can execute anything.
- **Live verification** — nothing in G3 (or the Smart AI line) is proven against a real LLM key, Meta account or production data; M30 remains owed line-wide.

## Commits

| Commit | Item |
|---|---|
| `bc7fc356` | Item 1 — CopilotService + controller + DTO + ActionEngineModule wiring |
| `d49e5f7a` | Item 2 — specs (16 tests) |
| _(this commit)_ | Item 3 — SA-B21 acceptance + Phase-5 summary |
