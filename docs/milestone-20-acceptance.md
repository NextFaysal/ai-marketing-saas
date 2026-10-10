# Milestone 20 Acceptance — Phase I: Scale, Automation & Reach

Delivered 2026-10-10 on the owner's approval (advertising review,
`docs/advertising-review.md`, Phase I). Schema: 78 -> 80 models
(+PlatformPublication, +ReportShare; AutomationRule.actionConfig;
ChannelMessage.referral; ChannelConversation.ctwaSourceId;
Lead.externalId). Migrations `20261010200000_m20_phase_i` and
`20261010200500_m20_lead_external` applied.

## Also fixed (found during Phase I prep)
Ad-level syncs (Milestone 18) put per-ad rows next to campaign-level
rows; overview/profit/rule aggregation summed BOTH and would double
ad spend. All campaign-total paths now use campaign-level rows only
(Analytics computeRange + aggregates, automation campaignMetrics).
Covered by a unit test with interleaved ad/campaign rows.

## Delivered

**I1. Live budget editing** — a published plan's ad set budget can
be changed from the builder: Meta is updated first via the Graph
API and local state + publish log change only on Meta's
confirmation (OWNER/ADMIN only, audited with before/after values).

**I2. Automation rules v2** — new metrics frequency, CTR %, CPM
(campaign-level rows; frequency needs reach, which campaign sync
now fetches) and first-party ROAS/CPA (from the org's own
attribution credits matched by touchpoint campaign name/id — never
mixed with platform metrics). New actions: activate_campaign
(Meta-confirmed) and scale_budget (±percent with min/max daily caps
and a cooldown, default 24h; each ad set goes through the same
Meta-confirmed budget path; the run log keeps the metric snapshot
and every confirmed change). Percent range validated (-90..200).

**I3. Lead Ads sync** — leadgen webhook changes are parsed; the
lead's answers are fetched from the Graph API with the page token
and stored as a CRM Lead (source facebook_lead_ads), idempotent on
the leadgen id; a full-answers activity is kept and lead.created
fires (CAPI Lead events + workflows pick it up). Nothing is created
when the fetch fails.

**I4. CTWA attribution** — WhatsApp referral data on the first
message of an ad-started chat is stored on the message and pins the
originating ad id on the conversation. GET /ctwa-report groups
chats per ad and resolves campaign names from ad-level metrics
when available — chats are counted, never converted into invented
sales figures.

**I5. Google + TikTok publishing** — direct PAUSED-first chains
behind new endpoints + Ad Accounts page forms:
- Google: budget -> Search campaign (PAUSED) -> per-country
  location criteria (geo constants resolved via the suggest API,
  never hardcoded) -> ad group (PAUSED, standard 1-unit default CPC
  bid, disclosed in the record) -> responsive search ad (PAUSED).
- TikTok: identity lookup -> location resolution via the location
  tool (refuses to guess unknown countries) -> campaign/ad group/ad
  all created DISABLED, image uploaded by URL.
A publication record exists from the first call: failed steps mark
it failed with the step's error and keep earlier resource names;
"created_paused" requires ids back for the whole chain.

**I6. Shareable reports + scheduled email** — expiring public
report links (`/r/<token>`, no login): totals + platform KPIs +
campaign rows from the same computeRange the dashboard uses,
deliberately WITHOUT costs/profit (test asserts neither the keys
nor the values leak). Revocable from the Analytics page. New
scheduled job type `weekly_ads_report` emails OWNER/ADMIN members
a 7-day spend/orders/revenue summary (SMTP unconfigured = honest
job failure).

## Verification
- API tests 260 pass (10 new: metrics exclude ad rows; scale fires
  once then cooldown; percent validation; budget update body +
  local state + cap clamp; parser referral/leadgen; leadgen ingest
  + dedupe; share exclusion + expiry; Google chain + validation;
  TikTok chain with resolved location + DISABLED payloads).
- Web builds (public report page + builder budget edit + rule/job
  forms + publish forms).
- Live on the sandbox demo: share link created, public report read
  WITHOUT auth (honest zeros), /r page 200, CTWA/publications
  endpoints return honest empties, scale rule created, invalid
  percent refused with a clear 400, weekly job created.

## Limitations / owner steps
- Lead Ads needs the Meta app subscribed to the page's `leadgen`
  webhook field (owner-side App Dashboard step).
- Google publishing needs the account's developer token approved
  for production (basic access) — same external gate as M10.
- Budget edits are Meta-only (Google/TikTok live edits come with
  their Ads Manager equivalents in the publication record notes).
- Report links show platform-reported conversions; the note on
  every report says they can differ from tracked orders.
- The advertising roadmap (Phases G/H/I) is now fully delivered.
  The remaining product backlog is the live-verification checklist
  with the owner's real accounts, plus postponed items (Wallet /
  Managed Accounts) and permanent deployment.
