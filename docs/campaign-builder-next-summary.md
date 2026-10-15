# Campaign Builder Next — Program Summary (CN1–CN12, 2026-10-15)

**THE CAMPAIGN BUILDER NEXT PACKAGE IS CODE-COMPLETE in the
sandbox (spec/fixture-proven). NOTHING in it is live-proven
against a real Meta / Google / TikTok account.**

Owner approved the whole CN1–CN12 package in full 2026-10-14
20:41 +06 ("পুরো Campaign Builder Next (CN1–CN12) অনুমোদন —
NB1 থেকে শুরু করো"). Plan:
`~/workspace/goals/ai-marketing-saas-platform-build/files/Campaign-Builder-Next-Plan-2026-10-14.md`.
Built in worktree `~/workspace/ai-marketing-saas-cn`, branch
`campaign-next`, base integration-3 `a3b62ed` (= GitHub main
`7443135` content). **Local commits only — NOTHING pushed**
(owner's push rule: every push triggers a Dokploy rebuild;
the push waits for his explicit instruction in that moment).

The package closed the 12 verified gaps (G1–G12) found by the
2026-10-14 re-audit of the released Campaign Builder: country-
only targeting, no bidding, hardcoded PURCHASE/page promoted
objects, unbuildable Lead Ads, one text per ad, audiences
external to the builder, an optimisation loop that stopped at
totals, single-account only, shallow cross-platform drafts,
a pre-Design-v2 hub/builder, single-step governance, and no
live-verification path.

Per-batch closing gates for NB5 are recorded in
`docs/campaign-builder-nb5-acceptance.md` (the closing batch
of this program).

## Item-by-item audit

| Item | Scope | Status | Batch / acceptance |
|---|---|---|---|
| CN1 | Targeting v2: location depth (cities + radius / zips / location types → `geo_locations`), locales, behaviors + demographics DTO-reachable, one narrowing AND layer, expansion toggle → `targeting_automation.advantage_audience`, Meta targeting search via the account's own connection (unavailable = honest `{available:false}`), id-carrying interest/behavior entries must be search-confirmed at save, per-ad-set readiness `estimates[]` | ✅ code-complete | NB1 · `campaign-builder-nb1-acceptance.md` |
| CN2 | Bidding & budget v2: bid strategy per ad set (`lowest_cost` / `bid_cap` / `cost_cap` / `roas_goal`, objective×strategy matrix spec-pinned; Graph mapping incl. `bid_constraints.roas_average_floor`), TRUE `budgetMode` abo\|cbo for all plans (migration `20261013810000`), pacing read-model from `DailyAdMetric` (honest `no_data` / `not_published`) | ✅ code-complete | NB1 · nb1 acceptance |
| CN3 | Conversion & catalog depth: event picker per ad set (objective×event matrix, `custom_event_type` in `promoted_object` — PURCHASE no longer hardcoded), readiness events row from the real CAPI setting/log (unknown stays unknown), REAL catalog ads (`product_set_id` + `template_data` dynamic creative; catalog/product set org/account-validated) | ✅ code-complete | NB2 · `campaign-builder-nb2-acceptance.md` |
| CN4 | Lead Ads complete: Meta lead-form creation CONFIRMED from the official Lead Ads guide and built for real (`LeadForm` model, migration `20261013820000`, privacy-URL hard gate, ≤12 questions, field mapping only to live CRM custom fields, create-on-Meta counts ONLY on a returned id, form→CRM mapping applied on leadgen ingestion for OUR forms only). **Custom conversions NOT built** — no current create path could be confirmed (only legacy v2.7-era docs + v24 restriction flags); the picker is standard-events only | ✅ code-complete (with the stated custom-conversions exclusion) | NB2 · nb2 acceptance |
| CN5 | Creative v2: multiple text options per ad (Json option sets, legacy fields = first option; link ads publish via `asset_feed_spec`, carousel/lead/catalog use first options with the fallback LOGGED + a readiness warning), per-placement asset overrides (asset-feed placement rules, base fallback), `degrees_of_freedom` enhancement toggles (unknown keys REFUSED at save), asset variants from the creative library + studio/social media with honest refusals. Migration `20261013830000` (3 Json columns on `CampaignAd`) | ✅ code-complete | NB3 · `campaign-builder-nb3-acceptance.md` |
| CN6 | Audience Studio INSIDE the builder, riding the EXISTING `AudiencesService` (no second system): sources buyers / recent purchasers (real orders), product viewers (tracker events), cart abandoners (EC10 open checkouts) with REAL `sourceCatalog` counts (empty source refuses), lookalike inline, exclusion presets as real inspectable ad-set selections, per-set size/overlap from real records (unknown stays unknown) | ✅ code-complete | NB3 · nb3 acceptance |
| CN7 | Optimisation loop in the builder: breakdowns from EXISTING `DailyAdBreakdown` rows (`hasData:false` per dimension when absent), creative leaderboard + fatigue via the Phase-K rule extracted VERBATIM into shared `ads/creative-fatigue.ts` (ONE definition; `AdsService` delegates), deterministic recommendations (dead = spend ≥৳500 & 0 conv; winner floor ৳100; shift 20%) — fatigued→fresh-DRAFT apply is the only mutating kind, budget-shift = proposal numbers only (ABO), dead-set pause via explicit click; guardrails via the PRE-EXISTING `AutomationRule.campaignPlanId` linkage with last-run evidence | ✅ code-complete | NB4 · `campaign-builder-nb4-acceptance.md` |
| CN8 | Multi-account & portfolio: cross-account clone with mapping report (`carried_verified`: page via SocialAccount / pixel via target prior use / audience via target ready record; `carried_user_confirmed` re-picks; everything else dropped + listed as blockers — nothing silently carried), account-health endpoint wired into pickers (unknown stays unknown), additive portfolio/totals endpoint (currencies never mixed; `listPlans` shape untouched) | ✅ code-complete | NB4 · nb4 acceptance |
| CN9 | Cross-platform v2: CB6 carry-over FIXED (uses CN2 effective budget labelled by mode, spec-pinned CBO vs ABO), new `CrossPlatformDraft` model (migration `20261013840000`) — drafts incl. blocked/export ones stored + editable within real platform fields + readiness-gated (platform never called on failure, spec-pinned) + local preview labelled not-a-platform-render + re-create via `PublishingService` PAUSED; status sync honestly `{available:false}` (no Google/TikTok status read path exists) | ✅ code-complete | NB4 · nb4 acceptance |
| CN10 | Design v2 hub + builder: `.cbx-*` campaign design primitives (additive, brand-token only), builder guided steps + sticky readiness/preview rail, hub v2 — server pagination via the CN11 paged envelope, performance columns from `includePerformance` (null = honest no-data marker), bulk bar (duplicate + status-sync only — no archive endpoint exists, none invented), saved-views rail, PLAN-LEVEL launch calendar (honestly labelled: ad-set dates are not in the list payload); zero-loss vs the NB4 hub baseline verified by set-diff (endpoints 23→31, lost 0; labels lost 0) | ✅ code-complete | NB5 · `campaign-builder-nb5-acceptance.md` |
| CN11 | Governance: @mentions in comments (ACTIVE-member longest-first resolution, `campaign_mention` notifications, author excluded), plan versions (submit-kind row on submit + manual snapshots + structural diff + restore into a NEW sibling draft, source never touched), two-step approval chain (`CampaignApprovalSetting`; step 1 stays pending, same-approver step 2 refused, OFF = legacy path), last-activity from the newest audit row (labelled not-presence), hub `listPlans` paged envelope + saved views CRUD scoped to owner. Migration `20261013850000_cn11_governance` (additive) | ✅ code-complete | NB5 · nb5 acceptance |
| CN12 | Live verification + hardening: the LOCAL deliverable is `docs/campaign-live-verification-checklist.md` — 27 items in sessions S1–S10 + deploy-time screenshot QA, **ALL UNCHECKED**. The verification itself is **NOT done and cannot be done from the sandbox**: it is owner-gated (needs the campaign-next build integrated + deployed, the CN migrations run on the real DB, and the owner's real Meta / Google / TikTok accounts entered by the owner into the app's verify-before-save forms). This is the campaign track of the M30 sprint | ⏳ local checklist shipped; live verification OWNER-GATED, entirely open | NB5 · nb5 acceptance + the checklist itself |

## NB5 closing mini-fix (carry-over closed)

NB4's recorded finding — `duplicatePlan`'s copy lagging the
CN3/CN4 ad-set fields — was assigned to NB5 and is FIXED
(commit `28269c3`): full-field copy parity via shared
`adSetCopyData` / `adCopyData` helpers; `duplicatePlan` gains
`dailyBudgetCapMinor` + the CN3/CN4/schedule/daypart ad-set
fields, `duplicateAdSet` ads gain the CN5 fields, and the CN8
`clonePlanToAccount` rides the same helpers with its mapped
values as overrides. Spec-pinned (`nb5-minifix` 2/2).

## Per-batch gates (as recorded at each batch's completion)

- **NB1** — API 328/328 suites 3300/3300, web 255/255, tsc 0/0,
  build green, fresh-PG 156/156 clean.
- **NB2** — campaigns spot-verified 17/17 suites 107/107;
  full runs recorded in the nb2 acceptance (sole failures
  the known cx3 flake / worker crashes, all passing solo);
  web 255/255, tsc 0/0, build green, fresh-PG 157/157 clean.
- **NB3** — scoped campaigns+audiences 20/20 suites 135/135,
  web 255/255, tsc 0/0, build green, fresh-PG 158/158 clean;
  full API run decomposed in the nb3 acceptance (cx3-debounce
  proven pre-existing on the pristine base; worker-crash
  suites passing solo).
- **NB4** — API FULL 334/334 suites 3331/3331 ALL PASS,
  web 255/255, tsc 0/0, build green, fresh-PG 159/159 clean.
- **NB5** — closing gate on the final tree: see
  `docs/campaign-builder-nb5-acceptance.md` for the exact
  numbers from the closing run (API jest serial, web vitest,
  tsc, prisma, build, fresh-PG over the full 160-migration
  sequence).

## Honest limits

- **Nothing is live-proven.** No real Meta / Google / TikTok
  account, token, or spend has touched any CN1–CN11 surface;
  every number above is spec/fixture evidence in the sandbox.
  CN12 (all 27 checklist items) remains entirely open and
  owner-gated.
- **Migrations NOT run on any real DB.** The CN migrations
  (`20261013810000`, `20261013820000`, `20261013830000`,
  `20261013840000`, `20261013850000`) are proven only in the
  fresh-Postgres sequence. The production DB migration run is
  part of the owner-gated deploy.
- **Custom conversions were NOT built** (CN4): no current
  Meta create path could be confirmed from official docs;
  the event picker is standard-events only.
- **Catalog `template_data` acceptance is unverified** — the
  payload shape is built to the documented contract; whether
  Meta accepts it for a real catalog is a CN12/S4 question.
- **Meta lead-form create has no idempotency** — a retry after
  a lost response can duplicate a form; the publish log +
  stored external id are the reconciliation trail. The
  lead-form token class (the ad account's integration token)
  is a CN12/S5 question.
- **CN9 status sync is honestly `{available:false}`** — no
  Google/TikTok status read path exists; cross-platform draft
  status is as-created, labelled as such.
- **No screenshot QA** — the CN10 design surfaces have no
  screenshots; the QA checklist is in the CN12 document and
  requires the deployed build.
- Breakdown / recommendation / pacing numbers are only as
  real as the tenant's Ads sync; recommendations are
  deterministic heuristics over synced rows, not predictions.

## Deploy checklist (ALL still open — nothing below has happened)

1. **Owner's explicit push instruction first** — then
   `ls-remote` + fetch GitHub main BEFORE any sync (the owner
   also pushes directly; his commits are merged, never
   overwritten, never force-pushed), integrate `campaign-next`
   with the other pending lines under the mandatory
   union fresh-Postgres migration check.
2. Manual Dokploy Redeploy by the owner.
3. Run the CN migrations on the real DB (part of the full
   pending sequence) + `prisma generate`.
4. CN12 sessions S1–S10 with the owner's real accounts,
   evidence recorded item-by-item in
   `docs/campaign-live-verification-checklist.md`.
5. Deploy-time screenshot QA (CN10) per the same checklist.
