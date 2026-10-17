# SA-B16 Acceptance — A3 Creative Intelligence + Phase-3 Close-out

**Date:** 2026-10-17 · **Worktree:** `ai-marketing-saas-sai` (branch `smart-ai`) · **Base:** `985b5159` (SA-B15) · **Local commits only — not pushed.**

- **Scope:** Smart AI Master Plan Phase 3, item **A3 (Creative Intelligence)** — deterministic pattern mining over the org's own ad creatives, filed as SUGGESTED LearnedItems, consumed by internal Brain contexts once approved — plus the **Phase-3 close-out** (`docs/smart-ai-phase3-summary.md`).
- **Migration:** none (the `creative` source type is a value in the existing free-string `LearnedItem.sourceType` column; patterns and exemplars are computed read-through from existing rows). Fresh-PG confirms **229/229**.
- **Law in force (L3):** creative performance (CTR/ROAS) is INTERNAL class — patterns are suggested-only until a human approves, approval forces INTERNAL non-overridably, and customer-class Brain contexts structurally never receive them.

---

## Step 0 — creative-grain reality in THIS tree (verified)

**(a) Metric grains actually stored.** `DailyAdMetric` holds three grains at once: campaign rows (`adExternalId = ""`), ad-set rows, and **ad-level rows** (`adExternalId <> ""`) — but ad-level rows exist **only from the Meta insights sync** (`normalizeMetaAdInsight`, level `"ad"`). Google and TikTok syncs write campaign-level rows only. (SA-B5 already excluded non-campaign rows from totals; this batch is the first consumer of the ad-level rows.)

**(b) Where creative TEXT lives.** The campaign builder's `CampaignAd` rows carry the copy: `primaryText` (required), `headline`, `description`, and `textOptions` (Json variant bag — **index 0 always mirrors the legacy columns**, so the columns ARE the platform-live copy; non-zero variants were never published and have no metrics). `callToAction` is excluded from features: every hub ad defaults to `SHOP_NOW`, so it carries no signal. Rows link to performance by `CampaignAd.externalAdId = DailyAdMetric.adExternalId`, org-scoped via `CampaignAd → CampaignAdSet.planId → CampaignPlan.organizationId`.

**(c) Creative asset library.** `CreativeAsset` rows are **media files only** (image/video for the builder media picker) — no text, no per-asset performance. There is no vision/content-analysis pipeline for ad media on this line.

**The honest grain of A3 is therefore: hub-built Meta ads — `CampaignAd` text × ad-level `DailyAdMetric`.** Synced Meta ads with no local `CampaignAd` have metrics but no local text: they are **excluded from mining and counted** (`adsWithoutLocalText`), never silently dropped. SocialPost captions were deliberately **not** pooled in: social insights are heterogeneous engagement-shaped Json, and mixing them with ad CTR would be a dishonest aggregate (recorded as a separate possible surface, out of A3 scope).

---

## Item 1 — CreativeLearningService (deterministic, NO LLM)

`apps/api/src/ai/creative-learning.service.ts` + `creative-intelligence.controller.ts`.

**Collection.** Per org, over the trailing **30-day** window (calendar-aligned via `performancePeriod`, the same helper as A1/performance learning): every local `CampaignAd` with an `externalAdId`, joined to its ad-level metric rows in the window (impressions, clicks, spend, conversions, conversion value). CTR and ROAS are always **pooled** (Σclicks / Σimpressions) — the same anti-fabrication discipline as SA-B5/B14.

**Floors (named constants, recorded):**

| Constant | Value | Meaning |
|---|---|---|
| `CREATIVE_WINDOW_DAYS` | 30 | trailing analysis window |
| `CREATIVE_MIN_IMPRESSIONS` | 1,000 | a creative below this is not evidence — excluded from the baseline, the pattern groups and the exemplars |
| `CREATIVE_PATTERN_MIN_CREATIVES` | 3 | a pattern needs ≥3 qualifying creatives |
| `CREATIVE_PATTERN_MIN_LIFT_PERCENT` | 20 | a pattern is reported only when its pooled CTR lift vs the org baseline clears ±20% |
| `CREATIVE_EXEMPLAR_LIMIT` | 5 | top-K exemplars returned |

