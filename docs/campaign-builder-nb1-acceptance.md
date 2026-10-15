# Campaign Builder Next — NB1 Acceptance (CN1 + CN2)

Built 2026-10-14 on branch `campaign-next` (base a3b62ed =
GitHub main 7443135 content) in `~/workspace/ai-marketing-saas-cn`.
Local commits only — NO push (owner's rule). Plan:
`Campaign-Builder-Next-Plan-2026-10-14.md`, Part 3 / NB1.

## Commits

- `ad522c0` CN1 targeting v2 (API: client + service + DTO + controller + spec)
- `89615b5` CN2 bidding & budget v2 (API + schema + migration)
- `5e0faef` CN1+CN2 web builder controls
- (this doc follows in the NB1 close-out commit)

## CN1 — Targeting v2 (what shipped)

- **Location depth end-to-end**: cities (Meta key + optional
  radius/distance_unit), postcodes (→ `geo_locations.zips`),
  location types (home/recent/travel_in/everyone) — DTO →
  stored targeting Json → `toGraphTargeting` `geo_locations`.
  A location value Meta cannot express (keyless city,
  radius outside 1–80, unknown location type) is refused at
  save, never silently dropped.
- **Locales**: language targeting ids → `targeting.locales`.
- **Behaviors + demographics in the DTO**: behaviors (entry
  list) and demographics { educationStatuses,
  relationshipStatuses, lifeEvents, workPositions } are now
  settable through AddAdSet/UpdateAdSet (previously the
  stored Json/Graph mapping existed but no DTO reached
  behaviors, and demographics had no path at all). Mapped
  into flexible_spec (demographics as its own group).
- **One narrowing (AND) layer**: narrowInterests /
  narrowBehaviors are pushed as a SEPARATE flexible_spec
  element — Meta ANDs flexible_spec elements together,
  which is what makes it a narrowing layer rather than a
  wider OR.
- **Detailed-targeting expansion toggle**: stored as
  `targeting.targetingExpansion`; at publish it rides the
  mechanism this codebase already uses for Advantage
  audience (`targeting_automation.advantage_audience = 1`).
  Meta has folded detailed-targeting expansion into
  Advantage audience — live confirmation is M30-class.
- **Meta targeting search**: `GET campaign-plans/targeting/search
  ?adAccountId&kind&q` (kinds: interest, behavior,
  life_event, work_position, geo, locale) through the
  account's own Meta connection (new
  `MetaPublishClient.targetingSearch` on the ad account's
  `targetingsearch` edge). Results are Meta's rows (id,
  name, audience size bounds). Without a connection or on
  a Meta error the response is `{ available: false, reason,
  results: [] }` — no invented results.
- **Validation rule (the documented legacy resolution)**:
  an entry that CLAIMS a Meta id (`{ id, name }`) must be
  confirmed via targeting search before it is stored —
  no connection → refused with the reason; id not in
  Meta's results → refused naming the entry. Name-only
  entries (the legacy free-text form, stored as plain
  strings exactly as before) are NOT blocked and NOT
  re-validated on unrelated edits; instead readiness
  carries a `targeting` warning listing them per ad set
  ("Meta দিয়ে যাচাই হয়নি — ভুল নাম হলে Delivery হবে না").
  On PATCH, only the entries the edit itself carries are
  re-confirmed.
- **Per-ad-set delivery estimate**: CB2's readiness now
  attempts the estimate for EVERY ad set and returns
  `estimates[]` (available, or unavailable WITH the
  reason, per set). The legacy top-level `estimate` field
  remains = the first ad set's result.

## CN2 — Bidding & Budget v2 (what shipped)

- **Bid strategy per ad set** (columns `bidStrategy`,
  `bidAmountMinor`, `costGoalMinor`, `roasAverageFloor`
  on CampaignAdSet; migration below). Strategies:
  `lowest_cost` (default — sends NO bid fields; Meta's
  default is LOWEST_COST_WITHOUT_CAP), `bid_cap`,
  `cost_cap`, `roas_goal`.
- **Support matrix** (enforced at create, at PATCH
  against the merged ad set, and re-checked in
  validatePlan so a stored row can never reach publish
  out-of-matrix; refusals carry the reason):
  - bid_cap: needs a positive bidAmount; NOT for REACH.
  - cost_cap: needs a positive costPerResultGoal; only
    OFFSITE_CONVERSIONS / LEAD_GENERATION / VALUE.
  - roas_goal: needs a positive roasGoal; plan objective
    must be OUTCOME_SALES, goal must be VALUE, pixel
    required.
  - lowest_cost with any amount set is refused as a
    contradiction rather than silently dropping the amount.
  - PATCH semantics: sending bidStrategy replaces the bid
    group wholesale (stale amounts are cleared); amount-only
    edits layer onto the stored strategy.
- **Graph mapping** (grounded in Meta's Ad Set reference:
  bid_strategy enum + bid_amount + bid_constraints):
  bid_cap → `LOWEST_COST_WITH_BID_CAP` + `bid_amount`;
  cost_cap → `COST_CAP` + `bid_amount` (the cost goal);
  roas_goal → `LOWEST_COST_WITH_MIN_ROAS` +
  `bid_constraints { roas_average_floor }`, the floor
  stored as Meta's raw integer (ROAS × 10000, so "2.0" →
  20000). The VALUE optimization goal was added to the
  allowed goals (it is what MIN_ROAS pairs with; its
  promoted_object is pixel + PURCHASE, same as
  OFFSITE_CONVERSIONS).
