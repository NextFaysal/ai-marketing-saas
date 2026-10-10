# Milestone 5 Acceptance Checklist - Ad Analytics & Profit

- [x] Prisma models: AdAccount, AdCampaign, DailyAdMetric,
      DailyMetricAggregate + migration 20261010040000_milestone5.
      Schema total: 31 models.
- [x] Ad accounts: create (any platform, csv/manual source), list.
- [x] Ad spend CSV import: date + spend required; campaign_id,
      campaign_name, impressions, clicks, conversions, conversion_value,
      currency; per-row errors; sample file in docs/examples.
      Re-import RESTATES a day (platforms correct numbers), it does not
      skip like product CSV and never double counts (unique key:
      org + account + campaign + date + source). Tests prove this.
- [x] Manual daily entry with the same upsert semantics.
- [x] Meta adapter (real Graph API client, not a mock):
      token verification via /me BEFORE saving, ad account discovery
      with pagination restricted to graph.facebook.com, campaign
      insights sync (level=campaign, time_increment=1), conversions
      extracted from `actions` by priority (purchase >
      omni_purchase > fb_pixel_purchase) so overlapping types are
      never double counted; token stored AES-256-GCM encrypted.
      Graph version configurable via META_GRAPH_VERSION (default v21.0).
- [x] Metrics engine (pure, tested): CTR, CPC, CPM, CPA,
      platform ROAS (platform value / spend), MER (total revenue /
      total spend), cost per order. Zero denominators return null,
      never Infinity or a fake 0.
- [x] Profit: contribution = revenue - refunds - COGS - ad spend.
      COGS uses the product cost in effect on the order date
      (chooseCostForDate). Response includes COGS coverage %; the UI
      warns when coverage < 100% that profit may be overstated.
      Courier cost and payment fees are excluded and this is stated.
- [x] Analytics API: overview (totals, KPIs, platforms, campaigns,
      daily series, mixed-currency warning) + recompute endpoint that
      persists DailyMetricAggregate rows for Milestone 6 reports.
- [x] Separation rule enforced in models and UI copy:
      platform-reported conversions are NEVER merged with first-party
      order/attribution numbers; both are shown, labeled.
- [x] Web: Advertising Accounts page (create, CSV import, manual entry,
      Meta connect + insights sync), Analytics page (date range, KPI
      cards, daily revenue vs spend bars, contribution breakdown,
      campaign table), Profit page (coverage warning).
- [x] Tests: 73 total passing (API 65, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Live Meta sync requires the user's own Meta app + token and
      ads_read access (App Review for accounts not owned by the app
      user). CSV/manual paths work without it, by design.

## Known limitations
- Google Ads and TikTok adapters arrive in Phase 10; their accounts can
  already be created and fed by CSV/manual entry today.
- Overview computes in memory over at most 20k orders/metrics per org;
  DailyMetricAggregate exists so heavier reporting can move to rollups.
- Attribution-window setting is still fixed (30 days, from Milestone 4).
