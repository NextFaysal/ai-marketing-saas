# NB4 Acceptance — CN7 Performance & Optimisation + CN8 Multi-Account & Portfolio + CN9 Cross-Platform v2

Batch NB4 of the Campaign Builder Next package (CN1–CN12,
owner-approved in full 2026-10-14). Built on campaign-next over
NB3's close (059de02). Local commits only — NO push.

## Commits

- `f92c186` — CN7+CN8+CN9 API core + CN9 schema/migration +
  specs (cn7 7, cn8 6, cn9 7 = 20 new tests).
- `3ebdeda` — CN7+CN8+CN9 web (builder panels/cards + the
  ad-set status route the dead-set pause rides + hub
  portfolio strip).
- (this doc follows in the NB4 close-out commit)

## CN7 — Performance & optimisation in the builder (what shipped)

- **Breakdowns in the plan view** — `GET :planId/performance-breakdowns`
  aggregates the EXISTING `DailyAdBreakdown` rows (the Ads
  sync's own records; no second sync or pipeline) by the
  plan's external campaign id. Dimensions: `age_gender` as
  stored, additionally split into **age** and **gender** views
  from the same `"25-34:male"` keys, plus placement, device,
  and any other stored dimension (region/hourly) generically.
  Per key: spend/impressions/clicks/conversions + CTR + CPA.
  A dimension with no rows reports `hasData: false` — an
  honest empty, never zeros dressed as data. Unpublished plan
  → `published: false`.
- **Creative leaderboard + fatigue per ad** —
  `GET :planId/creative-insights` computes the plan's own ads
  through the ONE Phase-K rule. The aggregation was extracted
  verbatim from `AdsService.creativeLeaderboard` into
  `apps/api/src/ads/creative-fatigue.ts`
  (`computeCreativeLeaderboard`), and AdsService now delegates
  to it — the Ads page and the builder can never drift into
  two fatigue definitions. Rule, stated in the payload:
  fatigued = frequency ≥ 3.5 AND CTR drop ≥ 30% vs the previous
  equal window. Plan ads with no synced rows are listed with
  `hasData: false`.
- **Recommendations panel** — `GET :planId/recommendations`,
  compute-on-read, **mutates nothing**, every item carrying
  its evidence numbers and the named thresholds
  (`DEAD_AD_SET_SPEND_MINOR = 50000` ৳500, `WINNER_MIN_SPEND_MINOR
  = 10000` — the CB5 A/B floor, `BUDGET_SHIFT_PERCENT = 20`):
  - *fatigued_creative* → the one apply endpoint
    (`POST :planId/recommendations/apply`, kind
    `create_fresh_draft`) creates a NEW DRAFT copy of the plan
    via the existing duplicate path (the CB5 pattern) where
    the human swaps the creative; the live campaign is
    untouched. Any other kind REFUSES here, naming its real
    path.
  - *dead_ad_set* (spend ≥ threshold, zero conversions) →
    pause suggestion; execution is the explicit click through
    the ad-set status path. Note: `setAdSetStatus` (Meta-first)
    existed as a service method used internally by status sync
    but had **no HTTP route** — NB4 adds the thin route
    `POST :planId/ad-sets/:adSetId/status` (OWNER/ADMIN, same
    as budget/schedule) so the click rides the existing path.
  - *budget_shift* (ABO only) → a computed proposal: winner =
    lowest CPA among ad sets with conversions > 0 and spend ≥
    winner floor; donor = weakest other spender; shift =
    min(20% of donor daily, winner daily). The proposal
    returns from/to daily figures AFTER the shift — and is
    applied, if at all, by the human through the existing
    live-budget edit. CBO plans get no shift proposal (there
    are no per-ad-set budgets to shift).
- **Guardrails in the builder** — the rules engine is
  unchanged; `AutomationRule.campaignPlanId` already existed
  as the linkage (verified in code). `GET :planId/guardrails`
  returns plan-linked rules + org-wide rules (which also
  cover the plan), each with enabled state, lastEvaluatedAt /
  lastTriggeredAt and the latest `AutomationRun` (kind=rule)
  evidence. Attach = set `campaignPlanId` to this plan (the
  rule narrows to this plan only); detach = set it to null
  (the rule becomes org-wide again — it does NOT become
  inert). Both semantics are stated exactly in the API
  comments and the UI copy, because null ≠ "applies nowhere".

## CN8 — Multi-account & portfolio (what shipped)

- **Cross-account clone** — `POST :planId/clone-to-account`
  duplicates a plan into another Meta account of the same org
  as a fresh DRAFT (approval spine unchanged; same-account and
  non-Meta targets refuse with the right alternative named).
  The copy routine is field-complete (budgets/bids CN2,
  conversion/catalog/lead-form CN3/CN4, creative v2 CN5 —
  independently of `duplicatePlan`, whose older copy still
  lags the CN3/CN4 ad-set fields; that lag pre-dates NB4 and
  is recorded here, not silently "fixed" by scope creep).
  Every externally-scoped id produces a mapping entry:
  - `carried_verified` — page: a connected org SocialAccount
    (meta_page) with that external id; pixel: prior use by a
    target-account plan, or the org CAPI setting's pixel;
    audience: an AudienceRecord OF THE TARGET ACCOUNT, status
    ready, with that external id.
  - `carried_user_confirmed` — the caller re-picked it in
    `resolutions` (audience replacements must themselves be
    ready in the target, else they stay blockers; catalog +
    product set re-picks are validated with the CN3 save
    rules: org-owned, set belongs to catalog, set created on
    Meta).
  - `dropped_blocker` — everything else: dropped from the
    clone AND listed in `blockers[]`. Catalog/lead-form carry
    only via re-pick (business/page-scoped — our records
    cannot verify target-account access; the lead form
    additionally requires its page to be the clone's carried
    or resolved page). Nothing is ever silently carried.
- **Account health in pickers** — `GET campaign-plans/accounts/health`
  returns every ad account with the health THIS tree records:
  API-connection presence (integrationId) and the AD package's
  platformStatusBucket/raw/checked-at; an unreported bucket
  stays `"unknown"`. The builder's create picker now shows the
  bucket next to each Meta account, and the clone picker is
  built from this endpoint. (Connect Center's provider-health
  snapshot columns live in the cc-advanced worktree — at
  integration this reads the same AdAccount rows; unknown
  stays unknown here, as NB2 recorded for CAPI.)
- **Hub portfolio totals** — `GET campaign-plans/portfolio/totals`
  (separate additive endpoint; `listPlans` response shape
  untouched — CN10 owns the hub redesign): DailyAdMetric
  campaign-level rows only (CB5 semantics), per-account
  spend/impressions/clicks/conversions/CPA plus org totals
  **per currency — currencies are never summed together**.
  The hub renders it as an additive strip, failure-isolated.

## CN9 — Cross-platform v2 (what shipped)

- **Carry-over fix (from the NB1 acceptance):** CB6's
  `crossPlatformDraft` now maps the **effective** daily budget
  — the CN2 campaign budget on CBO plans, the ad-set sum on
  ABO — and the response carries
  `budget: { mode, effectiveDailyMinor, adSetDailyTotalMinor, source }`
  plus a CBO transformation note. Spec-pinned both ways
  (CBO 80000 campaign vs 50000 ad-set sum → mapped "800.00",
  source `campaign_budget`; ABO → "500.00", `ad_set_sum`).
- **Drafts are manageable objects** — new `CrossPlatformDraft`
  model (migration `20261013840000_cn9_cross_platform_drafts`):
  every CB6 creation now persists its mapped fields (blocked
  mappings too — the stored fields ARE the export package),
  and `crossPlatformDraft` returns the `draftId` additively.
  - `GET :planId/xdrafts` list; `PATCH :planId/xdrafts/:draftId`
    edits fields within the platform's real field set
    (validated by `validateCrossPlatformFields`, mirroring
    PublishingService's own guards + CB6 constraints: Google
    headlines 3–15 × ≤30, descriptions 2–4 × ≤90, keywords
    1–100 with match types, TikTok text ≤100, media URL
    required…). Editing a `created` draft flips OUR copy back
    to `mapped` — the external draft is unchanged and the UI
    says re-publish creates a new one.
  - `POST …/xdrafts/:draftId/readiness` — the CB2-style
    checklist (fields, target account, and a standing warn
    explaining re-create semantics). Publish is gated on it:
    a failing draft is marked `blocked` and the platform is
    NEVER called (spec-pinned by call count).
  - `GET …/xdrafts/:draftId/preview` — a LOCAL rendering of
    the stored fields (Google RSA with per-asset lengths/
    limits; TikTok identity — resolved id from the publication
    record when one exists, else honestly "resolved at
    publish" — text with length, media, CTA), labelled
    "স্থানীয় Rendering — প্ল্যাটফর্মের আসল Preview নয়".
  - `POST …/xdrafts/:draftId/publish` — re-creates through
    the existing PublishingService paths (PAUSED/DISABLED as
    always), updates the draft + writes the publish log.
    Stated everywhere it surfaces: this creates a NEW external
    draft; the previous one is neither edited nor deleted —
    no update/delete path exists in this flow.
  - `POST …/xdrafts/:draftId/sync-status` — honest negative:
    this codebase has no Google/TikTok campaign-status read
    path (PublishingService creates only; the Ads clients read
    metrics, not status), so sync returns `available: false`
    with the reason and the as-created status labelled
    `as_created`, plus the stored publication status. A metrics
    read was deliberately NOT dressed up as a status check.

## Gates (2026-10-14, this worktree)

- Scoped (campaigns + ads + automation + publishing):
  **44/44 suites, 310/310 tests PASS** — including the
  AdsService delegation (phase-k leaderboard specs green
  against the extracted helper) and all pre-existing CB/CN
  suites. New specs alone: cn7 7, cn8 6, cn9 7 = **20/20**.
- API jest FULL (`--maxWorkers=2`): **334/334 suites,
  3331/3331 tests PASS** — a fully green run; the known
  cx3-debounce flake did not appear this time (its
  pre-existing status is on record from NB1–NB3; NB4 touches
  no inbox code).
- Web tests **255/255**; tsc API **0** / web **0**;
  `next build` **green**; prisma validate **OK**.
- **Fresh PostgreSQL FULL sequence: 159/159 migrations
  applied clean** (158 + NB4's `20261013840000`); the
  `CrossPlatformDraft` table verified present (211 public
  tables); temp database dropped after verification.
- Tree clean at close (tsconfig.tsbuildinfo build artifact
  discarded uncommitted, as in NB3).

## Honest limits

- **Nothing is live-proven against real Meta/Google/TikTok
  accounts (M30/CN12 class).** Breakdown/creative numbers are
  only as real as the tenant's Ads sync; recommendations are
  heuristics over synced rows; clone verification is bounded
  by what our records can prove (page = org-level record,
  catalog = re-pick only); cross-platform re-create is
  spec/fixture-proven against the existing PublishingService
  contract.
- Migration `20261013840000` has NOT run on any real DB —
  fresh-Postgres proof only.
- `duplicatePlan`'s field lag (pre-NB4, recorded above) is
  untouched: same-account duplicates still miss the CN3/CN4
  ad-set fields that `duplicateAdSet` and the CN8 clone copy.
  A one-line follow-up if the owner wants it — deliberately
  not folded into NB4.
- The budget-shift proposal is ABO-only and straight
  arithmetic over the last synced rows; dayparting,
  seasonality and CBO structure are not modelled.
- Guardrail attach/detach writes `AutomationRule` rows
  directly from CampaignsService (the AutomationService has
  no link method and importing it would cycle — it depends
  on CampaignsService); validation is the link itself, the
  engine's evaluation is untouched.
- Google/TikTok draft status cannot be refreshed (no read
  path) — the UI shows as-created status, labelled.
- No screenshot QA (needs the NB4 build deployed — CN10/
  CN12 class, as with prior batches).
