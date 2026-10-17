# SA-B17 Acceptance — Smart AI Phase 4, C1: Competitor Brain

Batch: SA-B17 · Phase 4 (Competitor), item C1 · Worktree
`ai-marketing-saas-sai`, branch `smart-ai` · Base HEAD
`d98b04b3` (SA-B16) · Local commits only — nothing pushed.

C1 structures the competitor data the platform ALREADY
collects into the Brain, INTERNAL class only. It adds no new
collection: no new scrapers, no new external calls, no new
migration (the LearnedItem `sourceType` is a free-string
column; `"competitor"` is a code-level union extension).

## Step-0 inventory (verified in tree @ d98b04b3)

Models (`packages/db/prisma/schema.prisma`):

- `Competitor` — id, organizationId, name, facebookPageId?,
  facebookPageUrl?, websiteUrl?, notes?.
- `CompetitorAd` — competitorId, externalAdId (unique per
  competitor), pageId?, pageName?, startedAt?, stoppedAt?,
  isActive, platforms[], creativeText?, linkUrl?,
  snapshotUrl?, **`firstSeenAt` (a real field — no createdAt
  derivation was needed)**, lastSeenAt, raw.
- `CompetitorPriceObservation` — competitorId, productName,
  priceMinor BigInt, currency (default BDT), sourceUrl,
  sourceType (website_scan | manual | ad_library), observedAt.
- `CompetitorInsight` — organizationId, competitorId?, kind
  (pricing | creative | positioning | activity), title,
  detail?, evidence Json, provider. This is an
  evidence-enforced LLM/template surface — C1 deliberately
  does NOT write to it; C1 findings travel the LearnedItem
  channel like every other learning source (SA-B4 rails).

Collection (pre-existing, untouched by C1):

- Meta Ad Library official sync (`syncAds`,
  `syncMultiPlatform`) and a robots-respecting
  `WebsiteScanner` (`scanWebsite` → price observations + a
  ≥5% price-drop alert) plus manual observations.
- Cadence: per-competitor ScheduledJobs (`competitor_ads` /
  `competitor_scan` / `competitor_multi_sync`, daily) run by
  AutomationService; `scheduleAutoSync` toggles them.
- Existing dossier surface: `exportDossier`,
  `priceComparison`, `generateInsights` / `listInsights`;
  `listAds` computes an `isWinning` longevity proxy (active
  ≥14 days) — an activity signal, NOT performance.

Hard fact (Phase-3 summary, re-verified): **CompetitorAd
carries NO performance data** (no impressions/clicks/spend).
C1 therefore reports activity, price and creative-TEXT facts
only — theme counts, never CTR/ROAS claims about rivals.

## Cadence choice (Item 2c — recorded)

There is no single org-level "competitor sync finished" hook
(sync is per-competitor jobs), so C1 follows the B14/B16
pattern: the digest is computed **on demand** (API + Brain
context read it live from rows), and findings are filed by a
new **`competitor_intelligence_sweep`** job in the learning
sweep family (AutomationService, target org ignored, walks
≤200 orgs, per-org failure isolated, LearningState recorded
under source `competitor_intelligence`). Per-org job
enablement remains the owner's, as with every sweep.

## Item 1 — CompetitorIntelligenceService (commit b84a97af)

`apps/api/src/ai/competitor-intelligence.service.ts` —
deterministic, NO LLM anywhere in the analysis.

Digest (`computeDigest(orgId, { now? })`), windows 7 + 30
days via the shared `performancePeriod` UTC calendar windows:

- Per competitor: total/active/ended ads (from `isActive`),
  newAds7d/newAds30d counted on **firstSeenAt** (window start
  inclusive, end exclusive), adsPerWeek7d (= newAds7d),
  adsPerWeek30d (= newAds30d × 7/30, 2dp), lastNewAdAt,
  daysSinceLastNewAd.
- Creative THEMES over the creativeText of ads first seen in
  30d, counted with the SA-B16 `creativeFeatures` lexicons
  (language bn/en/mixed, price mention, discount mention,
  urgency, question form, emoji, CTA, avg length buckets) —
  counts only; there is no performance data to claim from.
- Price series per (competitor, productName) exact-name
  grouping: latest vs immediately prior observation;
  `deltaPercent` only when ≥2 observations exist AND the
  currencies match AND prior > 0 — otherwise **null**
  ("no movement data", never a fabricated 0%). A
  currency switch also yields null rather than a meaningless
  cross-currency delta. Price minor units cross the API as
  decimal strings (BigInt-safe).
- Org totals + a movements list (only series with an honest
  delta). Empty competitor set → `hasData: false`,
  `tracked: 0`, empty findings/lines — never an error.
- Bengali `factLines` render the same numbers for the Brain.

Findings (≤3, deterministic, priority: biggest price drop →
launch burst → longest silence):

