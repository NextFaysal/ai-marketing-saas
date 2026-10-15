# Campaign Builder Frontier NB7 — Acceptance (CN15 + CN16)

Branch `campaign-next`, base NB6 close `6e41717`. Built to
the Frontier plan
(`~/workspace/goals/ai-marketing-saas-platform-build/files/Campaign-Builder-Frontier-Plan-2026-10-15.md`,
NB7 section). Local commits only — **no push**
(owner-gated). The batch survived two daemon restarts: all
work was committed incrementally as it landed, and nothing
was lost either time.

## Commits

| Commit | Content |
| --- | --- |
| `91be2ea` | NB7 schema — migration `20261013920000_cn15_cn16_experiments_series` (additive): `CampaignExperiment`, `CampaignPlanSeries`, `CampaignPlan.seriesId / seriesInstanceDate`, `CampaignAdSet.funnelLayer / funnelIncomplete` |
| `299b2dc` | NB7 API core — CN15 experiments + CN16 funnel wizard + series in a new `CampaignFrontierService` (+ pure `series-dates.ts`), Meta client study methods, routes/DTOs/module wiring, readiness funnel check, copy-helper funnel carry |
| `2559ffc` | tsc fix: the validated cadence is typed in `parseSeriesRule` |
| `2642c2e` | CN15 specs — 7/7 |
| `ead7f77` | CN16 specs — 12/12, plus two fixes the specs caught (below) |
| `535cfbf` | Web: builder experiments panel + series panel + funnel chips; hub funnel wizard + series card/calendar (web workstream, coordinator-verified) |
| (this doc) | NB7 acceptance |

## CN15 — Meta Experiments (Ad Studies)

**Spike verdict: CONFIRMED — the Meta study path is built.**
Basis, all read at build time (2026-10-15):

- Meta's official **"Ad Study" developer guide**
  (developers.facebook.com, updated Mar 24, 2026) documents
  creating a split test with
  `POST /{BUSINESS_ID}/ad_studies` — `name`, `start_time`,
  `end_time`, `type=SPLIT_TEST`, `cells=[{name,
  treatment_percentage, adsets:[…]}]`.
- The official **Graph API Reference v25.0 for
  Business/ad_studies** (read in full) gives the create
  parameter table: `cells` (required; each cell carries
  `name`, `treatment_percentage`, and one of `adsets` /
  `campaigns` / `ads` / `adaccounts`), `name` / `start_time`
  / `end_time` (required), `type` enum including
  `SPLIT_TEST`, `objectives` (type enum including
  `CONVERSIONS`, with `adspixels: [{ id, event_names }]`),
  and `confidence_level` — "used in power calculations and
  final study report". Error codes 100 (invalid parameter)
  / 200 (permissions).
- Meta's own **facebookincubator
  catalogue-of-api-solutions** documents the same create
  shape for API-built solutions (cells with
  `treatment_percentage` min 10, sum ≤ 100, CONVERSIONS
  objectives) plus the read-back flow: `GET /{study_id}`
  for status, `GET /{study_id}/cells?fields=name,
  treatment_percentage,campaigns,adsets,adaccounts`, and
  `results_first_available_date` — with an explicit
  human-in-the-loop gate before any study launches.
- A shipping third-party CLI (mads-cli) exposes
  `abtest create` against the same edge — real-world
  evidence the path works for Marketing API apps of this
  class.

