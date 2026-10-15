# Campaign Builder Next — Live Verification Checklist (CN12)

Status: **ALL ITEMS UNCHECKED.** Nothing in this document has
been live-proven. Every CN1–CN11 surface below is
spec/fixture-proven in the sandbox only.

These sessions are OWNER-GATED: they need (a) the campaign-next
build integrated + deployed (owner's push instruction + Dokploy
Redeploy + the CN migrations run on the real DB), and (b) the
owner's real Meta / Google / TikTok accounts, entered by the
owner into the app's verify-before-save forms — never pasted in
chat. This is the campaign track of the M30 sprint.

Each item: the in-app steps, and the evidence that proves it.
Check an item only when the evidence exists.

## S1 — Connection & targeting search (CN1)
- [ ] Connect a real Meta ad account (Connect Center), open the
  Campaign Builder, search an interest in the targeting search
  box. Evidence: real results returned from Meta (not
  `{available:false}`), with audience-size figures.
- [ ] Save an ad set with a search-confirmed interest id +
  a behavior id. Evidence: save succeeds; the stored targeting
  shows the ids.
- [ ] Try saving an ad set with a hand-typed fake interest id.
  Evidence: save is REFUSED with the Bengali reason (validation
  is live, not just spec'd).

## S2 — Location depth + estimates (CN1)
- [ ] Build an ad set targeting a city + radius (e.g. Dhaka,
  15 km) and a postcode list. Evidence: the published (PAUSED)
  ad set on Meta shows the same geo_locations when read back
  in Ads Manager.
- [ ] Open readiness on a plan with 2+ ad sets. Evidence: EACH
  ad set shows its own Meta delivery estimate range (or a real
  Meta error verbatim), not the first set's copied twice.

## S3 — Bidding & budget modes (CN2)
- [ ] Publish an ABO plan and a CBO plan (both PAUSED).
  Evidence: Ads Manager shows per-ad-set budgets on the ABO
  campaign and the campaign-level budget on the CBO campaign.
- [ ] Publish a bid-cap ad set and a ROAS-goal (VALUE) ad set.
  Evidence: Meta accepts both; the bid strategy + floor on
  Meta match what the builder sent (publish log + Ads Manager
  read-back). If Meta rejects a mapping, record the verbatim
  error here and treat the mapping as unproven until fixed.
- [ ] Open the pacing panel on a live published plan after at
  least one day of real spend. Evidence: spent figure equals
  the DailyAdMetric total for the campaign; state is not
  `no_data`.

## S4 — Conversion events & catalog ads (CN3)
- [ ] Publish a sales ad set with a non-PURCHASE event
  (e.g. INITIATE_CHECKOUT). Evidence: promoted_object on Meta
  carries that custom_event_type.
- [ ] Readiness on an org with a real CAPI setup. Evidence:
  the events row reflects the REAL CAPI state (not "unknown"
  because the tree finally shares the Connect Center state).
- [ ] Publish a catalog ad set (product set picked from the
  org's real Catalog). Evidence: Meta accepts the
  `template_data` dynamic creative; the ad renders products
  from the set in Ads Manager preview.

## S5 — Lead Ads end-to-end (CN4)
- [ ] Create a Lead Form in the builder and create it on Meta.
  Evidence: Meta returns a form id (the ONLY acceptance of
  "created"); the form is visible on the Page's lead setup.
  If Meta refuses the token class, record the verbatim refusal
  — that reopens the token-class question recorded in NB2.
- [ ] Run the published (then owner-activated) lead ad, submit
  a test lead. Evidence: the lead arrives via the leadgen
  webhook AND appears in the CRM with the form→field mapping
  applied (custom answers in the mapped custom fields).

## S6 — Creative v2 (CN5)
- [ ] Publish a link ad with 3 primary texts + 2 headlines.
  Evidence: Meta's creative shows the asset-feed options
  (Ads Manager creative details), not just the first option.
- [ ] Publish an ad with a Stories placement override asset.
  Evidence: the placement asset rule is accepted; preview in
  Ads Manager shows the override on Stories, base on Feed.
- [ ] Enable a creative-enhancement toggle. Evidence: Meta
  accepts the degrees_of_freedom payload.

## S7 — Audience Studio (CN6)
- [ ] Create a "buyers" audience from the builder on an org
  with real orders. Evidence: AudienceRecord created AND the
  audience appears in the Meta ad account with a populating /
  ready status from Meta (size from Meta, not our count).
- [ ] Create a lookalike from it. Evidence: lookalike exists
  on Meta and reaches ready state.
- [ ] Apply the "exclude purchasers 30d" preset and publish.
  Evidence: the exclusion is visible in the ad set targeting
  on Meta.

## S8 — Optimisation loop (CN7)
- [ ] On a plan with ≥7 days of real spend, open breakdowns.
  Evidence: age/gender/placement/device numbers reconcile
  with Ads Manager for the same period (sampling differences
  noted, not hidden).
- [ ] Trigger a fatigue recommendation on a genuinely fatigued
  ad (or record that none qualified). Evidence: the
  recommendation's numbers match the breakdown/metric rows;
  applying it creates a DRAFT only.

## S9 — Multi-account (CN8)
- [ ] With a second real Meta ad account connected, clone a
  plan across accounts. Evidence: the mapping report's
  carried/blocked lists match reality (page/pixel/audience
  presence in the target account); the clone publishes
  (PAUSED) after blockers are re-picked.

## S10 — Cross-platform (CN9) + scheduled launch (CB5)
- [ ] Create a Google draft and a TikTok draft from an
  approved plan. Evidence: each platform's own UI shows the
  campaign PAUSED/DISABLED with the mapped fields; the draft
  manager's stored fields match.
- [ ] Schedule an approved plan for launch and let the scan
  fire. Evidence: the plan publishes PAUSED at the set time;
  publish log + creator notification exist.

## Deploy-time screenshot QA (CN10)
- [ ] Builder guided flow + sticky rail at desktop / tablet /
  mobile widths (screenshots filed).
- [ ] Hub v2: pagination, performance columns, saved views,
  launch calendar at the same widths.
- [ ] Audience Studio card + Lead Forms panel on mobile.
  (Checklist only — requires the deployed build; no item here
  is checked from the sandbox.)
