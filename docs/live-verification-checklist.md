# Live Verification Checklist

Everything below is implemented and unit-tested with stubbed platform
APIs. This checklist closes the remaining gap: one real run per
integration, in your own environment, with your own accounts. Work top
to bottom - each step unblocks the next. Tick a box only when the
stated evidence exists, not when a button was clicked.

## Owner action list (updated 2026-10-10, after Milestone 24 — the full advertising roadmap is delivered; sections 18-20 are covered by the same accounts below)

Everything the software needs from you, in one place. Each item lists
where to get it and what it unblocks. Nothing else is blocked on code.

| # | What to bring | Where to get it | Unblocks |
|---|---------------|-----------------|----------|
| 1 | A WooCommerce store + REST API keys (read/write) | WP Admin -> WooCommerce -> Settings -> Advanced -> REST API | Step 1, 2, chat-order push, COD flows |
| 2 | A Meta app (one app serves Ads + Inbox + CAPI) | developers.facebook.com -> My Apps | Steps 3, 5, 7, 13-19 |
| 3 | Meta user/system token with ads_read (+ ads_management for publishing) | Meta app -> Marketing API / Graph API Explorer | Steps 3, 7, 16-19 |
| 4 | WhatsApp Business number + Page connected to the app | Meta app -> WhatsApp / Messenger products | Steps 5, 13, 14, 15 (CTWA) |
| 5 | An LLM API key (pick ONE provider) | OpenAI / Anthropic / Google AI Studio | Step 4 + translation, summaries, payment-vision, transcription |
| 6 | Steadfast merchant API key + secret | portal.packzy.com -> API settings | Step 15 (boundary already proven) |
| 7 | Pathao merchant API credentials (client id/secret) | merchant.pathao.com -> Developer API | Step 15 (sandbox E2E ready to run) |
| 8 | RedX API access token | merchant.redx.com.bd -> API settings | Step 15 (boundary already proven) |
| 9 | Google Ads developer token (approved) + OAuth refresh token | Google Ads -> Tools -> API Center; Google Cloud OAuth client | Steps 8, 17 publishing, 18 (keywords), 20 (offline conversions) |
| 10 | TikTok Marketing API app + advertiser token | TikTok Ads developer portal | Steps 9, 17 publishing, 20 (Events API) |
| 11 | Shopify custom app token + secret | Shopify admin -> Apps -> Develop apps | Step 10 |
| 12 | SMTP credentials (or Mailpit locally) + SSL Wireless account | Your mail host / sslwireless.com | Step 12 |
| 13 | A small real ad budget (a few hundred BDT) | Your ad accounts | Steps 7, 16, 17 live publish tests |
| 14 | A VPS/server for permanent deployment | Any Ubuntu VPS | Runbook: docs/deployment-vps-runbook.md |

