# Advertising Review — Current State, Gaps, and Feature Plan

Prepared 2026-10-10 at the owner's request ("বিজ্ঞাপন খাতে কী কী বাকি
আছে ভালো করে চেক করো, কী কী ফিচার যোগ করা যায় প্ল্যান করো").
Method: verified inventory of the advertising code (ads, campaigns,
automation, attribution, analytics/profit modules + web pages),
checked against what serious F-commerce advertisers in Bangladesh
and comparable markets actually use day to day. Every "exists" claim
below was read from the code, not remembered.

## 1. What exists today (verified)

**Ad accounts & analytics (M5, M10)**
- Meta, Google, TikTok connect with tokens verified before save;
  CSV import (restating) and manual entry.
- Insights sync at **campaign level only** (`level: "campaign"` in
  the Meta client), daily rows in `DailyAdMetric`. Platform
  conversions kept strictly separate from first-party orders.
- Metrics engine: CTR/CPC/CPM/CPA/platform ROAS/MER; contribution
  profit = revenue − refunds − COGS (cost on order date) − ad spend,
  with COGS coverage % and warnings.

**Campaign builder & publishing (M9)**
- Plans: 5 OUTCOME objectives (sales, traffic, leads, engagement,
  awareness). Ad sets: daily/lifetime budget (integer minor units),
  billing event, optimization goal, page/pixel id, start/end times,
  targeting JSON limited to `{countries, ageMin, ageMax, genders}`.
- Ads: single link ads only — primary text, headline, description,
  link URL, CTA, optional `image_url` string. No upload, no video,
  no carousel.
- Workflow draft → submit → approve → publish (everything created
  **PAUSED** on Meta) → activate; partial-failure retry without
  duplication; every external call logged; AI copy grounded in real
  product prices.
- Meta publish client has exactly 4 operations: createCampaign,
  createAdSet, createAd, setObjectStatus. **No edit, no duplicate,
  no delete of live objects.**

**Automation (M10)**
- Rules: metric ∈ {platform_cpa, platform_roas,
  spend_no_conversions} × {gt, lt} × window days; action ∈
  {pause_campaign, alert}; pause goes through the confirmed Meta
  status path; alerts rate-limited 24h.
- Scheduler in the API process runs 10 job types (syncs etc.).

**Attribution (M4)** — first-party tracker (UTM/click ids, sessions),
4 models (first/last/last-non-direct/linear), **fixed 30-day window**
(no org setting), reconcile vs platform numbers.

**Adjacent**: competitor Ad Library intelligence (M8), RFM segments
and broadcasts (M17), chat COD confirmation (M13).

## 2. The gaps that matter (ranked by advertiser pain)

1. **No Conversions API (CAPI).** All conversion signal is browser
   side. For COD F-commerce on iOS-heavy traffic this is the single
   biggest performance leak: Meta optimizes on partial data. Our
   orders are server-side truth — perfect CAPI source — and nothing
   sends them.
2. **Insights stop at campaign level.** No ad/ad-set level metrics,
   no reach/frequency, no video metrics, no breakdowns (age, gender,
   placement). Creative decisions ("which image is burning money")
   are impossible inside the product today.
3. **Published campaigns are frozen.** Budget changes, the most
   common daily action in Ads Manager, cannot be done. Neither can
   scheduling/dayparting or duplication of a winner.
4. **No audiences product.** No custom audiences from the business's
   own customers (we HAVE the customer table!), no lookalikes, no
   saved audiences in targeting, no interest targeting beyond the
   4-field JSON. Retargeting — the highest-ROAS motion in BD — is
   entirely manual outside the product.
5. **No catalog / dynamic ads.** Products exist in our DB but never
   reach a Meta catalog, so no Advantage+ catalog sales, no DPA
   retargeting, no carousel-from-catalog.
6. **Creative handling is a URL string.** No media upload to Meta
   (adimages/videos), no creative library, no video ads, no
   carousel builder, no fatigue signals.
7. **Automation rules are pause-only.** No budget scaling with
   guardrails (the action advertisers actually automate), no
   first-party metrics (attributed ROAS/CPA) as rule inputs, no
   frequency/CTR conditions.
8. **Lead Ads and Click-to-WhatsApp are not connected.** OUTCOME_LEADS
   plans can be published, but lead form submissions never arrive;
   CTWA ads (the dominant BD format) land in WhatsApp with no
   campaign attribution in the inbox thread.
9. **Google/TikTok are read-only.** Publishing exists only for Meta
   (documented M10 deferral).
