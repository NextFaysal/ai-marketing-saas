# Advertising Review #2 — Post Phase G/H/I (2026-10-10)

Second advertising review. The first review's plan (Phases G, H, I)
is fully delivered in Milestones 18-20: CAPI + ad-level insights +
breakdowns + attribution window, creative library + video/carousel
+ audiences + catalog, live budget edits + rules v2 + Lead Ads +
CTWA + Google/TikTok publishing + shareable reports.

## Verified current state (from the code, not the roadmap)

- Meta: analytics to ad level; campaign/adset/ad publish (PAUSED
  first), activate/pause, live budget edits; objectives classic
  OUTCOME_*; formats link/video/carousel; targeting geo/age/gender/
  interests/audience include-exclude; catalogs created + pushed;
  audiences created from first-party data (hashed), lookalikes.
- Google/TikTok: analytics sync; a direct publish chain exists
  (Google Search budget->campaign->geo->ad group->RSA; TikTok
  campaign->ad group->image ad), all created paused/disabled.
- Rules: platform + first-party metrics, pause/alert/activate/
  scale_budget with caps + cooldown; runs keep metric evidence.
- Measurement: CAPI Purchase/Lead with dedupe, first-party
  attribution (4 models, org window), CTWA chat counts, client
  report links without costs/profit.

## Ranked gaps found in this review

1. **Published objects are never read back.** `metaStatus` changes
   only when WE act. Ads Manager-side pauses, DISAPPROVED ads,
   learning/limited statuses and account issues are invisible in
   the app — a trust/correctness gap of the same kind as the
   Milestone 20 double-count: the UI can claim "published" while
   Meta rejected the ad. (grep: no effective_status anywhere.)
2. **Google Search campaigns ship without keywords.** The publish
   chain creates no ad group keywords and no assets (sitelinks,
   callouts) — a Search campaign with no keywords cannot serve
   meaningfully. The Google chain is structurally incomplete.
3. **Ad scheduling is dead in the middle.** CampaignAdSet has
   startTime/endTime and the publish client sends start_time/
   end_time, but CampaignsService never passes them and the
   builder has no date inputs. No dayparting either.
4. **Audiences are create-once.** The /users append endpoint is
   used only at creation; there is no "refresh membership" for an
   existing audience and no scheduled re-sync, so lists decay from
   the day they are built.
5. **Breakdowns stop at two dimensions.** age_gender + placement
   only. No device (BD traffic is overwhelmingly mobile — this is
   the difference between a useful and a decorative report), no
   region, and no hourly breakdown, which is the data dayparting
   decisions need.
6. **UTM discipline is unenforced.** Ad link URLs are free text.
   First-party attribution and the Milestone 20 first-party rule
   metrics key off utm_campaign; nothing auto-tags or validates
   links, so the whole first-party measurement quietly degrades.
7. **Server conversions exist only for Meta.** The tracker already
   captures gclid and ttclid, but there is no Google offline
   conversion import and no TikTok Events API — COD advertisers
   (whose conversions complete offline) systematically
   under-optimize on Google/TikTok.
8. **No creative testing system.** Variants are separate ads; there
   is no structured A/B (audience split, winner metric, result
   view), and no creative fatigue signal: rules v2 metrics are
   campaign-level only, so a dying creative inside a healthy
   campaign is invisible.
9. **No catalog-driven campaigns.** The catalog can be pushed, but
   there are no product sets and no Advantage+ / dynamic sales
   flow that uses it; Advantage+ Sales campaigns are not offered
   at all.
10. **No budget pacing or portfolio view.** Rules react to windows;
    nothing shows spend pace vs the month, per-account monthly
    caps, or "move budget from X to Y" suggestions across plans.
11. **No ad policy pre-flight.** Preventable Meta rejections
    (implied personal attributes, before/after imagery claims,
    unrealistic promises) are the top account-health killer for BD
    advertisers; nothing checks copy before publish.
12. **No agency rollup.** Qosprey serves clients; reporting is
    per-organization only. A user in several orgs has no portfolio
    view (spend / revenue / ROAS per client).

Smaller items: TikTok publishing is image-only (no video upload);
Google Performance Max not offered; no hourly intraday insights.

## Proposed phases

### Phase J — Trust & Completeness (recommended first)
- J1 Published-object status sync: read effective_status for
  campaigns/ad sets/ads of published plans (manual + scheduled),
  surface DISAPPROVED with Meta's reason, reflect external pauses;
  plan health badge in the builder.
- J2 Google completeness: keyword management in the publish chain
  (text + match type, per ad group), negative keywords, and basic
  assets (sitelinks + callouts) — created paused like the rest.
- J3 Scheduling wired end-to-end: builder date inputs, service
  passes start/end to Meta, live schedule edit via the ad set
  endpoint next to the budget editor.
- J4 UTM governance: builder auto-appends utm_source/medium/
  campaign (= plan name) unless the owner overrides; a pre-publish
  warning when a link lacks UTMs; the same tagger for CTWA/lead
  blueprint links.
- J5 Audience membership refresh: append current source contacts
  to an existing audience (hashed, batched), a scheduled job type
  for weekly refresh, and last-refreshed state on the record.

### Phase K — Optimization Intelligence
- K1 Breakdowns v2: device, region, hourly (advertiser timezone)
  sync + Analytics panels; hourly feeds K4.
- K2 Creative intelligence: per-ad fatigue metrics (frequency,
  CTR trend), rules v3 with ad-level metrics + pause_ad action,
  creative leaderboard in Analytics.
- K3 Structured A/B tests: variant groups inside a plan (copy or
  creative), even-split guidance at publish, results view with
  the plan's chosen winner metric (first-party CPA default).
- K4 Dayparting: weekly schedule grid per live ad set applied via
  rules-engine time windows (activate/pause on schedule, logged
  like every other action).
- K5 Pacing + portfolio: month pace per account/plan, monthly cap
  guardrail rule, cross-plan budget-shift suggestions (owner
  applies; nothing auto-moves).
- K6 Catalog sales: product sets (category/price filters over the
  real catalog) + an Advantage+ catalog sales blueprint using
  them.

### Phase L — Reach & Agency
- L1 Google offline conversions: upload order conversions keyed
  by stored gclid (same triggers/dedupe discipline as CAPI),
  with an upload log.
- L2 TikTok Events API: Purchase/CompletePayment server events
  keyed by ttclid, same setting/trigger pattern as Meta CAPI.
- L3 Policy pre-flight checker: deterministic BN/EN copy checks
  (personal attributes, before/after, income/health claims,
  excessive caps/emoji) with explanations + safer rewrites
  suggested by the grounded LLM when configured.
- L4 Agency portfolio: cross-org rollup for multi-org users
  (spend, revenue, ROAS, active alerts per client) + a combined
  weekly digest.
- Stretch: TikTok video creative upload; Advantage+ Sales
  objective; Google Performance Max skeleton.

## Recommendation
Phase J first: it closes correctness gaps (objects that Meta
rejected while we show "published"; Google campaigns that cannot
serve; scheduling fields that silently do nothing) before adding
new intelligence on top — the same order that paid off in the
Milestone 20 double-count fix.
