# SA-B15 Acceptance — Phase 3, A2: Ads Actions through the Action Engine

- **Batch:** SA-B15 (Smart AI Phase 3, item A2)
- **Tree:** `~/workspace/ai-marketing-saas-sai`, branch `smart-ai`
- **Base HEAD:** `c13366d2` (SA-B14) · **Final HEAD:** see git log (5 commits: items 1–4 + this doc)
- **Date:** 2026-10-17 (+06)
- **Migration:** none (catalog + wiring are code). Fresh-PG confirms **229/229**.
- **Law in force (L5):** the AI never moves money or changes prices itself — budget changes are money movement → proposal-only forever. Pause/resume are lifecycle acts: executable through the engine only with approval + read-back verification.

---

## Step 0 — per-platform truth (verified in this tree)

### Campaign entity model

| Entity | What it is | Key facts |
|---|---|---|
| `AdAccount` | Per-org platform account | `platform ∈ meta|google|tiktok|manual`, `integrationId` nullable (null = CSV/manual, **no API path**), unique (org, platform, externalId) |
| `AdCampaign` | Synced campaign row | Unique (adAccountId, externalId). **`status` is never written by any sync on this line** (insights/CSV upserts update `name` only) — it is effectively always null and is **not** a platform-confirmed status record |
| `DailyAdMetric` | Digest/metrics rows | Campaign-level rule: `campaignExternalId != "" && adSetExternalId == "" && adExternalId == ""` (SA-B5/B14 single source) |
| `CampaignPlan` | Hub-created campaign (builder universe) | `externalCampaignId`, `metaStatus` (written **only after Meta confirms**), `metaEffectiveStatus` (via status sync), `campaignDailyBudgetMinor/Lifetime` (CN2), ad sets with `dailyBudgetMinor` |
| `CrossPlatformDraft` | Google/TikTok publication from a plan | `status = "created"` + `externalCampaignId` once published; `fields` Json carries the publish DTO |

### Lifecycle (pause/resume) — what the dashboard itself uses

| Platform | Hub path (service + method) | Confirmation representation | Verdict |
|---|---|---|---|
| **Meta, plan campaigns** | `CampaignsService.setMetaStatus(orgId, actorId, planId, "ACTIVE"\|"PAUSED")` — route `POST campaigns/:planId/pause` | Meta confirms first (`MetaPublishClient.setObjectStatus`), **then** `plan.metaStatus` is written. Resume gated by CC27 `assertCampaignAccountAccess`; pause never gated | ✅ REAL — engine route `meta_plan` |
| **Meta, synced (non-plan) campaigns** | No dashboard endpoint exists (the ads module has no lifecycle endpoints at all). The hub's client discipline is `MetaPublishClient.setObjectStatus/getObjectStatus` via the private per-account factory | No local record maintained (see `AdCampaign.status` above) | ✅ REAL via a new account-scoped hub pair (below) — engine route `meta_account` |
| **Google** | `PublishingService.crossPlatformSetCampaignStatus(orgId, actorId, adAccountId, "google", externalId, target)`; plan-created campaigns ride `CampaignsService.setCrossPlatformDraftLifecycle` (CC27 gate + publish log) | Provider call throws unless Google accepts; **no local record** — the hub's own read-back is the live `crossPlatformCampaignStatus` → `{ providerStatus, providerStatusRaw }` (verbatim `ENABLED\|PAUSED\|REMOVED`) | ✅ REAL — engine routes `cross_draft` / `cross_platform` |
| **TikTok** | Same PublishingService methods with `"tiktok"` (`TikTokManage.setCampaignStatus` ENABLE/DISABLE; `getCampaign` read) | Same as Google: live read-back, `operation_status` mapped to active/paused | ✅ REAL — same routes |
| **CSV/manual accounts** | None — no `integrationId`, no credentials, no platform session | — | ❌ **Platform gap, named**: builder refuses; no catalog executor pretends otherwise |