Because the verdict is CONFIRMED, the split-run fallback
was **not** built (the task's either/or). Two documented
shapes shaped the design: creation happens on the
**business node** (not the ad account), and cells
reference **already-published** Meta objects — so a study
here is a link between two published variant campaigns,
never a publishing mechanism.

Shipped:

- `MetaPublishClient` gains `getAdAccountBusinessId`
  (the account node's `business{id}`), `createAdStudy`
  (a creation counts ONLY when Meta returns the study id;
  Meta's refusal propagates verbatim) and `getAdStudy`
  (study node + cells edge, returned verbatim).
  `CampaignsService.metaClientForPlan` exposes the SAME
  per-account client the publish flow uses — one place
  turns an ad account record into an authenticated client.
- `POST …/campaign-plans/experiments` judges the real
  records first: two DIFFERENT plans, same `abGroupId`,
  same ad account, BOTH published (`externalCampaignId`
  present), split 10–90 (the two cells sum to exactly
  100), and the success metric taken from plan A's CN3
  state — the first pixel-carrying ad set's pixel +
  `conversionEvent` (default PURCHASE, the CN3 legacy
  default) — sent as the documented CONVERSIONS objective
  (`adspixels: [{ id, event_names: [event] }]`). Missing
  business on Meta's side = an honest refusal; no business
  id is ever guessed. Meta's refusal leaves **no row**,
  carries Meta's own message to the caller, and is
  audit-logged (`campaign.experiment_create_failed`).
- The `CampaignExperiment` row exists ONLY with Meta's
  study id; `createResponse` stores Meta's create payload
  verbatim. **Neither plan is touched** — no status
  change, no publish-log writes, nothing activated
  (spec-pinned). Creating a study is not a publish path.
- Read-back (`POST …/experiments/:id/refresh`,
  `GET …/experiments/:id`): Meta's study + cells are
  stored in `lastReadback` and returned **verbatim** —
  including any winner/confidence fields Meta chooses to
  return. This platform **never computes significance and
  never names a winner of its own** (spec-pinned: no
  `winnerPlanId` anywhere in the payload). Beside the
  verbatim block, the response carries each plan's raw
  synced totals (CB5 `planPerformance`) under a note, in
  Bengali, stating they are raw numbers and not a
  significance test.
- Web: an Experiments panel in the builder (shown for
  grouped plans) — sibling picker fed by the EXISTING
  `ab-tests/list`, split/metric/duration form, the
  success notice stating the experiment publishes nothing,
  per-experiment read-back rendering Meta's fields
  labelled verbatim (unix times as bn-BD dates, raw JSON
  in a details block) with the API's significance note
  verbatim and the labelled local A/B totals.

## CN16 — Full-funnel plans + recurring series

Shipped, riding the existing services end to end (no
parallel audience/plan machinery):

- **Funnel wizard** (`POST …/campaign-plans/funnel-plans`
  → hub modal + result view): ONE plan via
  `CampaignsService.createPlan` (the plan's CN2 budget
  mode / campaign budget / daily cap apply to the whole
  bundle), then three labelled layers via the existing
  `addAdSet` / `addAd`:
  - *Prospecting* — the owner's CN1 targeting (countries,
    age, genders, interests, expansion) exactly as picked.
  - *Retargeting* — CN6 `product_viewers` +
    `cart_abandoners`: per source, the account's ready
    AudienceRecord is reused when one exists, otherwise
    built through `AudiencesService.createCustom`; the
    confirmed Meta ids land in the set's
    `customAudienceIds`.
  - *Retention* — CN6 `buyers`, plus the CN3 catalog when
    refs are supplied (the wizard drops `conversionEvent`
    beside a catalog, per the CN3 rule; an invalid catalog
    ref retries WITHOUT the catalog and says so).
  - Every layer gets the owner's own starter ad (copy is
    required input — nothing is invented). Layers are
    ordinary ad sets afterwards: `funnelLayer` is a label,
    `adSetCopyData` carries both funnel fields through
    every clone/duplicate.
  - **Missing inputs land INCOMPLETE, in the open:** when
    a layer's sources have no contacts (the sourceCatalog
    says unavailable), the ad set is still created, with
    `funnelIncomplete` storing the reason; readiness
    reports it as an **error** (`funnel` check) until the
    owner completes it, and the wizard response reports
    each layer `complete | incomplete | failed` with its
    reason. Nothing is silently dropped and no audience
    is fabricated (spec-pinned for the no-buyers and
    no-data-at-all cases).
- **Recurring series** (`CampaignPlanSeries`): cadence
  `weekly | monthly | dates` (Ramadan/Eid packs are date
  lists), validated strictly by the pure
  `series-dates.ts` (`parseSeriesRule` — unknown shapes
  are 400s, never reinterpreted). Occurrence dates are
  computed **from the anchor** every time — weekly =
  anchor + k × interval weeks; monthly = the anchor's
  day-of-month clamped into the target month, recomputed
  from the anchor (Jan 31 → Feb 28 → **Mar 31**, never
  Mar 28; spec-pinned, leap year included); dates = the
  stored list. Two defects the specs caught and fixed
  before close: series rows now write `status` /
  `nextIndex` explicitly rather than leaning on DB
  defaults, and `validDate` no longer round-trips a Date
  anchor through `String()` (which silently truncated
  milliseconds — a sub-second drift in the chain).
