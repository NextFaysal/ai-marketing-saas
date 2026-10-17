# SA-B14 Acceptance — Smart AI Phase 3, Batch A1: Ads Report Intelligence

**Batch:** SA-B14 (Phase 3 item A1) · **Branch:** `smart-ai` · **Base:** `2f67645b` (SA-B13) · **Date:** 2026-10-17
**Scope:** deterministic ads digest + guarded narration, INTERNAL class only (law L3). No web UI. No migration (verified: `LearnedItem.sourceType` is a plain `String` column — the `"ads"` value is a code-level union only).

| Item | Commit |
|---|---|
| Item 1 — AdsIntelligenceService (deterministic core) + Brain section + API + sweep wiring | `8744af04` |
| Item 2 — Guarded narration (only LLM surface) | `6b6693ca` |
| Item 3 — Specs (22 tests) | `dece9128` |
| This document | (docs commit) |

---

## Step 0 — Inventory of what already existed (verified in this tree)

A1 EXTENDS these surfaces; nothing below was rebuilt.

- **DailyAdMetric** (`packages/db/prisma/schema.prisma`): one row per account/day/level. `platform` string (`meta`/`google`/`tiktok`), `source` (`api`|`csv`|`manual`), `campaignExternalId`/`adSetExternalId`/`adExternalId` (default `""`), `campaignName`, `date` (UTC midnight), `currency` (default BDT), `spendMinor` BigInt, `impressions`, `clicks`, `reach`, `videoViews`, `platformConversions`, `platformConversionValueMinor`.
- **SA-B5 PerformanceLearningService.adsMetrics** (`ai/performance-learning.service.ts`): campaign-level totals (spend / conversions / value / ROAS) + top-5 campaigns by conversion value, trailing 7/30-day windows via the exported `performancePeriod(days, now)` (calendar-aligned UTC `[start, end)`). Campaign-row rule: `campaignExternalId != "" && adExternalId == "" && adSetExternalId == ""`. The snapshot has **no** platform split, no impressions/clicks/CTR, no bottom campaigns, no pacing, no period deltas.
- **AdsService** (`ads/ads.service.ts`): ad accounts + health bands (`ads/ad-health.ts`), Meta/Google/TikTok insights sync, manual/CSV metric entry, spend watchdog (`ads/spend-watch.ts`), creative leaderboard (`ads/creative-fatigue.ts`: fatigued = frequency ≥ 3.5 AND CTR drop ≥ 30% vs the prior equal window — the platform's one fatigue definition; A1 does not fork it), a CTWA report, breakdowns.
  - **Recorded flaws in the existing `GET pacing` endpoint (noted, NOT fixed in this batch):** it takes a caller-supplied `monthlyBudgetMajor` instead of the BusinessProfile budget; its row filter excludes only ad-level rows, so ad-set rows can double-count against the SA-B5 campaign-row rule; and it reads a nonexistent `conversions` field off metric rows. A1 deliberately does not reuse it.
- **ai/anomaly.ts `detectAnomalies`**: last-day vs 7-day-baseline over a combined orders+spend daily series (spend_spike +50%, orders_drop −40%, revenue_drop −40%, cpa_spike +50%, spend_no_sales, tracking_gap; min baseline orders 5). Consumed only by the AI-chat tools — not campaign/period-based, so A1's period-over-period flags are new but non-overlapping.
- **GrowthCopilotService** (`ai/growth-copilot.service.ts`): 7-day opportunity scan (scale_winner / pause_bleeder / creative_fatigue / retargeting / inventory_guard) + health score. Its apply-action rides the M47 ProposalsService — that is SA-B15's seam, not A1's.
- **Campaign execution side**: the campaigns module (builder + CN11 hub views) and OU4 platform manage clients (Meta/Google/TikTok: status sync + lifecycle) exist. **The CA package (CA1–CA28) is NOT in this tree** — this line branched before CA (verified). Hub-side Google/TikTok budget/targeting **edit** remains a gap — named in NOT BUILT for SA-B15 (A2) to inventory.

### Single-computation decision (digest vs SA-B5 snapshot)

The digest reuses SA-B5's exact campaign-row rule and `performancePeriod` windows, plus its BigInt/round2 conventions, so trailing-7d digest totals can never disagree with the PerformanceSnapshot. `adsMetrics` itself is untouched. A spec computes both from identical fixtures and asserts equality (spend / conversions / value / ROAS).

---

## Item 1 — AdsIntelligenceService (deterministic, NO LLM)

`apps/api/src/ai/ads-intelligence.service.ts` — `computeDigest(orgId, {days: 7|30, now})`:

- **Windows**: current = `performancePeriod(days, now)`; prior = the equal window immediately before. One `findMany` over `[priorStart, currentEnd)`, campaign-level rows only.
- **Totals + deltas**: spend, impressions, clicks, CTR, conversions, conversion value, ROAS for current and prior, with % deltas (null when there is no prior data — never a fabricated baseline).
- **Platform split**: per-platform totals, sorted by spend desc.
- **Campaign ranking**: grouped by `platform::campaignExternalId`, display name from the AdCampaign row when present (SA-B5 freshness rule), else the metric row's name. Only campaigns at/above the spend floor with a computable ROAS qualify, sorted ROAS desc. Top = first 3. **Bottom = last 3, and only when more than 3 qualify** (a bottom list drawn from ≤3 qualifiers would be a padded duplicate of the top list). Below-floor campaigns are counted in `campaignsBelowFloor` — visible, never silently hidden.
- **Budget pacing** (`computePacing`): month-to-date campaign-level spend from the UTC month start vs the org's BusinessProfile `monthlyBudgetMinor`/`budgetCurrency`; expected-by-now = budget × dayOfMonth / daysInMonth; pace %; projected month-end spend flagged `projectedIsEstimate: true` and labelled আনুমানিক in every rendered line. **No budget set → `budgetSet: false`, all target fields null, and the fact line states pacing was not computed** (MTD spend is still reported — it is real).
- **Anomaly flags**: each carries the exact evidence numbers that tripped it (see thresholds table).
- **Output**: typed `AdsDigest` + Bengali `factLines` (period-labelled head; totals; delta line; per-platform lines, zero rows skipped; top/bottom lines; below-floor line; pacing line; anomaly lines prefixed `সতর্কতা (type):`; no data → a single honest line) + English `findings` (≤3, for the review queue: anomalies first, max 2, then the top campaign, then over-pacing at pace ≥ 110% labelled "(estimate)").

### Surfaces

- **(a) OrgBrain INTERNAL context**: `OrgBrainContext.adsDigest` / `adsFacts`, computed live (7d) inside the existing `if (!customer)` zone beside the performance block. Customer and own_customer contexts are structurally untouched — the fields are `null` / `[]` and no ads number ever enters them (sentinel spec).
- **(b) Read API**: `GET organizations/:organizationId/ads-intelligence?days=7|30` (`AdsIntelligenceController`, `@PermissionArea("ai")`, TenantGuard + RolesGuard; member roles read). `POST .../suggest` and `POST .../narrate` restricted to OWNER / ADMIN / MARKETING_MANAGER.
- **(c) Suggested learnings**: `suggestFindings()` files the digest's top findings (≤3) as `LearnedItem` kind `fact`, **new sourceType `"ads"`**, via the existing `LearningService.createSuggestion` dedupe wall. Delivered two ways, per existing patterns: on-demand (`POST .../suggest`) and the new `ads_intelligence_sweep` automation job (`AutomationService` case → `runSweep()`, cap 200 orgs, one org's failure never stops the sweep, LearningState source `"ads_intelligence"`). `LearningService` changes: union += `"ads"`; `defaultApprovalVisibility` → internal; **approve() forces INTERNAL for `sourceType === "ads"` exactly like `"performance"`** (an approver cannot make ad spend/ROAS customer-quotable — law L3).

