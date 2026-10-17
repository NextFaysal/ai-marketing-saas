# Campaign Builder Advanced — CB5 (CA18–CA22) Acceptance

Batch CB5 of the Campaign Builder Advanced package (CA1–CA28, approved in full by the owner 2026-10-17), built on the `campaign-advanced` branch in `~/workspace/ai-marketing-saas-ca` (base: GitHub main `5b3d403`, CB4 HEAD `3acdafd5`). Measurement: pacing alerts + runway, geo holdout (spike-first), per-form lead quality, COD return-adjusted ROAS, builder inbox + counter-drafts.

**Process note.** The original CB5 worker died in a daemon restart after committing all five items but before the final gate run and this document. A continuation finisher verified the tree, re-ran the full gate suite serially at HEAD `b9194d1d`, adjudicated the one failure that fired (cx3-debounce — pre-existing, see Gates), and wrote this document. No gate failure was caused by CB5 code, so no fix commit was needed.

**Commits (local only — NO push, per the owner's standing rule):**

| Item | Commit |
|---|---|
| CA18 pacing alerts + runway projection | `e96e8c66` |
| CA19 geo holdout (spike NO → observational fallback) | `920db109` |
| CA20 per-form lead quality | `4d494559` |
| CA21 COD return-adjusted ROAS | `6f977327` |
| CA22 builder inbox + counter-drafts | `b9194d1d` |

**Migrations:** FOUR new migrations in this batch, all inside the CA claim (`20261030000000+`, recorded in the Cross-Track Migration Ledger as CB5's fifth use): CA18 `20261030400000_ca18_pacing_alerts` (PlanPacingAlert), CA19 `20261030500000_ca19_geo_holdout` (PlanGeoHoldout), CA20 `20261030600000_ca20_lead_form_link` (Lead.leadFormId, additive nullable), CA22 `20261030700000_ca22_builder_inbox` (BuilderInboxSignal). CA21 needed none — it is a read-only view.

---

## CA18 — Pacing alerts + runway projection ✅ BUILT

**What shipped.** A per-org automation job `pacing_alert_sweep` (default OFF — no job row, no runs; hourly template) calls `CampaignsService.scanPacingAlerts`, which evaluates every live (published, externalCampaignId set) plan's CN2 pacing plus the new runway from REAL DailyAdMetric rows and reconciles `PlanPacingAlert` rows: one ACTIVE row per (plan, kind); a new condition raises one alert + audit + a notification to the plan creator; a persistent condition refreshes its numbers and re-notifies at most once per cooldown; a condition that stops firing CLEARS its row (history kept). A plan whose pacing cannot be computed is skipped WITHOUT touching its alerts — a sync gap never silently clears a real warning. Alerts never pause a campaign and never move a budget.

**Thresholds — named constants, stated in the payloads and in the automation template copy, never hidden:**

| Constant | Value | Meaning |
|---|---|---|
| `PACING_TRAILING_DAYS` | 7 | Runway burn rate window |
| `PACING_MIN_TRAILING_DAYS` | 3 | Distinct metric days required, else "তথ্য নেই" |
| `PACING_EXHAUSTION_MARGIN_DAYS` | 2 | `early_exhaustion` fires when projected exhaustion lands ≥2 days BEFORE the plan end date |
| `PACING_OVERSPEND_PERCENT` | 20 | `overspend_pace` fires when spend-to-date exceeds expected-to-date by >20% |
| `PACING_ALERT_COOLDOWN_HOURS` | 24 | Max one re-notification per persistent alert per 24h |

**Runway honesty.** Runway = remaining lifetime budget ÷ trailing burn (trailing spend ÷ DISTINCT metric days in the window — a day with no row is unknown, not zero). Only lifetime-budget plans can run out; daily-budget plans get an explicit not-applicable reason. Fewer than 3 metric days or zero burn → "তথ্য নেই", never an invented number. Every runway payload carries the label "আনুমানিক projection — শেষ ৭ দিনের আসল Metric Row-এর গড় দৈনিক খরচের গতিতে হিসাব…". The runway rides the existing `planPacing` payload additively; `GET :planId/pacing-alerts` returns active + recent alerts WITH the thresholds; the builder pacing panel shows runway + active alerts with the thresholds stated.

**Evidence.** `apps/api/src/campaigns/ca18-pacing-alerts.spec.ts` — **10/10 PASS**; cn2 + a4 regressions green in the campaigns chunk.

## CA19 — Geo holdout ✅ FALLBACK BUILT (spike verdict: NO)

**Spike verdict (official Meta docs, verified 2026-10-17 — docs BEFORE code): a Meta Ad Study CANNOT split by geography, so a geo holdout cannot be created through the CN15 path.** Evidence: (1) the documented create contract CN15 builds on — `POST /{business_id}/ad_studies`, type `SPLIT_TEST` — takes cells of `{ name, treatment_percentage, campaigns }`: the split is a share of the AUDIENCE assigned across the cells' campaigns, and there is NO region/geo field on the study or the cell; (2) Meta's Experiments overview describes every test type as a USER split (A/B: "your audience is randomized and split into separate groups"; Brand/Conversion Lift divide the audience into test/control groups). Geo experimentation in Meta's ecosystem is the external **GeoLift** methodology over separately geo-targeted campaigns — an analysis method, not an Ad Study type. **No study is created.** The verdict is recorded in code (`spikeVerdict: "not_creatable_via_ad_study"`), in every payload, and in the builder UI up front.

**What shipped instead — the honest fallback.** `PlanGeoHoldout` (migration above): a holdout DEFINITION on a plan — test vs holdout region name sets (both non-empty, disjoint — a region in both is a validation error), window ≤ 92 days (`HOLDOUT_MAX_WINDOW_DAYS`), one ACTIVE definition per plan. The observational measurement aggregates the plan campaign's stored DailyAdBreakdown `region` rows inside the window (CA9 aggregator) into test / holdout / **other** buckets — regions in neither set are reported as "other", never silently merged into a side. Per-bucket spend/impressions/clicks/conversions/CPA plus conversions-per-৳1000-spend; the test−holdout difference is labelled verbatim "শুধু পর্যবেক্ষণমূলক পাটিগণিত, Lift নয়". Two facts are stated verbatim in the payload and the UI: the method text (`HOLDOUT_METHOD` — regions differ in population, demand and competition, so a difference is not proof of ad effect) and the delivery note (`HOLDOUT_DELIVERY_NOTE` — **the definition changes NO delivery**; holding a region out still requires excluding it from the plan's targeting). Spend observed in holdout regions is FLAGGED with that warning, not hidden. Breakdown rows are campaign-level (no per-ad-set region split — the CA9 limit, stated in the payload).

**Evidence.** `apps/api/src/campaigns/ca19-geo-holdout.spec.ts` — **7/7 PASS**; ca9 regression green in the campaigns chunk.

## CA20 — Per-form lead quality ✅ BUILT

**Linkage finding (verified in code first).** Before CA20, a leadgen lead recorded its Meta form_id only inside the notes TEXT — not a join key, never parsed back. The fix is at the source: `Lead.leadFormId` (migration above) is stamped by the inbox leadgen ingest when Meta's `form_id` resolves to one of the org's modelled LeadForms (one conditional spread in `inbox.service.ts`; unresolved leads stay unattributed). Historical leads keep `null` and are reported as unattributed COVERAGE — never backfilled by guessing.

**What shipped.** `GET campaign-plans/lead-forms/quality` aggregates REAL Lead rows per form: totals + stage distribution; qualified = stages `qualified | proposal | won` (`LEAD_QUALIFIED_STAGES`); converted-to-order via the real `Lead.customerId → Order.customerId` chain. **Rates are WITHHELD below the stated minimum of 10 attributed leads** (`LEAD_FORM_MIN_LEADS`) — counts still show, rates are `null` with a threshold note ("পর্যাপ্ত তথ্য নেই — Rate দেখাতে অন্তত 10টি Form-যুক্ত লিড লাগে…"). Cost per qualified lead joins ad sets carrying `leadFormId` → their plans' published campaigns → stored DailyAdMetric campaign-level spend; no link or no qualified leads = a stated note ("খরচের তথ্য নেই — …"), never a number. CN14 feedback status per form comes from real `OfflineConversionLog` rows (`lead-feedback-{leadId}-{stage}`). `suggestPlan` facts gain `leadFormFacts` for OUTCOME_LEADS plans — stated as org-level form facts, because forms carry no product link in the schema. The builder lead-forms section shows per-form quality + the unattributed-coverage line.

**Evidence.** `apps/api/src/campaigns/ca20-lead-form-quality.spec.ts` — **6/6 PASS**; cn4-leadgen-mapping + cb3 regressions green; the inbox chunk is green except the pre-existing cx3-debounce flake (see Gates).

## CA21 — COD return-adjusted ROAS ✅ BUILT (beside the raw figure, never replacing it)

**Linkage finding (verified in code before building).** Orders carry **NO campaign id**. Two REAL linkages exist, and the view unions them — each order counted once, provenance counted and reported:

1. **AttributionCredit** — credit rows whose touchpoint's `campaign` equals the plan name or external campaign id → credited order ids. This is the exact join `planPerformance`'s first-party revenue already uses.
2. **AB7 order stamps** — `Order.utmCampaign` equal to a utm_campaign value THIS plan's ads emit (CA17 `utmParamsFor` for the account's platform + the legacy Phase-J slug) with `utmSource` matching the platform's source.

