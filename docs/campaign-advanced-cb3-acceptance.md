# Campaign Builder Advanced — Batch CB3 (CA10–CA14, Automation & Control) Acceptance

Date: 2026-10-17 · Branch `campaign-advanced` · Base: CB2 HEAD `da81c868` · Worktree `~/workspace/ai-marketing-saas-ca`
Status: **code-complete, all gates green. NOT pushed, NOT deployed, NOT live-proven** (no real Meta/automation account exercised any CB3 path; M30-style live verification remains owner-gated as always).

Commits (one per item, in order):

| Item | Commit | What |
|---|---|---|
| CA10 | `0fc4afb0` | Rules SUGGEST mode + approval queue (+ the batch's single migration) |
| CA11 | `66b74359` | CN7 budget-shift apply + multi-plan allocator |
| CA12 | `fc838884` | Plan-level scheduled pause/resume |
| CA13 | `e50c03c4` | Naming conventions |
| CA14 | `7ed5e666` | Server-side bulk operations |
| — | `4c373a3b` | Pre-existing base boot-bug fix (see "Boot smoke" below — NOT a CB3 feature) |

**One migration for the whole batch:** `20261030200000_cb3_automation_control` (claim recorded in the cross-track migration ledger before any code): `AutomationRule.mode` (DB default `'execute'`), new `RuleSuggestion` table, `CampaignPlan.pauseAt/resumeAt/pauseExecutedAt/resumeExecutedAt`, `BusinessProfile.campaignNamingTemplate`. House rules held throughout: real data only; every money move sits behind an explicit human approval in these flows (suggestion approve, allocator confirm, shift-apply confirm, bulk confirm dialogs) — **CB3 adds no automatic budget execution**; Bengali UI copy for new strings; additive API changes only.

---

## CA10 — Rules SUGGEST mode + approval queue

**What shipped.** `AutomationService.evaluateRules` keeps evaluating exactly as before; for a rule in `suggest` mode it calls the new `queueRuleSuggestion` instead of executing: same state guards (pause needs live ACTIVE, activate needs PAUSED, pause_ad needs breaching ads), the scale_budget cooldown check is honoured, dedupe refuses a second pending suggestion for the same rule+plan+action, and the suggestion stores the full action payload (scale percent/min/max; pause_ad ad ids) plus the evaluated facts (metric, value, threshold, comparator, windowDays) and the human-readable reason. An `AutomationRun` (kind `rule`, evidence carries `suggestionId` + `mode: "suggest"`) is still written and `lastTriggeredAt` advances, so run history stays truthful. **Alert rules are unchanged in both modes** — an alert executes nothing, so there is nothing to suggest.

**Approval.** `approveSuggestion` claims the row exactly once (`updateMany` from `pending` → `approved` with decider + timestamp; a second approve is refused), re-checks the state guards at decision time (a plan that stopped being ACTIVE yields an honest `skipped` outcome, executed = null), then executes through the **same** `CampaignsService` paths the engine itself uses (`setMetaStatus` / `scalePlanBudgets` / `setAdStatus`) — no forked execution logic. The verbatim execution result + `executedAt` are stored on the suggestion and an `AutomationRun` of kind `suggestion` is written. A failed execution is recorded as failed and **not** silently retried from the queue. `rejectSuggestion` uses the same claim pattern and never executes. `listSuggestions` lazily expires pending suggestions older than **7 days** (on read; there is no expiry sweep — recorded under limits) and enriches rule/plan names from real rows (null when the source row is gone, never invented).

**API/UI.** `GET automation/suggestions`, `POST automation/suggestions/:id/approve|reject` (OWNER/ADMIN/MARKETING_MANAGER). The queue lives where rules are managed — the Automations page Rules tab: pending cards with evidence + approve/reject, decided history with stored outcomes, a mode select in the rule form, and a per-rule mode badge + switcher.

**⚠ The default-mode decision (required reading).** The migration default for `AutomationRule.mode` is `'execute'`, so every rule created before CA10 keeps executing exactly as it did — nobody's automation silently changes behaviour because of an upgrade. **New** rules created through the API/UI default to `"suggest"` (the create form and `createRule` both default there), and the mode is changeable per rule at any time. Specs pin both halves of this (a legacy row with no mode still executes; a new rule defaults to suggest).

**Evidence.** `apps/api/src/automation/ca10-rule-suggestions.spec.ts` — **10/10**: new-rule default, queue-without-execution, dedupe, approve-executes-once + double-approve refusal, reject-never-executes, scale payload pass-through, decision-time guard skip, TTL expiry, cross-org isolation, legacy-row execution regression. Two pre-existing specs had their `createRule` fixtures pinned to `mode: "execute"` (they test the execute path; intent preserved).

## CA11 — CN7 budget-shift apply + multi-plan allocator

**(a) Budget-shift apply.** `planRecommendations`' `budget_shift` item is no longer text-only. `applyRecommendation` accepts kind `"budget_shift"` with the proposal the client saw (from/to ad set ids, shift, both after-values); the server **regenerates** the recommendation and compares all five fields. Any mismatch refuses with a structured body `{ message, freshProposal }` — the UI refreshes the list so the human sees the fresh numbers; **stale math is never applied**. The apply itself moves donor first, then winner, through the existing `updateAdSetBudget` (Meta-confirmed per leg). A winner-leg failure rolls the donor back and audits `campaign.budget_shift_failed { stage: "winner_leg", donorRolledBack }`; success re-reads both budgets, verifies them, and audits `campaign.budget_shift_applied { before, after, verified }`. Other recommendation kinds keep their honest refusal (the action kind `"budget_shift_proposal"` still refuses — the apply kind is `"budget_shift"`; documented choice).

**(b) Allocator.** `POST campaign-plans/budget-allocator/proposal|apply`. The proposal is deterministic, computed over a **30-day** window from **campaign-level** `DailyAdMetric` rows only (the planPacing counting rule — plan totals would double-count ad-set rows). Eligibility: published with a live campaign, not CBO (`cbo_no_live_budget_path` — there is no campaign-level live budget edit path in the codebase, CN7's ABO-only precedent), live daily total > 0, and spend > 0 **and** conversions > 0 (otherwise `no_evidence` with the evidence attached — weights are never invented). Efficiency gate: CPA must be ≤ the median CPA of the evidence-eligible set. Weight = conversions; per-plan cap = its current live daily total; water-filling redistributes capped remainders and reports `unallocatedMinor`; the receiving ad set per plan is the lowest-CPA set with conversions, else the largest-budget set (`targetBasis` stated). Apply is per plan as its own approved change: re-read, refuse per plan on `stale_daily_total` / `exceeds_cap` / `not_published` / CBO / zero, land it via `updateAdSetBudget`, verify by re-read, audit `campaign.budget_allocator_applied`; one plan's failure never fails the batch. A real mid-pass-mutation bug in the water-filling shares was caught by the spec and fixed (shares now computed from a pass-start snapshot).

**UI.** The builder's budget_shift card gains an Apply button (confirm dialog; stale refusals refresh the list to show fresh numbers); the Campaigns hub bulk bar gains the Allocator panel (total input → proposal table with per-plan evidence + Bengali exclusion reasons → confirm apply → per-plan verbatim results).

**Evidence.** `apps/api/src/campaigns/ca11-budget-apply.spec.ts` — **10/10** (incl. exact 30:9 water-filling split, caps + unallocated remainder, tampered/moved-number refusals, winner-failure rollback, apply success + stale side-by-side, cross-org) + `cn7-optimisation.spec.ts` regression green in the same run. `updateAdSetBudget` is stubbed at the service boundary in the spec — the real path is covered by the phase-i suites.

## CA12 — Plan-level scheduled pause/resume

**What shipped.** A published plan can carry a pause window (`pauseAt`, optional `resumeAt`; org timezone reported with the window) set/cleared from the builder. Execution is a new per-org automation job kind **`plan_schedule_sweep`** (5-minute template, **default OFF** — no `ScheduledJob` row exists until an org enables it). The sweep claims each due leg exactly once by stamping `pauseExecutedAt`/`resumeExecutedAt` **before** executing (re-runs are no-ops), then runs the existing `setMetaStatus` path. Honest outcomes: never-published or no-longer-live plans record `campaign.scheduled_*_skipped { reason: "not_live" | "not_paused" }`; failures audit `campaign.scheduled_*_failed { error }` and notify the plan creator. **Exactly one attempt per set window** — a failed leg does not silently retry; re-setting the window is the new instruction. Clearing a window resets both executed stamps, so a re-set window is a fresh instruction.

**Evidence.** `apps/api/src/campaigns/ca12-plan-schedule.spec.ts` — **7/7**: set + timezone + audit, draft refusal + resume-before-pause refusal + clear-resets-stamps, due-executes-once + re-run no-op, not-due untouched, not-live skip without retry, resume + manual-resume skip, failure audited + stamped once, cross-org isolation (+ `a4-job-templates.spec.ts` regression green).

## CA13 — Naming conventions

**What shipped.** The org naming template lives on `BusinessProfile.campaignNamingTemplate` (the Organization Settings record — additive, per the owner's settings directive), edited from a settings card in the builder rail next to the approval-chain setting, with token chips and a **live preview** (client mirror of the server renderer, labelled sample values; the server re-renders authoritatively). Tokens: `{product} {audience} {objective} {date} {platform}`. Save-time validation refuses unknown tokens, requires at least one token, caps at 200 chars; null clears.

**Renderer discipline.** Values come only from real records; a token without a value renders **empty and takes its neighbouring separator with it** — `"{product} - {audience} - {date}"` with no audience renders `"Panjabi - 2026-10-17"`, never a double dash or dangling separator (literal lead/trail separators join the pending-separator flow — a `"Sale {empty} {product}"` double-space case was caught by the spec and fixed).

**Application.** (a) At create (plan/ad set/ad, `useNamingTemplate` flag on the existing DTOs): the template renders **only** for a blank name or an explicit opt-in — a typed name is never silently overwritten, and a template that renders blank keeps the original name. (b) On an existing plan: a preview action renders plan + ad sets + ads from each level's real values (product from the ad's linked product, audience from the ad set's referenced saved audience) and shows the diff; apply re-renders and renames only items still matching the fresh render (per-item `stale_preview` refusal for tampered/stale entries), auditing `campaign.naming_applied` with the full diff. **Renames touch local records only — Meta object names are never changed** (stated in the API response and the UI).

**Evidence.** `apps/api/src/campaigns/ca13-naming.spec.ts` — **11/11**: renderer incl. separator collapse, setting validation/clear, blank-vs-typed-vs-opt-in create behaviour, byte-identical create without a template, `{product}` resolution at ad create, per-level preview diff, apply + tamper refusal, no-template refusal.

## CA14 — Server-side bulk operations

**What shipped.** `POST campaign-plans/bulk` (WRITE roles) over the existing single-item services: `pause`/`activate` → `setMetaStatus` (published only, else per-item `not_published`); `budget_percent` → `scalePlanBudgets` unchanged (empty result = per-item `no_live_budget_path`, e.g. CBO); `budget_fixed` → the new `adjustPlanBudgetsFixed`, which mirrors the percent path's live-set selection and `updateAdSetBudget` route but **pre-checks the delta against every set** — if any set would land at ≤ 0 the whole plan item is refused with **nothing changed**; `duplicate` → `duplicatePlan` (same account; the cross-account clone is untouched, not forked). The response is a per-item results array with `succeeded`/`failed` counts — **partial failure is reported as partial, never as success** — plus per-item audits from the underlying operations and one `campaign.bulk_action` summary audit. Items are org-scoped individually (a foreign id is a per-item `plan_not_found`, not a leak and not a batch failure). Whole-call validation refuses unknown actions, zero percent/fixed, and empty/oversized (>50) id lists before any item runs.

**UI.** The Campaigns hub multi-select bar now calls the server endpoint for Duplicate / Pause / Activate / Budget-% (confirm dialogs; the tally shown is the server's own; failed items stay selected for retry). Status-sync keeps its client loop — no bulk endpoint exists for it and none was invented.

**Evidence.** `apps/api/src/campaigns/ca14-bulk-ops.spec.ts` — **8/8** (Meta stubbed at the global-fetch boundary; the real `setMetaStatus`/`scalePlanBudgets`/`updateAdSetBudget` run): partial-failure reporting, activate mirror, percent scale, fixed ≤0 pre-check + valid apply, no-live-path, duplicate, cross-org isolation, whole-call validation.

---

## Boot smoke — a pre-existing base bug found and fixed (NOT a CB3 feature)

The mandated real Nest boot smoke **failed on first run** on this line: `Nest can't resolve dependencies of the TelegramClient (Function at index [0])`. This is the exact pre-existing base bug FB1 discovered with the program's first-ever module-graph boot — `TelegramClient` and `ThreadsClient` (SN-era, untouched by CB3) take an undecorated optional fetch function, so Nest cannot build the graph and **the API cannot boot at all** on any line that lacks the fix. Commit `4c373a3b` applies the identical one-line `@Optional()` fix the nf line used (`b6dcc457`), behaviour-neutral, as its own commit. After it: **boot PASS** — "Nest application successfully started", all CB3 routes mapped (`campaign-plans/bulk`, `settings/naming-template`, `:planId/naming/preview|apply`, `:planId/schedule`, `automation/suggestions[/approve|reject]`, allocator routes), and an unauthenticated probe of `GET /organizations/:id/campaign-plans` returned **HTTP 401** ("Missing or invalid Authorization header") — an auth error, not a crash. The same fix remains owed to any other line still lacking it at its next integration.

## Gates (all run serially, final tree at `4c373a3b` + this doc)

| Gate | Result |
|---|---|
| Targeted jest per item | CA10 10/10 · CA11 10/10 · CA12 7/7 · CA13 11/11 · CA14 8/8 |
| API jest — campaigns chunk | **43 suites / 318 tests pass** |
| API jest — automation chunk | **15 suites / 93 tests pass** |
| Worker module | untouched by CB3 (no worker files in the batch diff) — chunk not required |
| Web vitest (full) | **109 files / 893 tests pass** |
| tsc — API + Web | **0 / 0** |
| Monorepo build (`pnpm -r build`) | **exit 0** |
| Prisma validate | **valid** |
| Fresh Postgres 16 (throwaway instance, destroyed after) | **219/219 migrations applied clean** (218 CB2 + CB3's one); `AutomationRule.mode`, `RuleSuggestion`, the four `CampaignPlan` schedule columns and `BusinessProfile.campaignNamingTemplate` verified present |
| Nest boot smoke vs the fresh PG | **PASS** (after the base-bug fix above): app started, CB3 routes mapped, campaigns route probe → **401 auth error** |

Known pre-existing items, not chased (per brief): `cx3-debounce` flake, `cc26-payout-automation` deterministic failure, `social-pp1` parallel-load timeouts. Two pre-existing specs' `createRule` fixtures were pinned to `mode: "execute"` in CA10 (intent preserved — they test the execute path).

## NOT BUILT / honest limits

- **Nothing in CB3 is live-proven.** All specs run against fakes/stubbed Meta; no real account, rule sweep, or budget move has executed. Live verification stays in the owner's M30 track.
- **Suggestion expiry is lazy** (on read in `listSuggestions`) — there is no background expiry sweep; an unviewed queue can hold stale `pending` rows in the table until someone lists them (they display as expired once listed).
- **Budget apply paths are ABO-only.** Neither the CN7 shift apply, the allocator, nor bulk budget ops can move a CBO plan's budget — no campaign-level live budget edit path exists in the codebase (CN7 precedent); CBO plans surface as explicit exclusions/refusals, never silent skips.
- **Scheduled windows execute exactly once per set window** (CA12) — a failed leg is audited + notified, never silently retried; re-setting the window is the operator's new instruction.
- **CA13 renames are local-only** — Meta-side object names are not renamed (no rename call is made); the UI and API state this plainly.
- **Allocator evidence is campaign-level only** by design (double-counting rule); plans whose metrics exist only at ad-set level read as `no_evidence` rather than borrowing numbers.
- **The `plan_schedule_sweep` job is default OFF** — windows set in the builder do nothing until the org enables the job on the Automations page (the builder strip says so).