**Hub extension added in this batch (Item 2):** `CampaignsService.setMetaCampaignStatusByAccount` + `getMetaCampaignStatusByAccount` — an account-scoped twin of `setMetaStatus` with identical discipline (CC27 gate on activation only; Meta confirms first through the account's own client; failure throws `Meta did NOT confirm the status change: … Local status is unchanged.`). Deliberately **no local status write**: no sync maintains `AdCampaign.status`, so a value written there would later masquerade as platform truth; the verifier reads Meta live instead.

### Budget — read and edit truth

| Question | Truth on this line |
|---|---|
| Budget EDIT | Meta plan ad sets only: `CampaignsService.updateAdSetBudget` → `MetaPublishClient.updateAdSetBudget` (a human staff path). Google/TikTok edit **does not exist on this line** (the CA package is absent — this line branched before CA; recorded at SA-B14) |
| Budget READ (for a preview) | **No platform client has a budget read** (Meta client: create/update only; Google manage client: status only; TikTok `getCampaign`: status fields only). The only honest current-budget sources are hub records: a Meta plan's campaign budget fields, or its ad sets' stored budgets (Meta-confirmed at publish/last edit), or a draft's explicit minor-units field |
| Engine consequence | `set_campaign_budget` is proposal-only by law **regardless** of edit paths; its builder reads the current budget from the hub records above and **refuses targets with no honest source** (synced non-plan campaigns of any platform), naming the gap instead of inventing a number (L2) |

### M47 ads proposal flow (must not break — it doesn't)

- `ai/proposals.service.ts`: plan-keyed, Meta-only types (`pause_campaign`, `pause_ad_set`, `resume_campaign`, `resume_ad_set`) executing via `CampaignsService.setMetaStatus/setAdSetStatus`; `GrowthCopilotService.applyAction` proposes + auto-approves on the M47 rails (bleeder rule: spend ≥ ৳1,500, 0 conversions). **Untouched by this batch.**
- The engine's catalog ids intentionally share the type strings (`pause_campaign`/`resume_campaign`): same acts, different rails. Engine rows always carry `actionId != null`; M47 rows never do; each flow's lookups filter on exactly that (SA-B10's EXTEND decision), so the shared names never cross-resolve. M47 suites are inside the gate-1 regression set and pass.

### Two reconciliations (brief vs shipped reality), recorded honestly

1. **SA-B14's anomaly flags are org-totals-level, not per-campaign.** `detectAnomalies(totals, priorTotals, …)` names no campaign. Item 3's premise was adjusted, not faked: the proposer applies SA-B14's **own named thresholds** (`ADS_ANOMALY_THRESHOLDS`) at campaign grain over the same rows/windows (see Item 3). A totals-level flag is never reinterpreted as a campaign flag.
2. **The brief's verifier premise ("the local record the hub maintains") holds only for Meta plans.** For every other route the hub maintains no local status record; the verifier therefore uses the hub's own status read (a live platform read — `crossPlatformCampaignStatus` / `getMetaCampaignStatusByAccount`). Semantics below.

---

## Item 1 — Catalog ads entries (commit `d5d0daba`)

Surface `"ads"` added (`ActionSurface`, `ActionWiring` gains `"b15"`). Catalog v2 = 15 entries.

| id | surface | risk | moneyAdjacent | executor / verifier | undoable | wiring |
|---|---|---|---|---|---|---|
| `pause_campaign` | ads | medium | false | `ads.pause_campaign` / `ads.pause_campaign.verify` | true (resume undoes) | b15 |
| `resume_campaign` | ads | medium | false | `ads.resume_campaign` / `ads.resume_campaign.verify` | true (pause undoes) | b15 |
| `set_campaign_budget` | ads | high | **true** | none / none (builder only — the `request_refund` wall) | false | never |

No platform is missing a pause/resume entry: all three API platforms have a verified lifecycle path (Step 0). The gap is per-**target**, not per-platform: CSV/manual accounts get no executor because they have no path — enforced by builder refusal, named in the preview/refusal text.

## Item 2 — Executors + verifiers (commit `fba1914d`)

**Target resolution** (builder, org-scoped): input `{ platform, campaignExternalId, adAccountId? }` → exactly one route — published CampaignPlan (Meta) → `meta_plan`; created CrossPlatformDraft (Google/TikTok) → `cross_draft`; synced `AdCampaign` row on an API-connected account → `meta_account` / `cross_platform`. Ambiguous same-id campaigns across accounts refuse (name `adAccountId`); unknown campaigns 404; CSV/manual accounts refuse naming the gap. The only locally-knowable state (a plan's `metaStatus`) also guards no-ops: proposing a pause for an already-PAUSED plan is refused, like the inbox builders refuse already-closed targets.

**Executors** call the hub's own lifecycle method per route — `setMetaStatus` / `setMetaCampaignStatusByAccount` / `setCrossPlatformDraftLifecycle` / `PublishingService.crossPlatformSetCampaignStatus`. No parallel writes anywhere.

**Verifier semantics (recorded per the brief):**
- `meta_plan`: re-reads the plan row — `metaStatus` is written **only after Meta confirms**, so this is a read of platform-confirmed state.
- `meta_account` / `cross_*`: live read-back through the hub's own status read at verify time; the result reports **exactly what the platform says then**.
- Any observed state ≠ target → engine records **FAILED `verification_mismatch`** with the observed state (and raw provider enum) in `verification.detail`. A verifier read that itself fails lands as FAILED too (engine semantics), with the error in the verification detail. Platform API failure inside the executor → **FAILED with the error verbatim**. Nothing is ever recorded as a hopeful success.
- `set_campaign_budget`: builder only (Meta plan current budget from hub records; draft minor-units field; otherwise refusal). No executor/verifier exists; approval records `proposal_only`; `execute()` refuses at every level.

**Module wiring:** `ActionEngineModule` now also imports `CampaignsModule` + `PublishingModule` (neither imports back — leaf discipline preserved). `ActionExecutorsService` takes the two hub services as `@Optional()` constructor deps (the CampaignsService optional-injection precedent), so all existing constructions keep working.

## Item 3 — Deterministic proposers (commit `e014b3c8`)

- **Trigger:** `AdsIntelligenceService.suggestFindings` announces `ads.digest_computed` (org id + period only — bus discipline) on the global event bus. That is the one path the `ads_intelligence_sweep` job and the on-demand suggest endpoint share. `AdsActionProposerService` (ActionEngineModule) subscribes — same acyclic pattern as SA-B11/B12. Fire-and-forget safe twice over (bus isolation + handler catch).
- **Rules (campaign grain, SA-B14 thresholds verbatim, same row rule + `performancePeriod` windows, grouped per platform + ad account + campaign):**
  - `zero_conversion_spend`: campaign spend ≥ ৳1,000 in the window, 0 platform conversions → propose `pause_campaign` for **that** campaign.
  - `roas_collapse`: campaign ROAS fell ≥ 40% vs its **own** prior window, prior ROAS ≥ 1.0, both windows' spend ≥ ৳1,000 → propose `pause_campaign`.
  - `spend_spike` alone → **proposes nothing** (may be legitimate growth — deliberate non-rule). `ctr_drop` → no rule (creative fatigue is SA-B16's surface).
- **Caps/order:** at most 5 proposals per digest; zero-conversion burners first, then collapses, largest spend first.
- **sourceRef:** `{ source: "ads_digest", rule, windowDays, periodStart, periodEnd, platform, campaignExternalId, evidence }` — digest period + campaign, as briefed.
- **Dedupe:** the engine's propose() was extended with the ads identity — payload `campaignKey` (`platform::account::campaign`), mirroring the commentId pattern; budget proposals also compare requested amount + kind. Repeated digest runs return the open proposal (`deduped: true`), never a duplicate.
- **Autonomy:** default L1 — a proposed pause waits for a human. `pause_campaign` is medium risk, so **L2 never auto-executes it** (engine gate; spec'd here). L0 refuses with the typed result.

## Item 4 — Specs (commit `228154da`)

`apps/api/src/ai/actions/sa-b15-ads-actions.spec.ts` — **18 tests, all pass.** Hub services stubbed at the service boundary (the codebase pattern — production paths stay real):

- Catalog integrity for the b15 entries; budget builder-only (no executor/verifier registered anywhere).
- Meta plan pause through `setMetaStatus` + verifier on the confirmed plan record; unconfirmed → FAILED `verification_mismatch` with observed `ACTIVE` recorded; platform failure → FAILED verbatim, local state untouched.
- Google pause via PublishingService + live read-back; unconfirmed (still `active`) → FAILED `verification_mismatch`. TikTok resume mirrors.
- Meta synced campaign via the account-scoped pair + live read-back; plan-draft route via `setCrossPlatformDraftLifecycle`.
- Builder refusals: CSV account, unknown campaign, already-paused plan, foreign-org target — all named, zero rows created.
- Budget: preview states current (hub record, incl. ABO ad-set-sum fallback) + requested; approve → `proposal_only`; `execute()` refuses at L1 **and** L2; no-source targets refused.
- Autonomy in context: L1 waits, L2 does not auto-execute medium, L0 refuses.
- Cross-org: org B approve/execute of org A's proposal → 404; org A's proposer never reads org B's campaigns; org B's unresolvable burner files nothing.
- Proposer: flagged campaigns only (healthy + spend-spike-only in the same digest get none; ad-set-level rows excluded by the row rule); dedupe on repeated runs; full chain `suggestFindings → bus → proposer → engine rows`.

**Control Center queue (no web UI built, per brief):** verified — the SA-B13 "AI নিয়ন্ত্রণ" section renders proposals generically from the API rows (title, preview, status, result/error, approve/reject), so ads proposals appear with no ads-specific UI. One cosmetic note: `surfaceLabel()` has cases for inbox/comment and falls back to the raw string, so the surface chip shows `ads` (not a Bengali label) — deliberately left untouched under the no-web-UI instruction.

## Gates (serial, recorded as each finished)

| Gate | Result |
|---|---|
| Targeted jest — `src/ai src/ads src/campaigns src/publishing src/inbox src/automation` (4096 heap, runInBand; includes M47 suites, engine suites B10–B12, B14 digest suite) | **162 suites / 1,478 tests — all pass** |
| api tsc (`tsc --noEmit`) | **exit 0** |
| api build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG (throwaway local PG 16 + pgvector, empty DB, `prisma migrate deploy`) | **229/229 applied, 0 unfinished** — no new migration, as expected. First attempt died mid-deploy on an environment fault (the 512M `/tmp` tmpfs filled by the jest cache — `No space left on device` in the server log, migration `20261010400000_m40_control` a victim, not a cause); after clearing the regenerable cache and resetting the DB, the full deploy passed cleanly. Throwaway cluster dropped afterwards |

Pre-existing issues **not** touched (not in this batch's scope, per brief): `cc26-payout-automation` wallet-sweep spec failure (outside the targeted folders; base-proven pre-existing since SA-B3); the TelegramClient/ThreadsClient undecorated-param boot bug on this line (fix exists on the nf line, `b6dcc457`, owed at integration).

## Commits

| Commit | Item |
|---|---|
| `d5d0daba` | Item 1 — catalog ads entries (+ `"ads"` surface, `"b15"` wiring) |
| `fba1914d` | Item 2 — hub account-scoped Meta pair; ads executors/verifiers; module wiring |
| `e014b3c8` | Item 3 — digest bus announcement; AdsActionProposerService; engine campaignKey dedupe |
| `228154da` | Item 4 — sa-b15 spec suite (18 tests) |
| (this doc) | Acceptance record |

Local commits only — **not pushed** (owner's push gate).

## NOT BUILT (named, nothing silent)

- **Creative intelligence = SA-B16** (A3 + Phase-3 close-out) — untouched here, including any `ctr_drop` proposer.
- **Google/TikTok budget/targeting EDIT = platform gap on this line** (CA package absent — branched before CA). No engine path pretends otherwise; budget proposals for those platforms also lack a current-budget source and are refused by the builder with the gap named.
- **Meta budget edit through the engine — never** (L5): `updateAdSetBudget` remains a human staff path; the engine's budget action is proposal-only forever.
- **No budget READ in any platform client** — the builder's hub-record scope is the honest limit of this batch.
- **Live verification = M30**: every platform call in this batch is proven against service-boundary stubs and fixtures only; no real Meta/Google/TikTok account has confirmed a pause/resume through the engine. Unproven live, labelled as such.
- **Bengali surface label for "ads" in the web Control Center** — renders via the existing fallback (`ads`); a label addition is a trivial follow-up, not built under this batch's no-web-UI instruction.
- **Engine undo** — still metadata only (catalog `undoable` describes the counter-action, as in B10–B12); pause↔resume as separate proposals is the mechanism.
