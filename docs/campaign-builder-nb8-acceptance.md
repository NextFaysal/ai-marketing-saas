# Campaign Builder Frontier NB8 — Acceptance (CN17 + CN18)

Branch `campaign-next`, base NB7 close `31cbee0`. Built to
the Frontier plan
(`~/workspace/goals/ai-marketing-saas-platform-build/files/Campaign-Builder-Frontier-Plan-2026-10-15.md`,
NB8 section). Local commits only — **no push**
(owner-gated). This is the FINAL Frontier batch: with it,
CN13–CN18 is code-complete (program summary:
`docs/campaign-builder-frontier-summary.md`).

## Commits

| Commit | Content |
| --- | --- |
| `a79c92a` | NB8 schema — migration `20261013930000_cn17_cn18_depth_sharing` (additive, nullable): `CrossPlatformDraft.kind`, `ReportShare.planId` |
| `a28f971` | CN17 publishing: `publishTikTok` optional objective — specs 5/5 + M32 regressions 4/4 |
| `b5ebebe` | CN17 campaigns: PMax draft type + TikTok objective in the draft path — specs 10/10, CN9/CB6 regressions green |
| `3842c3e` | CN18 API: simulator + competitor-response + campaign shares — specs 8/8, CB5/CN7/RP6 regressions green |
| `68598f0` | Web: draft manager (PMax/TikTok objective), share-link control, hub simulator + competitor-response cards, public campaign report page — tsc 0, vitest 260/260 |
| (this doc) | NB8 acceptance + Frontier program summary |

## CN17 — Native platform depth

### Google Performance Max as a plan target

`CrossPlatformDraft` gains a type: `kind = "pmax"` (null
keeps the legacy CN9 behaviour — Google → Search RSA).
The PMax mapping produces EXACTLY the field set
`PublishingService.publishGooglePmax` accepts — that
skeleton's guard list is the contract, mirrored in
`validateCrossPlatformFields` so readiness and the
platform call can never disagree: headlines 3–15 (≤30),
long headlines 1–5 (≤90, mapped from ad descriptions /
primary texts), descriptions 2–5 (≤90), business name
≤25 (the org's brand/name), a logo URL (must be a full
http(s) URL — an API-relative org logo path BLOCKS, it is
never dressed up as one), 1–20 marketing image URLs
(direct ad image URLs only), final URL, countries, and
the CN9 effective daily budget (labelled CBO/ABO as
before — the PMax path receives the plan's effective
figure, spec-pinned). Creation and re-publish go through
the existing PMax path and create PAUSED, as always.

What the skeleton cannot carry is LISTED, never dropped:
plan keywords ("Performance Max has no keywords"), video
creatives (no video-asset field in the skeleton) and
saved-audience signals (no audience-signal field) are
returned as `notCarried` and stored on the draft. The
draft manager (web) edits the full PMax field set,
previews the asset group locally (labelled as a local
rendering), and readiness gates re-publish exactly like
CN9 — a draft failing validation is never sent.

### TikTok objective choice — plan/draft path ONLY

**Spike verdict (TikTok Marketing API v1.3, read
2026-10-15 from TikTok's docs-derived sources: the
official SDK's AdgroupCreateBody field spec and multiple
v1.3 references that agree):**

- The campaign `objective_type` enum includes `TRAFFIC`,
  `WEB_CONVERSIONS` and `LEAD_GENERATION`. Note the API
  name is **WEB_CONVERSIONS** — "Website Conversions" is
  the Ads Manager product name the plan used.
- For WEB_CONVERSIONS the ad group carries `pixel_id` +
  `optimization_event` (required together),
  `optimization_goal` CONVERT and `billing_event` OCPM.
  An ad-group `pixel_id` with any other objective is
  REJECTED by TikTok — so the draft validation refuses a
  pixel on a TRAFFIC draft instead of sending it to fail.
- LEAD_GENERATION binds an Instant Form at the AD level.
  This codebase's TikTok flow creates website creatives
  and has no form binding, so the objective is storable
  as a draft choice but readiness refuses it with that
  reason — the choice is preserved, never sent to fail.

Implementation: `publishTikTok` gains OPTIONAL
`objectiveType` / `pixelId` / `optimizationEvent`. With
them absent (every existing caller, including the direct
publishing page) the campaign/ad-group payloads are
byte-identical to the pre-NB8 TRAFFIC shape — spec-pinned
field for field. The draft path stores the choice in the
draft's fields, validates the required inputs at mapping
AND at readiness/publish (a missing pixel/event blocks
before any platform call), and the create call passes
them through. Per-objective budgets are the draft's
stored daily budget, honoured as in CN9.

## CN18 — Insights & sharing

### Budget simulator (own data or refusal)

