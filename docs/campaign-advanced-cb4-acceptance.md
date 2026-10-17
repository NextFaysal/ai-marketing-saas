# Campaign Builder Advanced — CB4 (CA15–CA17) Acceptance

Batch CB4 of the Campaign Builder Advanced package (CA1–CA28, approved in full by the owner 2026-10-17), built on the `campaign-advanced` branch in `~/workspace/ai-marketing-saas-ca` (base: GitHub main `5b3d403`, CB3 HEAD `54221a2a`). Cross-Platform Parity: one-click fan-out, Google/TikTok post-publish management (spike-first), and UTM/attribution completion.

**Audit-correction note.** The CB4 audit described CrossPlatformDraft as a flat, plan-less model and PMax `audienceSignals` JSON as existing on the plan. Direct code verification at build start found both outdated: the CN9-era model already links drafts to plans (`planId`, `kind`, `fields`, `publicationId`, `externalCampaignId`), and **no audienceSignals JSON existed anywhere** (plan or publish DTO). CA15 therefore needed **no migration** for the plan link, and the PMax signal work became "resolve + carry on the draft", not "copy a stored JSON" — see CA15 (c).

**Commits (local only — NO push, per the owner's standing rule):**

| Item | Commit |
|---|---|
| CA15 fan-out + PMax signals | `bccf3a10` |
| CA16 Google/TikTok post-publish management | `c1e17756` |
| CA17 UTM template + attribution display | `64de232f` |

**Migration:** ONE new migration in the whole batch — `20261030300000_ca17_utm_template` (CA17 only; claim recorded in the Cross-Track Migration Ledger as CB4's fourth use of the `20261030000000+` range). CA15 and CA16 needed none.

---

## CA15 — One-click fan-out + PMax signals ✅ BUILT

**What shipped.** From an approved plan, `POST :planId/fanout/preview` computes the Google and TikTok mappings and creates **nothing** (no draft rows, no publishing calls, no publish logs — spec-pinned); `POST :planId/fanout` runs only after the user's confirmation and **re-maps server-side** (client-sent fields are never trusted). Per-platform failures are isolated in their own blocks — one platform's error never fails the other. Implementation rides a new `dryRun` flag inside the existing `crossPlatformDraft` mapper, so the preview and the create can never drift apart.

- **(a) Name.** The CA13 naming template renders per target platform (`{platform}` → Google/TikTok) via a service-level `nameOverride`; a blank render falls back to the plan name; the single-draft path is byte-identical when no override is passed.
- **(b) Budget.** Copied in BDT and labelled as copied (`source: ad_set_sum | campaign_budget`, "কপি করা হয়েছে, Currency Conversion হয়নি") — no FX is invented anywhere.
- **(c) PMax audience signals.** NEW `resolveAudienceSignals` resolves the plan's audiences from real rows: a referenced `SavedAudience` by id, `customAudienceIds`/`excludedAudienceIds` (Meta external ids) against `AudienceRecord`. Resolved signals are carried **verbatim** into the draft's `mapped.audienceSignals`. The honest limit is stated in the mapping itself and in the UI: the signals are stored on the draft for review but are **NOT sent to Google** — a Meta audience has no Google user list; publishing converts none of it. Unresolvable ids are carried without a name, never dropped silently.
- **(d) Text.** Google Search = the CA3 RSA assembly (`assembleGoogleRsa`, reused, not forked). Google kind follows the plan's CN17 shape (PMax asset groups → PMax draft). TikTok = the primary single text; extra CN5 variants land in `notCarried` with the CA3 ACO verdict (standard `/ad/create/` is single-text; multi-text exists only via a separate ACO product whose contract is unverified).
- **(e) Gaps, shared + per-platform.** Everything unmapped is listed per platform BEFORE creation: age/gender restriction beyond the builder defaults (18–65/all — the defaults are broad-targeting Meta semantics, so only real restrictions count), lead forms, catalog/product sets, more than one distinct landing URL (only the first is used), Search-RSA audience signals, video on Search, TikTok video (now resolved to its `CreativeAsset.sourceUrl`; unresolvable assets are `notCarried`, never faked).
- **UI.** A fan-out panel in the builder's cross-platform card: per-platform account selects, preview blocks with gaps, confirm-to-create, draft list refresh.

**Evidence.** `apps/api/src/campaigns/ca15-fanout.spec.ts` — **11/11 PASS** (no-create-before-confirm, per-platform mapping, gaps completeness, signals verbatim, budget label, template name, failure isolation). Regressions cn9 / cn17 / cb6 / ca3 / ca13 green in the full campaigns chunk (below).

## CA16 — Google/TikTok post-publish management ✅ BUILT (all four operations, spike-confirmed)

### Spike verdicts (official docs, verified 2026-10-17 — docs BEFORE code)

| Operation | Verdict | Evidence |
|---|---|---|
| Google campaign status mutate | **BUILD** | Official "Update Campaign" sample: `campaigns:mutate` with an `update` operation setting `status` + `updateMask: "status"`. |
| Google campaign budget mutate | **BUILD** | `campaignBudgets:mutate` update `{ resourceName, amountMicros }` + `updateMask: "amount_micros"` (operation-level reference). The budget resource name is read from the creation record's `detail.steps` entry (`step === "budget"`). |
| Google campaign status read | **BUILD** | GAQL `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = X` (`campaign.status` is a selectable field). |
| TikTok campaign status update | **BUILD** | Official SDK `CampaignStatusUpdateBody`: `POST /open_api/v1.3/campaign/status/update/` `{ advertiser_id, campaign_ids[], operation_status: ENABLE \| DISABLE }`. |
| TikTok campaign status read | **BUILD** | `GET /campaign/get/` returns `operation_status` + `secondary_status` (SDK `CampaignList` item fields). |
| TikTok budget update | **BUILD — at AD GROUP level** | Official SDK `AdgroupUpdateBody`: `POST /adgroup/update/` `{ advertiser_id, adgroup_id, budget }` (budget = the ad group's). `/campaign/update/` budget was **not** used: this flow's publish path puts the budget (and `BUDGET_MODE_DAY`) on the ad group and none on the campaign, so the ad group is the only correct level. The ad group id comes from the creation record (`detail.adgroupId`); no address → honest refusal, no guessed call. |

### Scope/authorization evidence (the codebase side of the spike)

- **Google.** The Google Ads API has ONE OAuth scope for reads and writes (`https://www.googleapis.com/auth/adwords`, per the MutateCampaigns RPC reference). More decisively: the codebase's stored refresh-token credentials **already execute `campaigns:mutate` CREATE calls** in `PublishingService` and GAQL reads — the same authorization demonstrably performs both. (Repository fact, stated plainly in the acceptance: there is NO Google Ads OAuth connect flow in this codebase — Connect Center's Google kinds are GA4/Merchant/Business only; Ads credentials are owner-entered secrets on the AdAccount's integration. The scope conclusion rests on the stored-credential evidence, not on a connect-flow scope list.)
- **TikTok.** No per-operation scope exists in this integration: the stored advertiser Access-Token already performs create writes (`/campaign/create/`, `/adgroup/create/`, `/ad/create/`) in `PublishingService`; status/budget updates sit under the same Ads Management authorization.

No operation failed the spike, so no `available:false` reason needed replacing with a verdict — the previously-honest "sync unavailable" endpoint became a real read instead.

### What shipped

- **PublishingService** (each method confirms via the platform's own response — no result resource name, or TikTok `code !== 0`, throws the platform error verbatim): `getGoogleCampaignStatus`, `setGoogleCampaignStatus`, `updateGoogleCampaignBudget`, `getTikTokCampaignStatus`, `setTikTokCampaignStatus`, `updateTikTokAdGroupBudget`.
- **CampaignsService.** `syncCrossPlatformDraftStatus` is now a real platform read: `available: true` + the platform's verbatim status for created drafts; never-created drafts keep honest unavailable states ("এখনো তৈরি হয়নি"); a failed read falls back labelled `as_created` **with the platform error attached**. New `setCrossPlatformDraftStatus` and `updateCrossPlatformDraftBudget` follow the Meta control treatment exactly: activation is gated by the CC27 campaign-account-access check, the platform confirms FIRST and local records change only after, a publish-log entry and an audit record (`campaign.xdraft_status` / `campaign.xdraft_budget`, with before/after) are written, and a platform failure changes nothing and returns the platform's message. Budget addresses resolve from the creation record — missing address = honest refusal, never a guessed call.
- **UI.** Live platform status in the Status Sync result; Pause/Activate buttons with confirm dialogs on created drafts; a "Platform-এ Budget পাঠান" action in the draft edit form (created drafts only, confirm dialog, before → after shown from the server's confirmed values).

**Evidence.** `apps/api/src/publishing/ca16-platform-control.spec.ts` — **8/8 PASS** (request payload shapes against a stubbed fetch — labelled stub evidence, NOT a live platform call); `apps/api/src/campaigns/ca16-xdraft-control.spec.ts` — **12/12 PASS** (access gate, confirm-first ordering, audit/log, honest refusals). Regressions cn9 / cn17 / phase-m32 / cn17-tiktok-objective green in the full chunks.

## CA17 — UTM/attribution completion ✅ BUILT

**Verified-before-building.** The pre-CA17 state: UTM existed only as `CampaignsService.tagUtm` (hardcoded facebook/cpc/plan-slug, Meta publish flow only); NO `url_tags` anywhere; no plan-level UTM storage; TikTok drafts carried no tagging; Google drafts had no suffix field. Nothing was duplicated — the template layer was added ONCE and every path now consumes it.

- **(a) One plan-level template.** Migration `20261030300000_ca17_utm_template` adds `CampaignPlan.utmTemplate` (JSONB, nullable; null = the documented defaults, so every pre-CA17 plan behaves byte-identically). `GET/POST :planId/utm-template` with strict validation: unknown keys/tokens refused, empty or >120-char values refused, `null` clears. Tokens `{platform} {campaign} {adset} {ad}` render against real facts; a key rendering empty is omitted — an empty utm value is never sent. Defaults: source facebook/google/tiktok per platform, medium `cpc`, campaign = plan-name slug, content = ad-set slug, term = ad slug.
- **(b) Consistent application.** Meta publish: the per-ad params ride BOTH the tagged destination link and Meta's `url_tags` (`MetaPublishClient.createAd` gains an optional `urlTags`; absent = old payload byte-identical). Google: the mapper sets `finalUrlSuffix` on Search AND PMax drafts (fields + preview surface it) and `publishGoogle`/`publishGooglePmax` put it on the campaign create only when provided. TikTok: params are appended to the mapped landing URL. Everywhere, a link's existing `utm_*` are the owner's and are **never overwritten** — skips are reported in the mapping's transformations, so the TikTok path needed no CA15-preview gap entry: it is applied, with the skip surfaced, not silently dropped. `tagUtm` itself is untouched (phase-j pins its behaviour).
- **(c) Attribution display.** `planPerformance` gains an additive `attribution` block read from STORED config only: first-party `windowDays` = `Organization.attributionWindowDays` (the very value the attribution engine consumes, `attribution.service.ts`), labelled `source: "organization_setting"`; platform windows are stored **nowhere** in this system (no attribution spec is ever sent or saved), so Meta/Google/TikTok report `configured: false, display: "সেট করা নেই"` — no plausible window (e.g. "7-day click") is hardcoded as if it were the account's. The builder's performance card shows the same line.

**Evidence.** `apps/api/src/campaigns/ca17-utm.spec.ts` — **11/11 PASS** (defaults per platform, token rendering + empty-drop, template validation incl. clear, owner-param preservation, mapper suffix/URL tagging incl. template flow-through, Meta `url_tags` payload, Google publish payload with/without suffix, attribution block from the stored org window + unset platforms).

---

## Gates (all run SERIALLY, 2026-10-17)

| Gate | Result |
|---|---|
| API jest — `src/campaigns` | **46 suites / 352 tests PASS** (incl. ca15 11, ca16 12, ca17 11) |
| API jest — `src/publishing` + `src/ads` | **13 suites / 104 tests PASS** (incl. ca16-platform-control 8) |
| Web vitest (full) | **109 files / 893 tests PASS** |
| tsc — api + web | **0 / 0** |
| Builds | api `tsc -p tsconfig.build.json` exit 0; web `next build` exit 0 (per-package npm — the root script's `pnpm` is not installed in this shell) |
| Prisma validate | **valid** |
| Fresh-Postgres full run | **220/220 migrations applied clean** (219 at CB3 + `20261030300000_ca17_utm_template`); `CampaignPlan.utmTemplate` column verified present |
| Nest boot smoke vs the fresh PG | **PASS** — app started, CA17 routes mapped (`utm-template` GET+POST present), campaigns route probe → **HTTP 401** (auth guard), not a crash |

Known pre-existing issues were NOT chased (standing list): `cx3-debounce` flake, `cc26-payout-automation` deterministic failure, `social-pp1` parallel-load timeouts. None of them fired in this batch's serial gate runs.

## NOT BUILT / honest limits

- **Nothing in CB4 is live-proven.** Every platform behaviour above is proven at spec/stub level (labelled as such); no real Google/TikTok/Meta account was touched. Live verification stays in the owner's M30 track.
- **TikTok multi-text (ACO)** — still NOT BUILT (CA3 verdict stands); extra variants ride `notCarried`.
- **PMax audience signals are stored, not sent** — Google receives no user-list conversion of Meta audiences (CA15 (c)); the draft + UI say so.
- **TikTok campaign-level budget** — deliberately not used; budgets for this flow live on the ad group (spike §CA16).
- **Platform attribution windows** — not displayed because they are not stored; wiring a real per-account window would need a stored config field + a platform read, neither of which exists today.
- **Google Ads OAuth connect flow** — does not exist in this codebase (Ads credentials are owner-entered); CB4 did not add one.
- Push and deploy remain owner-gated: this batch is local commits only; a release needs the owner's explicit push instruction, then his manual Dokploy Redeploy.
