# Milestone 10 Acceptance Checklist - Expansion & Automation

Platform expansion (three new real adapters, same pattern as before:
verified before saving, AES-GCM encrypted, sync RESTATES daily rows,
failures surface the platform's own error text - nothing is faked):

- [x] Google Ads adapter (apps/api/src/ads/google): OAuth2 refresh-token
      exchange, developer-token headers, GAQL via googleAds:search with
      pagination, cost_micros converted to integer minor units exactly
      (unit-tested). Customer verified via customers/{id} before saving.
- [x] TikTok Ads adapter (apps/api/src/ads/tiktok): advertiser verify +
      /report/integrated/get/ campaign daily reports with pagination;
      TikTok envelope errors (code/message) surface verbatim (tested).
- [x] Both adapters feed DailyAdMetric via the shared upsert used by
      Meta/CSV/manual, so Analytics, Profit, Attribution and AI Reports
      cover Google and TikTok with no further changes. Ad Accounts page
      gained verify-then-connect forms + per-platform sync buttons.
- [x] Shopify adapter (apps/api/src/integrations/shopify): Admin API
      sync for products (incl. variants, stock summed across variants)
      and orders (status mapping, COD detection from gateway names,
      refunds summed only from successful refund transactions) reusing
      the WooCommerce upsert pipeline via a generalized `source`
      parameter - one product/order model for both platforms.
- [x] Shopify webhooks: HMAC-SHA256 (base64, timing-safe) verified
      against the app secret saved at connect, X-Shopify-Webhook-Id
      dedupe, products/orders topics processed through the same
      upserts. Signature tests included.
- [x] Store.platform is now honored at creation (WOOCOMMERCE/SHOPIFY/
      CUSTOM) and the Stores page has the Shopify connect form and
      per-provider webhook instructions.

Automation:
- [x] Prisma: ScheduledJob, AutomationRule, AutomationRun + migration
      20261010090000. Schema: 53 models.
- [x] Scheduler: in-API runner (60s tick, DISABLE_SCHEDULER to turn
      off) executes 10 job types through the existing services - store
      syncs (Woo/Shopify), Meta/Google/TikTok insights, daily AI
      report, competitor ad sync/scan. Every execution writes an
      AutomationRun (success summary or the real error) and advances
      nextRunAt by the interval regardless of outcome, so a broken job
      cannot hot-loop. "Run now" available from the UI.
- [x] Automation rules evaluated hourly (and on demand): platform CPA,
      platform ROAS, spend-without-conversions over a configurable
      window, from DailyAdMetric rows of the plan's actual Meta
      campaign. Pause actions go through CampaignsService.setMetaStatus,
      so a pause "happens" only when Meta confirms it, and is logged
      in both CampaignPublishLog and AutomationRun with the metric
      evidence. Alert actions are rate-limited to one per rule+plan
      per 24h. Rules only ever see published campaigns.
- [x] Web: Automations page (jobs with target pickers, rules, runs
      history) and the Automations nav item is live.
- [x] Tests: 152 total passing (API 144, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Live verification still needs the user's accounts: Google
      developer token at an approved access level, a TikTok Marketing
      API app + advertiser authorization, and a Shopify custom app.

## Decisions & limitations (documented, per autonomy grant)
- The scheduler runs inside the API process (Nest monolith). With
  multiple API instances, enable it on exactly one instance
  (DISABLE_SCHEDULER=true elsewhere) or move execution to the BullMQ
  worker - the job table and run log make that a transport change
  only. This avoids new infrastructure before it is needed (ADR-001).
- Google/TikTok campaign CREATION/publishing is not implemented:
  Meta remains the only publish path (Milestone 9). Google/TikTok are
  analytics integrations until their write APIs are separately
  justified; the AdsModule pattern makes that addition mechanical.
- Email/SMS campaign sending and a visual workflow builder remain the
  next expansion items (Milestone 11) - BD SMS gateways need separate
  provider agreements, and email needs SPF/DKIM setup per sender domain;
  neither should be shipped as a fake.