Already proven live in the Muse sandbox (no account needed):
base system on real PostgreSQL; website live-chat widget end-to-end
(visitor message -> inbox); courier auth boundaries for Steadfast,
Pathao and RedX (each platform's own error returned, nothing saved);
CAPI settings + honest refusal without a token; public report link
rendered without login; Pathao production auth endpoint reached and
correctly judging credentials.

## 0. Base system (blocks everything else)
- [x] Postgres running (verified 2026-10-10 in the Muse sandbox with a
      real PostgreSQL 16 install: all 11 migrations applied, seed ran,
      API booted against it, login returned a real JWT, and the web app (all migrations through Milestone 20 are applied the same way; the sandbox demo has been rebuilt and re-verified after every milestone since)
      served publicly through a tunnel with working CORS. Two real bugs
      were found and fixed by this first live boot - the Email/SMS
      providers needed @Optional() constructor params for Nest DI.
      The docker-compose path below is the same flow on a dev machine.)
- [ ] `docker compose up -d` (Postgres, Redis, Mailpit all healthy)
- [ ] `pnpm install` then `pnpm db:generate`
- [ ] `pnpm --filter @repo/db exec prisma migrate deploy`
- [ ] `pnpm --filter @repo/db exec prisma db seed` (or the repo seed cmd)
- [ ] API + web start; login with owner@demo.local / ChangeMe123!
- Evidence: dashboard loads with the demo organization; Overview shows
  real (possibly empty) KPI cards, no placeholder numbers.

## 1. WooCommerce (Milestone 3)
- [ ] Create a store, connect with real REST API keys (connection is
      verified against the store before saving)
- [ ] Sync products, then orders
- Evidence: Sync Jobs show COMPLETED with fetched/created counts
  matching the store; an order placed on the store appears in Orders
  within one sync; webhook delivery recorded in WebhookEvent after
  registering the webhook URL shown in the UI.

## 2. Tracking & attribution (Milestone 4)
- [ ] Add tracker.js to the store theme per the Attribution page snippet
- [ ] Visit the store with UTM parameters, place a test order
- Evidence: the order shows touchpoints and attribution credit; the
  reconcile view explains any unattributed remainder.

## 3. Meta insights (Milestone 5)
- [ ] Meta app with Marketing API; connect a token (verified before save)
- [ ] Run insights sync (30 days)
- Evidence: DailyAdMetric rows exist; Analytics shows CTR/CPC/CPA and
  Profit shows contribution margin with a real COGS coverage figure.

## 4. Real LLM (Milestone 6)
- [ ] Decide the provider (OpenAI / Anthropic / Gemini), set
      LLM_PROVIDER, LLM_API_KEY, LLM_MODEL in the API environment
- [ ] Generate a daily report and ask the AI chat a data question
- Evidence: report badge shows the real provider (not dev-template);
  the chat answer cites numbers that match Analytics for the period.

## 5. Inbox & CRM (Milestone 7)
- [ ] In the same Meta app: add WhatsApp + Messenger products, set the
      webhook URL and verify token from the Inbox settings, subscribe
      the page / WhatsApp number
- [ ] Send a real WhatsApp message and a Messenger message to the page
- Evidence: both appear in the Inbox; a reply sent from the UI arrives
  on the phone (delivery id recorded on the message); a Lead was
  auto-created for the new contact.

## 6. Competitor intelligence (Milestone 8)
- [ ] Provide an Ad Library token (FACEBOOK_AD_LIBRARY_TOKEN or the
      Meta integration) whose user completed any identity confirmation
      Meta requires for ad-library access in your region
- Evidence: a competitor sync stores real ads with archive ids; a
  website scan stores price observations that all carry source URLs.

## 7. Campaign publishing (Milestone 9)
- [ ] Meta app needs ads_management; for accounts the app user does not
      own, Advanced Access + App Review approval
- [ ] Build a small plan (tiny daily budget), approve it, Publish
- Evidence: Publish Log shows campaign/adset/ad created with Meta ids,
  all PAUSED in Ads Manager; then Activate from the UI and confirm the
  campaign is ACTIVE in Ads Manager; Pause returns it to PAUSED.

## 8. Google Ads (Milestone 10)
- [ ] Developer token at an approved access level (test tokens only
      work against test accounts), OAuth client + refresh token
- [ ] Connect from Advertising Accounts, run a sync
- Evidence: DailyAdMetric rows with source "api" and platform "google";
  totals match Google Ads UI for the same days (allowing restatement).

## 9. TikTok Ads (Milestone 10)
- [ ] TikTok Marketing API app + advertiser authorization token
- Evidence: advertiser verified at connect; sync rows match TikTok Ads
  Manager for the same range.

## 10. Shopify (Milestone 10)
- [ ] Custom app with read_products/read_orders, install, connect with
      the Admin API token + client secret
- [ ] Sync products/orders; register the webhook URL from the UI
- Evidence: products (with variants) and orders land with source
  "shopify"; a new order arrives via webhook without a manual sync.

## 11. Automation (Milestone 10)
- [ ] Create a scheduled job (e.g. Woo orders every 30 minutes) and an
      alert-only rule first
- Evidence: Automation Runs show executions with real summaries;
  the alert rule triggers with metric evidence before any pause rule
  is armed.

## 12. Messaging & workflows (Milestone 11)
- [ ] Email: point SMTP at Mailpit locally first, send a broadcast to
      the customers audience
- Evidence: messages visible in the Mailpit UI (localhost:8025);
  every delivery row carries an SMTP message id. Then repeat with the
  real SMTP provider and confirm SPF/DKIM pass in the received headers.
- [ ] SMS: SSL Wireless account with balance + approved sender id;
      send a small broadcast to one lead stage
- Evidence: the SMS arrives on a real phone; delivery rows carry the
  gateway reference; a failed number records the gateway's error.
- [ ] Workflow: create "new order >= 1000 -> thank-you email", place a
      qualifying and a non-qualifying order
- Evidence: one completed run + sent delivery for the qualifying
  order, one skipped run for the other, nothing sent twice.

## 13. Inbox power pack & intelligence (Milestones 12-13)
- [ ] With the Meta app from step 5: send text, image and voice
      messages; assign the chat; use a quick reply; add an internal
      note; check the 24h window warning on WhatsApp
- [ ] Turn auto-reply to "draft", send "দাম কত?" for a real product
- Evidence: intent + confidence shown on the message; the draft
  cites the product's real price (or no draft when data is missing);
  team report shows first-response times; a COD confirmation sent
  from the chat flips to confirmed when the customer replies "হ্যাঁ".

## 14. Chat commerce & revenue automation (Milestones 14-15)
- [ ] Create a chat order for a WooCommerce product; enable the bot
      on a test conversation and complete a full bot order
- Evidence: the order lands in WooCommerce (or the order shows the
  store's own error); bot summary totals match the catalog prices;
  a recovery workflow run appears after the wait step elapses.

## 15. Couriers (Milestones 16 + 21)
- [x] Steadfast auth boundary proven 2026-10-10 (invalid keys ->
      Steadfast's own 401, nothing saved)
- [ ] Steadfast: connect real keys, book one real order, sync status
- Evidence: shipment carries consignment + tracking code; a status
  change posts the notification into the originating chat thread.
- [x] Pathao production auth endpoint proven 2026-10-10 (wrong
      password -> Pathao's own "credentials were incorrect")
- [ ] Pathao sandbox E2E (ready to run): Orders page -> Pathao card
      (attempted twice on 2026-10-10 through the app's connect flow
      with Pathao's published sandbox credentials, and once by
      direct request: the sandbox host itself returns Cloudflare
      522 — origin down. App behaved correctly: clean 400 with the
      522, nothing saved. Retry when the sandbox is back, or close
      it with production credentials in Session 6 of
      docs/m30-live-verification-sprint.md.)
      -> check "Sandbox" and connect with Pathao's published test
      credentials (client_id 7N1aMJQbWm; see merchant.pathao.com
      Developer API docs for the test secret/username/password),
      then book a test order and sync its status.
      NOTE: on 2026-10-10 the sandbox host itself returned 522
      (Pathao's origin down) on repeated attempts - retry when it
      is back; the client reached production correctly the same day.
      RE-CHECKED later on 2026-10-10 (~14:52 Asia/Dhaka):
      https://courier-api-sandbox.pathao.com/ still returned 522,
      so the sandbox E2E is still blocked on Pathao's side, not on
      credentials or code; no owner action is needed for this item.
- [ ] Pathao production: connect real merchant credentials, book
      one order, sync status
- [x] RedX auth boundary proven 2026-10-10 (dummy token -> RedX's
      own 401 Unauthorized, nothing saved)
- [ ] RedX: connect a real token, book one parcel (area picker),
      sync status
- Evidence (all couriers): bookings count only with the courier's
  own tracking id; duplicate active bookings are refused per
  provider; statuses arrive in the shared vocabulary (delivered /
  returned / cancelled / in_transit) and notify the chat customer.

## 16. Advertising signal & creative (Milestones 18-19)
- [ ] CAPI: save the real dataset id + token, send a test event,
      then place/COD-confirm a real order per the chosen trigger
- Evidence: Events Manager shows the test event; the event log row
  says sent with events_received >= 1; the browser Purchase (same
  event_id) deduplicates against the server event.
- [ ] Run ad-level + breakdown syncs; upload one image and one
      video creative; build a custom audience from customers;
      push the catalog
- Evidence: Analytics Creative table + age/gender panels filled;
  the creative turns ready with Meta's hash; the audience shows
  Meta's approximate count after refresh; catalog push reports
  Meta's own handle/error counts.

## 17. Scale & reach (Milestone 20)
- [ ] Edit a live ad set budget from the builder (small change)
- Evidence: the budget changed in Ads Manager; the publish log has
  the budget_update step; the audit log shows before/after.
- [ ] Subscribe the Meta app to the page's `leadgen` webhook field,
      submit a test Lead Ad form
- Evidence: a Lead appears in the CRM with source
  facebook_lead_ads and the form answers in its activity.
- [ ] Run a tiny CTWA campaign; message the business from the ad
- Evidence: the conversation carries the ad source; the CTWA
  report counts the chat under that ad.
- [ ] Google/TikTok: publish one small PAUSED campaign each from
      the Ad Accounts page, then enable it in the platform UI
- Evidence: the publication record shows created_paused with the
  platform's campaign id; every chain step is in its detail.
- [ ] Create a client report link and open it logged-out
- Evidence: totals match Analytics for the window; no cost or
  profit figure appears anywhere on the page.

## 18. Phase J — trust & completeness (Milestone 22, needs Meta/Google)
- [ ] Status sync on a live published plan: a deliberately policy-violating test ad shows DISAPPROVED with Meta's issue text in the builder
- [ ] meta_status_sync nightly job run: plan effective statuses updated without opening the builder
- [ ] Live schedule edit: change a published ad set's end time and confirm the new time in Ads Manager
- [ ] UTM governance: publish an ad without UTMs and confirm the live Meta ad's link carries utm_campaign=<plan slug>; an owner-supplied utm_campaign is NOT overwritten
- [ ] Google publish WITH keywords: the created Search campaign in Google Ads shows the keywords (PAUSED), the negative, and the sitelink/callout assets
- [ ] Audience refresh-members: after adding new customers, the Meta audience's approximate count grows on the next size refresh

## 19. Phase K — optimization intelligence (Milestone 23, needs Meta data)
- [ ] Breakdown sync now also fills device / region / hourly panels in Analytics (BD traffic should show mostly mobile devices)
- [ ] Creative leaderboard: run ads 2+ weeks, confirm a high-frequency + falling-CTR ad is flagged Fatigued; an ad_frequency > 3 pause_ad rule pauses ONLY that ad on Meta
- [ ] Dayparting: set a Friday-only window on a live ad set, create the dayparting job (15 min), confirm the ad set pauses outside the window in Ads Manager and the plan log shows daypart_off
- [ ] A/B: publish variants A and B with equal budgets; the board names a winner only after both spent >= 100 units — confirm no winner is claimed before that
- [ ] Pacing: set a monthly budget and confirm pace % matches Ads Manager month-to-date spend
- [ ] Product sets: member counts match a manual count of the catalog products for the same filters

## 20. Phase L — reach & agency (Milestone 24, needs Google/TikTok accounts)
- [ ] Google offline conversions: create the offline conversion action in Google Ads, save its id, confirm a COD order with a real gclid uploads (log shows sent with Google's confirmed gclid) and appears in Google Ads conversions
- [ ] TikTok Events API: with a real pixel code + ttclid order, confirm the event lands in TikTok Events Manager (test events view)
- [ ] Orders WITHOUT a click id must stay "skipped" in the log — confirm one in the UI
- [ ] Policy pre-flight: paste known risky copy ("আপনি কি মোটা?") into a draft ad and confirm the high-severity finding with explanation appears before publishing
- [ ] Agency portfolio with a second client org: totals equal the sum of the two orgs' own dashboards; the weekly digest email arrives (needs SMTP)

## 21. Admin Console (M25+)

- [x] Admin app (/login) serves; tenant credentials refused by the gate (API returns 403 for tenant tokens on /admin/*)
- [x] CLI grant creates the first SUPER admin; last-SUPER revocation refused
- [x] Suspended user cannot log in; suspended org members are refused by TenantGuard
- [x] TOTP lifecycle verified live against the real API (gate, enrolment, challenge login, wrong-code refusal) — M28
- [x] SaaS billing verified live (subscription set, manual payment recorded, MRR/collections from real rows) — M27
- [x] Settings/announcement/limits verified live (announcement on public status, AI cap 429, signup gate 403) — M26
- [ ] Owner to verify in a browser: admin login -> overview/users/orgs/billing/security pages with a granted account
- [ ] Owner action: keep the demo owner's TOTP secret in an authenticator (enrolled during M28 live checks), or re-enrol from the Security page

## 22. Milestone 32 — Advertising Stretch Pack
- [ ] TikTok: publish one campaign with a Video URL; confirm the
      video processes in TikTok Ads Manager and the ad shows
      SINGLE_VIDEO with the returned video id.
- [ ] Advantage+: instantiate the Advantage+ blueprint (or toggle
      it on a SALES draft), publish tiny, and confirm in Ads
      Manager that the budget sits on the CAMPAIGN, ad sets carry
      no budget, and Advantage+ audience expansion is on.
- [ ] Performance Max: publish one PMax campaign with real assets;
      confirm campaign + asset group PAUSED, all asset links
      present, and the all-products listing group accepted (if
      Google rejects the listing filter shape, the publication
      record keeps Google's exact error — report it back).
- [ ] Product sets: push products to a catalog, create a local
      set, publish it to Meta, and confirm the set appears in
      Commerce Manager with the expected filter; delete it and
      confirm metaDeleted: true in the response.