**Features (text-derived, deterministic).** Language (bn/en/mixed — the platform's one detector, `detectReplyLanguage`, reused, not forked), length band (short/medium/long; text and headline bands are separate named constants), question form, emoji presence — and on the primary-text surface only: price mention, discount mention, urgency words (named bn+en lexicon `CREATIVE_URGENCY_LEXICON`), CTA presence (named bn+en lexicon `CREATIVE_CTA_LEXICON`). Boolean features emit only their "yes" group, so no pattern can ever be stated about an absence via a feature key; absence-side patterns arise only from categorical values (language, length).

**Outputs.**
- **(i) SUGGESTED LearnedItems**, kind `fact`, sourceType **`creative`** (union extended in `learning.service.ts`; `defaultApprovalVisibility` and the `approve()` override force INTERNAL exactly like `ads`/`performance`). Each statement carries its numbers and window ("headline প্রশ্ন-আকারের — CTR 8% বনাম গড় 4.86% (lift +64.61%), ROAS সহ, 3টি creative, 5,000 impression থেকে, …"), and the window dates ride inside the statement text, so the LearnedItem dedupe key differs per window — re-running a sweep in the same window creates **zero** duplicates (proven in spec).
- **(ii) CreativeExemplars, read-through, no new storage.** `computeReport` returns the top-5 qualifying creatives by real CTR (ties: impressions) with their actual texts and metrics, read from the source `CampaignAd` rows at request time — a recorded choice: the texts already live on their source rows, so nothing is copied or stored. Phase 5's content generator consumes this same surface.
- **API:** `GET organizations/:id/creative-intelligence` (member read — report + patterns + exemplars) and `POST .../suggest` (OWNER/ADMIN/MARKETING_MANAGER), behind TenantGuard + RolesGuard + `@PermissionArea("ai")`, mirroring the A1 controller.
- **Cadence:** `creative_learning_sweep` automation job (B14 pattern; walks orgs, cap 200, one org's failure never blocks the rest, per-org state under LearningState source `creative_learning`) + the on-demand endpoint.
- An org with no qualifying creatives or no clearing pattern gets an honest reason (`no_qualifying_creatives` / `below_creative_floor` / `no_pattern_cleared_thresholds`) and **zero** suggestions — silence over noise.

## Item 2 — Brain wiring (verified, not duplicated)

Approval already lands a creative fact as an INTERNAL `KnowledgeDocument` through the normal SA-B4 channel (retrieval-by-query works unchanged — verified in `learning.service.ts` `approve()`), so A3 adds no second knowledge channel. What the Brain gains is the always-on internal summary surface, mirroring how the performance section reads its snapshot: `OrgBrainContext.creativeFacts` — the statements of the org's **approved** `sourceType: "creative"` LearnedItems (newest 5), populated **only** inside the `if (!customer)` internal zone. Customer and own_customer contexts receive `creativeFacts: []` structurally. SUGGESTED items never appear (D3: suggested is not knowledge) — proven in spec (internal context is empty before approval, populated after).

## Item 3 — Specs (`apps/api/src/ai/creative-learning.spec.ts`, 9 tests, all passing)

- Feature extraction: question form, language, price/discount/urgency/CTA lexicons, emoji.
- **Pattern math, hand-computed fixtures:** baseline CTR 4.86 (14,000 imp / 680 clicks, pooled), winning headline-question pattern CTR 8 vs 4.86 → lift **+64.61** (3 creatives, 5,000 imp), losing headline-length pattern CTR 2.67 → lift **−45.06**.
- **Floors:** a 50-impression creative at CTR 50% changes nothing (baseline computed without it, absent from exemplars); a 2-creative question group at lift +66.67% is **not** reported.
- **No-lift dataset → zero patterns, zero suggestions.**
- Suggestions are SUGGESTED-only, sourceType `creative`; **approval with `visibility: "public"` requested still lands INTERNAL**, doc source `learned:creative`.
- Exemplar ranking by real CTR with floors applied; exemplar text equals the source row's text (read-through proof); the metrics-only ghost ad never appears.
- **Cross-org isolation** on report, sweep and controller; **Brain sentinel scan**: the approved statement reaches the internal context and is absent (with `creativeFacts: []`) from customer and own_customer contexts; org B's internal context never contains org A's learning.
- Dedupe: a second `suggestPatterns` run in the same window creates 0.

## Gates (run strictly serially, recorded as each finished)

| Gate | Result |
|---|---|
| Targeted jest (ai + ads + campaigns + inbox + knowledge + organizations, `--runInBand`, 4096 heap) | **164 suites / 1,584 tests — all passed** (includes the new `creative-learning.spec.ts`, 9 tests) |
| API typecheck (`tsc --noEmit`) | **exit 0** |
| API build (`npm run build`) | **exit 0** |
| Fresh-PG (throwaway local PG 16 + pgvector, empty DB, `prisma migrate deploy`) | **229/229 applied, 0 unfinished** — no new migration, as expected. Throwaway cluster dropped afterwards |

Pre-existing issues **not** touched (per brief): `cc26-payout-automation` wallet-sweep spec failure (outside the targeted folders; base-proven pre-existing since SA-B3); the TelegramClient/ThreadsClient undecorated-param boot bug on this line (fix exists on the nf line, `b6dcc457`, owed at integration).

## NOT BUILT (A3)

- **Image/video creative content analysis** — no vision pipeline exists on this line and none was faked; `CreativeAsset` is media-only.
- **SocialPost caption pattern mining** — engagement-shaped metrics with different semantics; pooling them with ad CTR would be a dishonest aggregate.
- **Creative patterns for Google/TikTok ads** — no ad-level metrics and no local creative text exist for them on this line.
- **Creative patterns for synced-but-not-hub-built Meta ads** — metrics exist, local text does not (counted as `adsWithoutLocalText`).
- **`textOptions` variants beyond index 0** — unpublished, no performance data; mining them would fabricate evidence.
- **Any live verification** — nothing in A3 (or the Smart AI line) is proven against real accounts; M30 remains owed.

## Commits

| Commit | Item |
|---|---|
| `906be0ac` | Item 1 — CreativeLearningService + creative-intelligence API + LearnedItem sourceType `creative` (forced INTERNAL) |
| `8067b4b9` | Item 2 — Brain creative section (internal-only) + module registration + `creative_learning_sweep` wiring |
| `0a7b4d74` | Item 3 — specs (9 tests) + Agg `convValue` field rename |
| _(this doc's commit)_ | Item 4 — SA-B16 acceptance + Phase-3 summary |