`POST …/campaign-plans/budget-simulator` — deterministic
arithmetic only (no LLM anywhere in the path). The
objective lives on plans, so metrics join through the
org's published plans' `externalCampaignId`s;
campaign-level `DailyAdMetric` rows from the last 90
days are aggregated per campaign and summarised as
median + nearest-rank quartiles (CPM/CTR/CPA). The
projection for a daily budget × days is a RANGE from the
quartile spread, returned with the method labelled
verbatim ("নিজের শেষ ৯০ দিনের আসল Campaign Data থেকে
হিসাব — … কোনো Industry Benchmark, Average বা AI অনুমান
নয়"), the sample (`n` campaigns, campaign-days) and the
currency. Spec-pinned floors: **≥3 campaigns with data
AND ≥21 campaign-days** — below either, the simulator
returns `available:false` with the reason and the actual
sample. Mixed currencies refuse rather than blend (the
CN8 rule). Spec-pinned exactness: seeded CPMs
10000/15000/20000 minor give median 15000 and the exact
quartile impression/conversion ranges; out-of-window and
ad-set-level rows provably do not count.

### Competitor-response draft (angle only — never their creative)

`POST …/campaign-plans/competitor-response` creates an
ordinary DRAFT plan for the org's OWN product: one ad
set (BD, LINK_CLICKS, a stated ৳100/day starter budget)
with copy from the EXISTING grounded `generateCopy` path,
which writes only from the org's own product facts. The
competitor contributes ONLY an angle note, built from
OUR `CompetitorInsight` titles (this platform's analysis
text) and stored as a plan comment with the rule stated
on it. The competitor's creative text, notes, links and
snapshot URLs are never read into the draft — a spec
serialises the plan + ads + comments and asserts none of
those values appear anywhere, while the ads do carry the
org's own product. The web card states the rule before
the button. Approval flow untouched; the draft is a
draft.

### Campaign report shares (existing machinery, allowlisted payload)

No second share system: `ReportShare` gains
`kind = "campaign"` + a validated `planId` (the plan
must belong to the org at creation — a token can never
resolve to another org's plan), reusing the existing
token / expiry / revoke lifecycle verbatim (specs cover
create-validation, expiry and revoke). The public
payload comes from `CampaignsService.
publicCampaignReport`, constructed FIELD BY FIELD from
the CB5 totals, CN7 breakdowns and CN2 pacing
read-models — the allowlist is the shape: plan
name/objective, totals, per-ad-set numbers (exactly
name/spend/impressions/clicks/conversions), breakdown
rows, pacing summary, branding, and the
association-not-attribution note verbatim (platform
conversions are the platforms' own numbers; first-party
orders/revenue are shown as associated via Attribution
Credit, not proven causation). No comments, mentions,
approval internals or publish logs exist in the shape —
a spec asserts their absence from the serialised
payload. The window is real: `planPerformance` /
`planBreakdowns` gained an OPTIONAL `window` parameter
(metric rows and attribution credits filtered by date;
no window = the CB5/CN7 behaviour, unchanged — their
suites stay green). The builder offers link creation on
published plans (window + expiry choices); the public
`/r/[token]` page renders the campaign kind.

## Closing gates (all run serially)

| Gate | Result |
| --- | --- |
| API jest `--runInBand` (full, `NODE_OPTIONS=--max-old-space-size=4096`) | **343/343 suites, 3418/3418 tests, exit 0** — zero failures; the cx3-debounce flake did not appear in this run |
| Baseline movement vs NB7 | +3 suites / +23 tests — exactly the NB8 specs (CN17 publishing 5, CN17 campaigns 10, CN18 8) |
| Web vitest | **260/260** (39 files) |
| tsc api / web | **0 / 0** |
| Prisma validate | valid |
| Monorepo build (`pnpm -r build`) | **7/7 Done, exit 0** |
| Fresh Postgres 16, full sequence (`prisma migrate deploy`, throwaway DB `nb8_fresh`) | **163/163 migrations applied clean**, last = `20261013930000_cn17_cn18_depth_sharing`; 216 public tables; NB8 columns verified present (`CrossPlatformDraft.kind`, `ReportShare.planId`); throwaway instance stopped and removed after the run |

## Honest limits

- **Nothing is live-proven.** Whether Google accepts
  this app's PMax asset-group chain with real assets,
  and whether TikTok accepts a WEB_CONVERSIONS ad group
  (pixel + COMPLETE_PAYMENT) from this app's token class,
  are CN12-class live questions — owner-gated
  (integration → push instruction → Redeploy →
  real-account session). All NB8 platform behaviour is
  spec/stub-proven only.
- The TikTok spike rests on v1.3 documentation and the
  official SDK field spec read at build time, not on a
  live create. If a live session contradicts a mapping,
  the readiness layer is where the correction lands.
- LEAD_GENERATION remains a stored-but-refused choice
  until a TikTok Instant Form binding path exists; that
  is stated in the draft UI, the readiness output and
  this doc — it is not a silent gap.
- The simulator's ranges are only as good as the org's
  synced metrics; with fewer than 3 campaigns or 21
  campaign-days it refuses rather than guessing — by
  design, some tenants will see the refusal until their
  history grows.
- Migration `20261013930000` has **NOT run on any real
  database** — fresh-Postgres proof only.
- The web surfaces have no screenshot QA (nothing is
  deployed) — tsc/test-proven only.
- Push remains owner-gated, as always.