There is no click-level attribution and no plan→store link; the scope says exactly that, verbatim, in the payload and the UI (`ADJUSTED_ROAS_SCOPE`: stamped/credit orders only, publish window, "এটি Click-Attribution নয়").

**Arithmetic.** Adjusted revenue = per delivered COD order, `totalMinor − refundedMinor`, floored at 0. *Delivered* = EC33's `isSoldOrder` (imported from `storefront/ec27-discovery`, not forked — cancelled/refunded/failed excluded; completed/delivered status or a delivered/partial_delivered CourierShipment). *Returned* = raw status `returned` OR a received/completed ReturnRequest — returned orders never enter gross revenue; their value is reported separately (`returnedValueMinor`). Adjusted ROAS = adjusted revenue ÷ the plan campaign's stored DailyAdMetric spend over the same window (publish instant → now). The payload ALSO carries a same-order-set gross ROAS and `planPerformance`'s existing first-party revenue/ROAS verbatim (`existingFirstParty`, with a note that the adjusted view sits beside it and does not replace it). Zero spend → revenues are real but both ROAS values are `null` with the stated reason (no division by zero). No linked orders → honest `available: false` with the reason (orders are never attributed by guessing). Non-COD matched orders are counted and excluded from the COD figures, not silently dropped.

**Evidence.** `apps/api/src/campaigns/ca21-adjusted-roas.spec.ts` — **5/5 PASS**. No migration.