10. **Reporting is in-app only.** No scheduled delivery, no
    client-shareable read-only report links — a real agency need
    (Qosprey's own clients).

## 3. Feature plan — three phases

### Phase G — Signal & Measurement (proposed Milestone 18)
*Fix the data the whole system optimizes on. No new publishing risk.*

- **G1. Meta Conversions API.** Per-org dataset (pixel) config on
  the Meta integration; `ConversionEventLog` model. Send Purchase
  when a real order is placed/confirmed (configurable trigger:
  placed | cod_confirmed | delivered), Lead on lead creation, with
  SHA-256-hashed email/phone, external_id, event_source_url, and a
  shared `event_id` also emitted by tracker.js so browser + server
  events deduplicate at Meta. Success counts only on Meta's
  `events_received` response; failures logged with Meta's error.
  Test-event-code support for verification. UI: dataset settings +
  event log with per-event status (like publish logs).
- **G2. Ad-level insights.** Extend the Meta sync to `level: "ad"`
  rows (ad id/name, ad set id/name, reach, frequency, outbound
  clicks, video plays/ThruPlays where present) stored alongside
  campaign rows (new nullable level columns on DailyAdMetric;
  campaign totals unchanged). Creative performance table in
  Analytics: per-ad spend/CTR/CPA with the product's own orders
  where linkable — never merged with platform conversions.
- **G3. Breakdowns.** Daily age/gender and placement
  (publisher_platform × platform_position) aggregates in a new
  `DailyAdBreakdown` table + an audience-insights view on the
  Analytics page.
- **G4. Attribution window setting.** Org-level window days
  (7/14/30/60/90, default 30) used by the attribution engine and
  labeled on every report. (Closes a documented M4 limitation.)

*Needs: the same Meta token with access to the dataset; no new App
Review scope beyond what publishing already needs.*

### Phase H — Creative & Audiences (proposed Milestone 19)
*The retargeting + creative stack.*

- **H1. Creative library + Meta media upload.** Upload images to
  `/{account}/adimages` (store returned hash) and videos to
  `/{account}/advideos` (store video id + processing status);
  library page with per-asset usage. Builder ads can pick library
  assets instead of pasting URLs.
- **H2. Richer ad formats in the builder.** Video ads (video_id +
  thumbnail), carousel ads (2–10 child cards from products or
  manual entries), published through the same PAUSED-first,
  logged, resumable pipeline.
- **H3. Custom audiences from first-party data.** Build audiences
  from Customers/Leads (hashed phone/email upload to the
  customaudiences API; audience record with size/status from Meta,
  never invented), plus "buyers of product X", "RFM segment"
  audiences reusing M17 segments. Sync = explicit action with the
  API's own response recorded.
- **H4. Saved audiences + lookalikes in targeting.** Targeting JSON
  gains `customAudiences include/exclude`, `interests`, `behaviors`
  (validated passthrough), saved-audience presets per org; lookalike
  creation from a source audience (country + ratio) recorded with
  Meta's returned status.
- **H5. Catalog sync (Commerce).** Push products to a Meta catalog
  (batch items API), catalog record + per-item status; enables a
  catalog-sales objective path in the builder (product set by
  category/segment) — the DPA foundation.
- **H6. Duplicate & templates.** Duplicate any plan (structure only,
  fresh draft); save-as-template; 3 honest BD blueprints (COD sales,
  CTWA engagement, lead form) that prefill the builder.

*Needs: ads_management (already required for publishing); catalog
needs a Commerce account on the owner's side.*

### Phase I — Scale, Automation & Reach (proposed Milestone 20)
*Daily-operations power + the second platforms.*

- **I1. Live-object editing.** Change ad set daily/lifetime budget
  on Meta with confirmation + publish-log entries; plan-level
  start/stop scheduling; edits shown with before/after values.
- **I2. Automation rules v2.** Metrics add frequency, ctr, cpm and
  first-party attributed ROAS/CPA (clearly labeled as ours);
  actions add `scale_budget` (±% with min/max caps, cooldown,
  max-daily-change guardrail) and `activate`; every action logged
  with the metric snapshot that triggered it.
- **I3. Lead Ads sync.** Subscribe leadgen forms; on webhook,
  retrieve the lead from Graph and create a CRM Lead with the form
  answers as activities; source tagged per form/campaign.
- **I4. CTWA attribution.** Capture WhatsApp referral data
  (source id/type) on inbound conversations from click-to-WhatsApp
  ads; tag the conversation with the campaign where resolvable and
  surface "ads that start chats" in Analytics (chat-started counts
  from referral data only — no guessing).
- **I5. Google/TikTok publishing.** Google Ads campaign creation via
  the Ads API (Search + Performance Max basics) and TikTok campaign
  creation, behind the same plan/approval/PAUSED-first pattern where
  the platform supports it; explicitly gated on the owner's
  developer-token/app approvals. Largest item; may split into its
  own milestone after a capability spike.
- **I6. Scheduled + shareable reports.** Weekly ads summary emailed
  via the existing messaging providers; read-only public report
  links (unguessable token, expiry, org-scoped, no internal fields)
  for agency clients.

*Explicitly still postponed: Managed Ad Accounts + Prepaid Wallet
(policy decision), Advantage+ full automation black boxes we cannot
audit, any audience-size or delivery estimate we cannot source
from an API response.*

## 4. Recommendation

Do **Phase G first**: CAPI + ad-level data makes every later phase
measurably better and carries the least publishing risk. H is the
biggest day-to-day advertiser value (retargeting). I5 is the only
item whose timeline depends on third-party approvals; everything
else is buildable against APIs already integrated.