- **TRUE campaign budget**: `CampaignPlan.budgetMode`
  ("abo" default | "cbo") + `campaignDailyBudgetMinor` /
  `campaignLifetimeBudgetMinor`, settable at create and
  via PATCH (editable plans only). Publish: CBO sends the
  campaign budget on the campaign create (daily and/or
  lifetime — the client grew `lifetime_budget`) and ad
  sets carry NO budgets; ABO is byte-for-byte the old
  behaviour. A CBO plan without a campaign budget cannot
  be submitted (validatePlan) or published. Advantage+ is
  untouched semantically: it still implies CBO, still
  falls back to the first ad set's daily budget when no
  explicit campaign budget exists, and its publish log /
  audit steps are unchanged. The CB4 submission snapshot
  now also freezes budgetMode, campaign budgets and the
  per-ad-set bid fields — what was approved is what
  publishes. Live per-ad-set budget edits and budget
  scaling refuse/skip CBO plans with the reason (there is
  no ad-set budget on Meta to edit). The CB2 daily cap
  now compares against the EFFECTIVE daily figure
  (CBO: campaign daily; ABO: ad-set sum).
- **Pacing read-model**: `GET campaign-plans/:planId/pacing`
  — spent-to-date vs expected-by-today from DailyAdMetric
  CAMPAIGN-LEVEL rows only (both external ids empty, so
  ad-set/ad rows never double-count), expected = lifetime
  × elapsed/total flight days, else daily × days elapsed.
  Labelled `computed_from_daily_ad_metric` in the payload
  and in the UI ("Forecast বা Meta এর সংখ্যা নয়"). No
  rows → `status: "no_data"` with spent 0 and expected
  null; unpublished → `published: false`.
- **Web (functional only — the design pass is CN10)**:
  create form budget mode + campaign budgets; plan-header
  budget-mode editor; ad-set create/edit fields for
  cities/postcodes/location types/locales/behaviors/
  narrowing/expansion/demographics status ids; the
  targeting-search box (results show Meta ids; the
  `নাম|ID` token form feeds validated entries); bid
  strategy + amount inputs on create and edit; ad-set
  header shows city/locale/bid summary; readiness shows
  every ad set's estimate; a Pacing button + panel.

## Schema / migration

- `20261013810000_cn2_bidding_budget` (the package's
  claimed range is 20261013800000+): 3 columns on
  CampaignPlan (budgetMode TEXT NOT NULL DEFAULT 'abo',
  campaignDailyBudgetMinor BIGINT, campaignLifetimeBudgetMinor
  BIGINT) + 4 on CampaignAdSet (bidStrategy TEXT,
  bidAmountMinor BIGINT, costGoalMinor BIGINT,
  roasAverageFloor INTEGER). All additive; existing plans
  keep their exact pre-CN2 behaviour.
- CN1 added NO schema (targeting Json grew fields only).

## Gates (batch end, this tree)

- Campaign suites during build: 17 suites / 106 tests PASS
  (incl. new cn1-targeting 8 tests, cn2-bidding-budget 9
  tests, client test +1) — pre-existing CB1–CB6 + phase
  suites all green, unchanged expectations.
- API jest FULL run: run #1 and #2 each showed ONE failed
  suite with ZERO failed tests — `src/inbox/cx3-debounce.spec.ts`,
  the flake already on record from the CX package (it is an
  inbox suite; NB1 touches no inbox code). Solo it passed
  18/18 twice in a row. Run #3 on the identical tree:
  **328/328 suites, 3300/3300 tests PASS**.
- Web tests: 255/255 PASS. Web tsc: 0 errors. API tsc: 0 errors.
- Prisma validate: PASS ("The schema is valid"; needs a
  DATABASE_URL env present, as in every prior gate run).
- Next build: PASS (57 static pages generated).
- Fresh-Postgres FULL sequence: **156/156 migrations
  applied clean** (155 base + the CN2 migration), 208
  application tables, all 7 new columns verified present;
  temp database dropped afterwards.

## Honest limits

- **Nothing here is live-proven against a real Meta
  account (M30-class, as with CB1–CB6).** Targeting
  search, id validation, per-set estimates, CBO publish,
  and every bid mapping are spec/fixture-proven against
  the documented Graph shapes; whether Meta accepts a
  MIN_ROAS ad set, a demographics flexible_spec group, or
  the expansion toggle's advantage_audience mapping for a
  given account can only be confirmed with the owner's
  real ad account (CN12 schedules exactly this).
- The migration has NOT run on any real database — fresh
  Postgres only, per the cx7 rule.
- Demographics lifeEvents/workPositions entries ride the
  same id-validation as interests/behaviors; the web
  exposes only the two numeric demographics id lists
  (life/work entries are API-only until CN10's design pass).
- Pacing's "expected" is straight-line arithmetic over
  the flight window — a management signal, not a delivery
  prediction; dayparting/seasonality are not modelled.
- Cross-platform (CB6) budget mapping still uses ad-set
  totals; a CBO plan's cross-platform draft therefore
  reports its ad-set sum, not the campaign budget — noted
  for CN9, not silently changed here.