## CA22 — Builder inbox + counter-drafts ✅ BUILT

**Signal sources — verified in code first.** The competitors module ALREADY stores real rows (`Competitor`, `CompetitorAd`, `CompetitorPriceObservation`, `CompetitorInsight`). The inbox builds on those stored rows plus manual entry — **NO tracking/scraping was added** (owner decision 2026-10-17: competitor work stays in the Smart AI C1–C2 sequence; the automated feed is NOT BUILT, and the inbox payload + UI say so verbatim).

**What shipped.** `BuilderInboxSignal` (migration above): source `manual | competitor_insight | competitor_price | competitor_ad`, status `new | drafted | dismissed`, optional `draftPlanId`. Routes: `GET/POST campaign-plans/builder-inbox`, `POST builder-inbox/import` (merchant-triggered imports from the stored competitor rows; dedupe on source + sourceRefId; winning ads = active ≥ 14 days), `POST builder-inbox/:signalId/dismiss`, `POST builder-inbox/:signalId/draft`. Imported signal text is composed from stored METADATA only — **`CompetitorAd.creativeText` is NEVER copied** into a signal (CN18 leak-proof rule; spec-pinned: the fixture's secret creative string appears in NO signal row). `draftFromSignal`: the product is an explicit link or a deterministic name-token match against the signal text; the draft is created through `suggestPlan` (drafts only) and **the created plan's status is asserted `draft` before the signal is marked drafted** — the no-publish guarantee is spec-pinned. The campaigns hub page gains the inbox panel with the not-built-feed disclosure.

**Evidence.** `apps/api/src/campaigns/ca22-builder-inbox.spec.ts` — **4/4 PASS**.

---

## Gates (run SERIALLY by the continuation finisher at HEAD `b9194d1d`, 2026-10-17)

| Gate | Result |
|---|---|
| Targeted jest — the five CB5 specs | **5 suites / 32 tests PASS** (CA18 10, CA19 7, CA20 6, CA21 5, CA22 4) |
| API jest — campaigns chunk | **51 suites / 384 tests PASS** |
| API jest — automation chunk | **15 suites / 93 tests PASS** |
| API jest — inbox chunk (CA20 touched `inbox.service.ts`) | 53/54 suites, 563/564 tests — the ONE failure is the pre-existing cx3-debounce flake, adjudicated below |
| Web vitest (full) | **109 files / 893 tests PASS** |
| tsc — api / web | **0 / 0** |
| Build (per-package npm; pnpm absent in this shell) | contracts, db (incl. prisma generate), ui, api, worker, web (next build), admin (next build) — **all exit 0** |
| Prisma validate | **valid** |
| Fresh Postgres 16 (throwaway, destroyed) | **224/224 migrations applied clean, 0 failed**; `PlanPacingAlert`, `PlanGeoHoldout`, `BuilderInboxSignal` tables + `Lead.leadFormId` column verified present |
| Nest boot smoke (against the fresh PG) | **PASS** — full module graph booted, 1,681 routes mapped incl. all CB5 routes (`:planId/pacing-alerts`, `:planId/geo-holdout` GET/POST + `:holdoutId/end`, `:planId/adjusted-roas`, `lead-forms/quality`, `builder-inbox` CRUD/import/dismiss/draft); unauthenticated probes of the campaigns list, pacing-alerts and builder-inbox routes all returned **HTTP 401** (auth error, not a crash) |

**cx3-debounce adjudication (pre-existing, NOT CB5).** The inbox chunk run failed one test (`cx3-debounce.spec.ts`: a 2-message burst's combined reply answered about the second message's product). This is the known pre-existing CX3 debounce production bug (a lone delayed reply never fires; bursts can lose the first message; only delay-enabled orgs are affected; a verified fix exists but is unapplied pending owner approval) and its timing-flaky spec. Proof it is not CB5: (a) CA20's entire inbox diff is one conditional `leadFormId` spread inside the leadgen ingest — it cannot touch the auto-reply/debounce path; (b) the spec re-run solo at CB5 HEAD passed **18/18**, and solo at CB4 HEAD `3acdafd5` (temp worktree) also passed **18/18** — the same test flips between runs on both trees; (c) the CA20 worker had already reproduced it on the base tree (recorded in the CA20 commit message). Not chased, per standing instructions. The other two known pre-existing items (cc26-payout-automation deterministic failure — outside this batch's chunks; social-pp1 parallel timeouts) did not fire in these serial runs.