### Thresholds & floors (constants in code)

| Constant | Value | Meaning |
|---|---|---|
| `ADS_DIGEST_WINDOWS_DAYS` | `[7, 30]` | supported digest windows |
| `ADS_CAMPAIGN_RANK_MIN_SPEND_MINOR` | 50,000 (৳500) | ROAS ranking floor — a ৳10 campaign with one sale cannot top the list |
| `spendSpikePercent` | +50% vs prior | spend_spike threshold |
| `spendSpikeMinCurrentSpendMinor` | 100,000 (৳1,000) | spend_spike absolute floor (relative moves on tiny spend stay silent) |
| `roasCollapseDropPercent` | −40% | roas_collapse threshold |
| `roasCollapseMinPriorRoas` | 1.0 | collapse is only meaningful from a working baseline |
| `roasCollapseMinSpendMinor` | 100,000 (both periods) | roas_collapse data floor |
| `zeroConversionMinSpendMinor` | 100,000 (৳1,000) | zero_conversion_spend floor; severity critical at ≥ 5× |
| `ctrDropPercent` | −30% | ctr_drop threshold (matches the platform's one fatigue definition in `creative-fatigue.ts`) |
| `ctrDropMinImpressions` | 1,000 (both periods) | ctr_drop data floor |

Prior-dependent flags (spike / collapse / CTR drop) require prior-period data; zero-conversion is current-only. No flag fires on thin data — spec-proven.

## Item 2 — Guarded narration (the only LLM part)

`narrate(orgId, actorId, {days})` on the same service + `POST .../narrate`:

- Digest is computed first and is complete on its own. No data → `narration: null`, note `"no_ads_data"`, and the provider is never even resolved.
- Provider resolution follows the VoiceLearningService template (test seam → org LLM config → platform config; only a real LLM counts). Kill-switched org → `"ai_disabled_for_org"`; no real provider → `"no_real_llm_provider"`; provider throw/empty → `"llm_call_failed"`.
- The prompt contains ONLY the computed fact lines; the system prompt (bn, or en when `BusinessProfile.aiReplyLanguage === "en"`) forbids any number not in the facts; ≤ 4 sentences; maxTokens 400.
- `AIUsageRecord` written for every completed call (feature `"ads_intelligence"`) — before the guard verdict, so dropped narrations are still accounted.
- **Guard**: every number extracted from the narration via the shared `extractGuardNumbers` must appear in the fact set. Any unsupported number → the **whole narration is dropped** (`narration: null`, note `"dropped_unsupported_numbers"`, offending numbers named in `droppedNumbers`); it is never edited into compliance, and the digest/facts are returned untouched (law L2).

## Item 3 — Specs (`apps/api/src/ai/ads-intelligence.spec.ts`, 22/22)

- Digest numbers equal hand-computed fixtures (totals, platform split, prior deltas) and **equal SA-B5's PerformanceSnapshot ads totals on identical fixtures**.
- ROAS floor: tiny-spend ROAS-10 campaign excluded from ranking, counted in `campaignsBelowFloor`; bottom list empty at ≤3 qualifiers.
- Pacing: exact expected/pace/projected values with a budget; `budgetSet: false` + no invented target without one.
- Anomalies: spike / ROAS collapse / zero-conversion (critical at 5×) / CTR drop each fire alone on crafted deltas with their evidence; thin data (below floors, no prior) stays silent.
- Narration guard: invented numbers → narration null + note + dropped numbers named + facts intact + usage recorded; faithful narration passes verbatim; no provider → honest note; no data → provider never resolved.
- Brain wall: internal context carries the digest; customer + own_customer contain no ads sentinel (name, header, digest fields null/empty); another org's internal context is clean.
- LearnedItem: findings filed SUGGESTED with sourceType `"ads"`, dedupe on re-run, data-less org skipped with reason; **approval forces INTERNAL even when `"public"` is requested**.
- Cross-org isolation on digest, suggest, and the API controller.

## Gates (strictly serial, recorded as each finished)

| Gate | Result |
|---|---|
| Targeted jest — ai + ads/campaigns + inbox + knowledge + organizations | **162 suites / 1,557 tests, all pass.** Run per-area serially (ai 41/404 · ads+campaigns 44/345 · inbox 59/611 · knowledge+organizations 18/197) after a single combined invocation died on the Node 2 GB heap limit (OOM, not a test failure). New spec: 22/22. The known cc26 wallet-sweep failure lives outside these areas and is unchanged from base. |
| api tsc (`tsc --noEmit`) | **0 errors** |
| api build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG (local PG 16 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **229/229 applied, 0 unfinished** — no new migration in this batch, as expected (sourceType is a plain String). Throwaway DB dropped afterwards. |

Pre-existing issues NOT touched and NOT attributed to this batch: the cc26 wallet-sweep spec failure (base-proven at SA-B3); the sai line's full-process boot block on the TelegramClient/ThreadsClient undecorated-param bug (fix exists on the nf line, `b6dcc457`, owed to sai at integration).

## NOT BUILT (named, not papered over)

- **Ads actions** (pause/scale/budget edits through the Action Engine, Growth-Copilot/M47 seam) — **SA-B15 (A2)**.
- **Creative intelligence** (creative-level digest, fatigue roll-up into A1) — **SA-B16 (A3)**. A1 consumes campaign-level rows only; the existing `creative-fatigue.ts` leaderboard is unchanged.
- **Google/TikTok hub budget/targeting EDIT gap** — the hub manages status/lifecycle for Google/TikTok; budget/targeting edit on those platforms is not in this tree (the CA package is not on this line). SA-B15 (A2) inventories it before building actions.
- **AdsService `GET pacing` flaws** (caller-supplied budget, ad-set double-count risk, nonexistent `conversions` field read) — recorded in Step 0, deliberately not fixed here; A1's pacing is a separate, correct computation.
- **Web UI** — none in this batch by design; the digest API is the surface for the dashboard/copilot consumers (copilot = Phase 5).
- **Live verification** — nothing here is live-proven with real ad accounts; that remains **M30** (owner's real accounts/keys).