- **Generation sweep** (`scanCampaignSeries`, the CB5
  discipline: in-process 60s interval, leader-claimed
  `campaign-series-scan`, `DISABLE_SCHEDULER` respected):
  per active series, per tick, at most ONE instance —
  occurrence `nextIndex`, once now reaches
  (date − leadDays). The instance is a
  `duplicatePlan` **DRAFT clone** (full-field copy: CN13
  destinations and funnel tags ride; external ids and
  `publishAt` never carry — spec-pinned), marked with
  `seriesId` + `seriesInstanceDate`. **One pending
  instance at a time:** while the previous instance still
  sits in `draft`, generation HOLDS (the series view
  shows `generationHeld`); once it enters the approval
  flow or is deleted, the next occurrence generates in
  its window. A dates series auto-ends when its list is
  exhausted. Per-series failures are isolated and
  audit-logged; the sweep never throws. **A series never
  publishes or activates anything** — every instance owes
  the full approval flow on its own.
- Pause / resume / end (`PATCH …/series/:id`): pause and
  end stop future generation only; existing instance
  drafts are never touched (spec-pinned); ended is
  terminal (resume refuses with the reason).
- Web: builder Series panel (create weekly/monthly/dates,
  held-state note verbatim, pause/resume/end) + a
  series-instance badge on the plan title; hub
  "Recurring Series" card with the same actions; the CN10
  launch calendar marks series-instance plans with 🔁 and
  shows each active series' next instance date as a
  violet chip — plan-date logic otherwise untouched.

## Closing gates (all run serially by the coordinator)

| Gate | Result |
| --- | --- |
| API jest `--runInBand` (full) | **340/340 suites, 3395/3395 tests, exit 0** — zero failures; the cx3-debounce flake did not appear in this run |
| CN15 / CN16 specs | 7/7 and 12/12 (inside the full run; also run solo) |
| Scoped regression (campaigns + audiences) | 28/28 suites, 207/207 |
| Web vitest | **39 files, 260/260** |
| tsc (api / web) | **0 / 0** |
| Prisma validate | valid |
| Monorepo build (`pnpm -r build`) | **7/7 packages Done, exit 0** |
| Fresh Postgres 16, full sequence (`prisma migrate deploy`, throwaway DB `nb7_fresh`) | **162/162 migrations applied clean**, last = `20261013920000_cn15_cn16_experiments_series`; 216 public tables; NB7 tables verified present (`CampaignExperiment`, `CampaignPlanSeries`) and columns verified (`CampaignPlan.seriesId/seriesInstanceDate`, `CampaignAdSet.funnelLayer/funnelIncomplete`); throwaway instance stopped and removed after the run |

Baseline movement vs NB6 close: API +2 suites / +19 tests
(exactly CN15's 7 + CN16's 12); migrations 161 → 162;
tables 214 → 216 (the two new NB7 tables; the rest of the
migration is additive columns).

## Honest limits

- **Nothing in NB7 is live-proven.** No real Meta account
  has seen any of it: whether Meta accepts an
  `ad_studies` create from this app's token class (the
  study is created on the BUSINESS node — business-level
  ads access is a live question), what the study read-back
  actually returns for a SPLIT_TEST (including whether
  Meta returns winner/confidence fields at all — the UI
  shows whatever comes back, verbatim, and nothing more),
  and whether published PAUSED campaigns are accepted as
  study cells, are all CN12-class live questions
  (owner-gated: integration of this line with the other
  tracks → owner's push instruction → Dokploy Redeploy →
  real-account sessions). If a live session contradicts a
  documented shape, the affected surface is the rework
  item — the plan's standing warning.
- Migration `20261013920000_cn15_cn16_experiments_series`
  has **NOT run on any real database** — fresh-Postgres
  proof only.
- The funnel wizard's audience layers ride
  `AudiencesService.createCustom`, whose Meta creation is
  itself only fixture-proven (Phase J / CN6 state) — a
  layer whose Meta creation fails lands incomplete with
  the reason, but the end-to-end live path is unproven.
- Series generation clones the template's CURRENT state
  at generation time — an owner who edits the template
  between instances changes future instances (by design,
  and visible in each instance's own draft); instances
  already generated are never retro-edited.
- The held state is deliberate and visible, not a stall
  alarm: a series whose pending draft the owner ignores
  generates nothing further until that draft moves or is
  deleted. There is no notification on generation —
  instances surface in the hub calendar, the series card
  and the builder; the audit log carries every generation
  (`campaign.series_instance_created`).
- Approval spine untouched: experiments create Meta-side
  studies over already-published campaigns only; series
  create drafts only; the funnel wizard creates drafts
  only. No auto-publish, no auto-activation, no auto
  budget movement anywhere in this batch.
- No screenshot QA (design not deployed) — the web
  surfaces are tsc/test-proven, not visually verified.
- Push remains owner-gated: this batch is local commits
  on `campaign-next` only.