## NOT BUILT

- **CA19 Meta geo-split experiment** — impossible via the Ad Study contract (spike verdict above). Only the definition + observational fallback shipped; no study is created and nothing about delivery changes automatically.
- **CA22 automated competitor feed** — NOT BUILT (owner-sequenced to Smart AI C1–C2). The inbox consumes only already-stored competitor rows + manual entries.
- Everything else in CA18–CA22's brief was built as specified.

## Honest limits

- **Nothing is live-proven.** All platform evidence is spec/stub level; no real Meta/Google/TikTok account was touched. Live verification remains the owner's M30 track; push and Dokploy Redeploy remain owner-gated as always.
- CA18 alerts depend on metric sync freshness — a plan whose rows stop syncing keeps its active alerts untouched by design (never silently cleared), which also means a stale alert can persist until data resumes.
- CA19's comparison is observational and campaign-level (breakdown rows carry no ad-set dimension); it must not be read as lift.
- CA20 rates exist only for leads ingested after the `leadFormId` stamp shipped; historical leads remain unattributed coverage by design.
- CA21's scope is only as wide as its two linkages — orders with neither an attribution credit nor a matching UTM stamp are excluded and the payload says so; it is not click attribution.
- CA22 product matching is deterministic name-token matching; an ambiguous signal can still produce a draft without a product (the signal text rides into the draft brief).