| Rule | Threshold (named constant) |
| --- | --- |
| Tracked price dropped | delta ≤ −5% (`COMPETITOR_PRICE_DROP_MIN_PERCENT = 5`, mirrors the scanner's own alert threshold) |
| Launch burst | ≥5 new ads in 7d (`COMPETITOR_LAUNCH_BURST_MIN_NEW_ADS = 5`) |
| Silence | ≥14 days since last new ad AND the competitor has ads (`COMPETITOR_SILENCE_MIN_DAYS = 14`; wording is "কোনো নতুন ad দেয়নি" — never "inactive", because lastSeenAt only proves no NEW ad was observed) |

`suggestFindings` files findings as SUGGESTED LearnedItems,
kind `fact`, **sourceType `"competitor"`** (union extended
in `learning.service.ts`); approval forces INTERNAL via both
`defaultApprovalVisibility` and the non-overridable
`approve()` condition — the same L3 landing as
performance/ads/creative.

API (`competitor-intelligence.controller.ts`, mirroring the
A1/A3 controllers): `GET
organizations/:organizationId/competitor-intelligence`
(member roles, org-scoped via TenantGuard) returns the
structured digest; `POST .../suggest` (OWNER/ADMIN/
MARKETING_MANAGER) files findings and echoes them.

## Item 2 — Surfaces (commit bd41ac9e)

- **Brain:** `OrgBrainService` gains `competitorDigest` +
  `competitorFacts` on the context, populated ONLY inside
  `if (!customer)` — the live digest lines plus the org's
  APPROVED competitor LearnedItems (take 5, the creative
  block's pattern). Approved competitor facts ALSO land as
  internal KnowledgeDocuments through the normal SA-B4
  approval channel (verified in spec — the channel, not a
  duplicate). Customer and own_customer contexts carry
  `competitorDigest: null`, `competitorFacts: []`.
- **Module:** service + controller registered and exported
  from `OrgBrainModule`.
- **Sweep:** `competitor_intelligence_sweep` added to the
  AutomationService job types + executeJob dispatch
  (constructor injection `@Optional()`, appended last, the
  established pattern).

## Item 3 — Specs (commit db1e1e34)

`apps/api/src/ai/competitor-intelligence.spec.ts` — 12 tests,
in-memory fake prisma (the SA-B5/B14 pattern):

- Digest math on fixtures: window-edge inclusion (an ad at
  exactly the 7d start counts; one second before does not),
  active/ended split, ads-per-week cadence, 58-day silence
  distance.
- Price delta from two snapshots (−16.67%); **single
  snapshot → deltaPercent null** (no zero-delta claim);
  org movements list excludes the single-point series.
- Theme counts deterministic (two runs deep-equal) and exact
  on crafted bn/en copy (language 3/3, price 1, discount 2,
  urgency 3, question 1, emoji 1, CTA 2).
- Findings fire at thresholds in priority order, cap 3;
  silent below every threshold (4-ad burst, −4% drop,
  10-day silence); never a silence finding for a competitor
  with zero ads ever.
- Suggestions SUGGESTED-only + deduped on re-run; approval
  with `visibility: "public"` requested still lands an
  INTERNAL KnowledgeDocument (`source: learned:competitor`).
- Cross-org isolation on digest, controller and sweep
  (sentinel names/prices); Brain audience wall — internal
  context contains competitor names + the approved-facts
  block only after approval; customer + own_customer
  serializations byte-clean of every sentinel; org B's
  internal context contains none of org A's rivals.

## Gates (strictly serial, recorded as run)

| Gate | Result |
| --- | --- |
| Targeted jest (ai + competitors + inbox + knowledge + organizations + automation, `--runInBand`) | **138 suites / 1374 tests, all pass** (includes the 12 new C1 specs) |
| api tsc (`tsc --noEmit`) | **exit 0** |
| api build | **exit 0** |
| Fresh-PG (throwaway PG 16 + pgvector, empty DB, `prisma migrate deploy`; throwaway DB/role dropped after) | **229/229 applied, 0 unfinished, 0 rolled back — NO new migration** (229 folders in tree) |

Pre-existing failures not touched and not re-chased: the
cc26 wallet-sweep spec (base-proven since SA-B3) and the
TelegramClient/ThreadsClient undecorated-param boot block
(fix `b6dcc457` lives on the nf line, owed to sai at
integration) — neither appears in this batch's targeted
suites, and no new failure was introduced.

## NOT BUILT (explicit)

- **Competitor → action proposals = SA-B18** (C2). C1 files
  findings as reviewable facts only; nothing here proposes
  or executes an action.
- **Competitor website TRAFFIC estimates** (daily visits +
  traffic sources): the owner's provider choice between the
  paid BYOK options (Similarweb vs Semrush Trends Premium)
  was never made — **no traffic data source is built or
  claimed in this batch**.
- **New collection**: no new scrapers, no new external API
  calls, no changes to the Ad Library sync or the website
  scanner. C1 reads existing rows only.
- **Live verification = M30**: nothing in the Smart AI line
  is live-proven; no migration has run on the real DB (this
  batch adds none). The `competitor_intelligence_sweep` job
  still needs the owner's per-org enable, like every sweep.
