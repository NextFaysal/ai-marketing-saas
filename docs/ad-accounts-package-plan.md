# Advertising Accounts Package — Audit + Detailed Plan (AD1–AD6)

**অনুমোদন:** মালিক, ২০২৬-১০-১১ ১৬:৩০ +06 ("এই কাজ শেষ হলে তুমি একটা details plan করবা 'Advertising Accounts'-এর জন্য আর কাজ start করো") — Automations প্যাকেজের auto-approve ধারাতেই: plan → ধাপে ধাপে execution, permission ছাড়া। GitHub push শুধু মালিকের স্পষ্ট নির্দেশে (এই প্যাকেজে কোনো push হবে না)।
**স্কোপ:** শুধু **Ad Account management layer** — connect / health / sync visibility / settings / governance। Campaign/ad feature roadmap (Meta publish, CAPI, audiences, catalogs, Google/TikTok publish, rules engine, portfolio) ইতিমধ্যে সম্পূর্ণ — এগুলো re-plan করা হচ্ছে না।

---

## PART 0 — যা ইতিমধ্যে আছে (audit-প্রমাণিত, আবার বানানো হবে না)

| ক্ষেত্র | প্রমাণ |
|---|---|
| Connect = token paste + **verify-before-save**, তিন প্ল্যাটফর্মেই | `ads.service.ts`: connectMeta (verifyToken → listAdAccounts), connectGoogle (verifyCustomer), connectTikTok (verifyAdvertiser); যাচাই ব্যর্থ হলে কিছুই সেভ হয় না |
| Meta এক token-এ **একাধিক account** discovery + connect | `MetaClient.listAdAccounts()` pagination-সহ পুরো তালিকা আনে; connectMeta সবগুলো upsert করে; DTO-তে `adAccountExternalIds` filter আছে |
| Credential সংরক্ষণ | `IntegrationCredential.encryptedData` — AES-256-GCM (`integrations/crypto.ts`); plaintext কখনো DB/API-তে নয়; `IntegrationsService.toPublicIntegration` credential ছাঁটাই করে |
| Integration health-এর **কাঁচা তথ্য** আছে | `Integration` model: `status` (CONNECTED/DISCONNECTED/ERROR), `lastSyncAt`, `lastError` — syncMetaInsights/Google/TikTok ব্যর্থ হলে ERROR + lastError লেখে, সফল হলে lastSyncAt ছাপে |
| Scheduled insights sync | Automation job types `meta_insights` / `google_insights` / `tiktok_insights` (targetId = account), `meta_status_sync` (published campaign status); manual sync button প্রতিটি account card-এ |
| Audit trail (আংশিক) | connect, sync, manual entry, CSV import — সবই `AuditService.log` দিয়ে লেখা হয় |
| Permissions | `@PermissionArea("ads")`; connect শুধু OWNER/ADMIN; sync/manual/csv OWNER/ADMIN/MARKETING_MANAGER (ads.controller.ts) |
| Account-স্তরের ডেটা | Org-স্তরে pacing (মাসিক budget projection) ও agency portfolio (cross-org rollup) আছে — কিন্তু দুটোই org-স্তরের, account-স্তরের নয় |
| Disconnect-এর যন্ত্র আছে | `IntegrationsService.disconnect` (credential মুছে DISCONNECTED + audit) — কিন্তু সেটি Integrations পেজ-কেন্দ্রিক; Ad Accounts পেজে এর কোনো অস্তিত্ব নেই |

## PART 1 — Audit findings: ফাঁকগুলো (file evidence-সহ)

### F1. Token মরে গেলে কেউ জানে না — health তথ্য থাকলেও কোথাও দেখা যায় না 🔴
`listAccounts` শুধু কাঁচা `AdAccount` row ফেরত দেয় — Integration-এর status/lastSyncAt/lastError **join করাই হয় না**। Ad Accounts পেজের card-এ শুধু নাম/platform/sourceType/externalId/currency — last sync কবে, শেষ error কী, token জীবিত কিনা — কিছুই নেই। ফলে token expire হলে (Meta user token-এর এটাই স্বাভাবিক পরিণতি) scheduled job নীরবে ব্যর্থ হতে থাকে, tenant টের পায় না। আরও: `syncMetaAdInsights` ও `syncMetaBreakdowns` ব্যর্থ হলে integration-এ **ERROR/lastError লেখেই না**, সফল হলেও lastSyncAt ছাপে না — ওই দুই sync-এর health চিহ্নই নেই। কোনো notification-ও নেই (A3-তে jobs-এর জন্য `job_dead_letter` ধাঁচের সতর্কতা আছে, ad account-এর জন্য কিছুই নয়)।

### F2. Disconnect / Reconnect lifecycle ভাঙা 🔴
- Ad Accounts-এ **disconnect endpoint-ই নেই**। Integrations পেজ থেকে generic disconnect করা গেলেও AdAccount.integrationId ঝুলে থাকে — card-এ sync button দেখায়, sync গেলে "credentials are missing; reconnect" error, কিন্তু পেজে reconnect-এর কোনো নির্দেশনা/বোতাম নেই।
- **Reconnect = নতুন Integration row।** connectMeta/connectGoogle/connectTikTok প্রতিবার নতুন Integration + নতুন credential তৈরি করে; পুরনোটি **চিরকাল CONNECTED অবস্থায় পড়ে থাকে** (ভুয়া health), credential-ও মুছে না। বারবার reconnect করলে CONNECTED integration জমতে থাকে।

### F3. Meta account_status আনা হয়, ফেলে দেওয়া হয় 🟠
`MetaClient.listAdAccounts` fields-এ `account_status` চায় এবং parse-ও করে, কিন্তু `connectMeta` শুধু name/currency নেয় — status কোথাও সংরক্ষিত হয় না। AdAccount.status (default "ACTIVE") কোনো কোড কখনো লেখে/পড়ে না। অর্থাৎ **Meta কোনো account disabled/restricted করলে tenant জানতেই পারে না**; spend ডেটা আসা বন্ধ হয়ে যাবে, কারণ অদৃশ্য। Google customer resource-এর status/timeZone, TikTok advertiser status-ও একইভাবে কখনো চাওয়াই হয় না। Currency platform থেকে আসে, **timezone কোথাও নেই**।

### F4. Account-স্তরে spend নজরদারি শূন্য 🟠
Pacing org-স্তরের এবং budget query-param (সংরক্ষিত নয়)। Account-প্রতি: আজকের খরচ, মাসের মোট, অস্বাভাবিক খরচের (যেমন দৈনিক গড়ের দ্বিগুণ) সতর্কতা, spend-cap alert — কিছুই নেই। Ads rules engine campaign-স্তরে কাজ করে; account পুরোপুরি disabled হয়ে গেলে বা খরচ অস্বাভাবিক বাড়লে তা ধরার কেউ নেই।

### F5. Meta connect-এ account বেছে নেওয়ার UI নেই 🟡
API `adAccountExternalIds` filter সমর্থন করে, কিন্তু web ফর্ম শুধু token নেয় — token-এর অধীনের **সব** account চুপচাপ connect হয়ে যায় (অন্য client-এর/অপ্রয়োজনীয় account-সহ)। কোন account নেওয়া হবে তা বেছে নেওয়ার ধাপ নেই; disabled account-ও একইভাবে ঢুকে যায়।

### F6. Per-account enable/disable ও multi-account পরিচালনা নেই 🟡
কোনো account সাময়িক বন্ধ রাখার উপায় নেই — হয় পুরো integration disconnect (shared Meta token হলে সব account একসাথে মরে), নয়তো চলতেই থাকে। Bulk sync (সব account এক ক্লিকে), account search/filter, label — কিছুই নেই। Portfolio cross-org rollup; একই org-এর ভেতরে account-ভিত্তিক তুলনা Ad Accounts পেজে নেই (Analytics-এ campaign-স্তরে আছে)।

### ইচ্ছাকৃতভাবে বানানো হচ্ছে না (প্রমাণসহ)
- **OAuth connect flow** — platform app review/advanced access মালিকের M30 live-verification ধাপ; token paste + verify-before-save-ই designed পথ। OAuth বোতাম বানিয়ে ভুয়া প্রতিশ্রুতি দেওয়া হবে না।
- **Per-member/team account restriction** — M72 `ads` permission area + role gate ইতিমধ্যে mutation নিয়ন্ত্রণ করে; account-ভিত্তিক ACL-এর চাহিদার কোনো প্রমাণ নেই।
- **Wallet / Managed ad accounts** — মালিকের সিদ্ধান্তে স্থগিত (policy/legal); এই প্যাকেজের বাইরে।
- **Pacing/portfolio পুনর্নির্মাণ** — আছে ও কাজ করে; AD4 শুধু account-স্তর যোগ করবে।

---

## PART 2 — প্যাকেজ (৩ batch, প্রতিটিতে ২টি item)

### Batch 1
#### AD1 — Account Connection Health & Sync Visibility
**স্কোপ:**
- `listAccounts` response-এ প্রতি account-এর `connection` block: `{ integrationId, status, lastSyncAt, lastError, connectedAt }` + server-computed `health` band: `connected` | `error` (status ERROR) | `stale` (CONNECTED কিন্তু api account-এর lastSyncAt নেই অথবা >48h পুরনো) | `disconnected` (sourceType api কিন্তু integration নেই/DISCONNECTED) | `manual` (csv/manual account — API সংযোগ নেই, এটাই স্বাভাবিক)। **কোনো credential-সংক্রান্ত ক্ষেত্র কখনোই response-এ নয়** (serializer test দিয়ে প্রমাণ হবে)।
- **সব sync পথে একই health লেখা:** Meta ad-insights ও breakdowns sync-ও এখন থেকে ব্যর্থ হলে integration ERROR + lastError লিখবে, সফল হলে CONNECTED + lastSyncAt + lastError=null (আজ শুধু campaign-insights/Google/TikTok করে)। একটি shared helper দিয়ে — প্রতিটি sync নিজে নিজে নয়।
- **ব্যর্থতার notification:** sync ব্যর্থতায় integration CONNECTED→ERROR transition হলেই ACTIVE OWNER/ADMIN-দের AgentNotification (type `ad_account_sync_failed`, শিরোনামে account নাম + platform, body-তে platform-এর error হুবহু excerpt) — integration-প্রতি Dhaka দিনে সর্বোচ্চ একবার (AuditLog marker, A3-র `notifyDeadLettered` ধাঁচ হুবহু), সম্পূর্ণ failure-isolated।
- **Web:** account card-এ health badge (রঙ + বাংলা লেবেল), "শেষ Sync: …" সময়, lastError থাকলে হুবহু দেখানো, health `error`/`disconnected` হলে **"পুনরায় কানেক্ট করুন"** বোতাম যা সংশ্লিষ্ট platform-এর connect ফর্মে scroll করে ফোকাস দেয়।
**Acceptance:** (ক) health band-এর derivation matrix spec (status × lastSyncAt × sourceType-এর সব সমন্বয়); (খ) চারটি Meta/Google/TikTok sync পথেই success/failure-এ একই লেখা — spec; (গ) notification: transition-এই শুধু একবার, একই দিনে দ্বিতীয় ব্যর্থতায় নয়, পরের দিন আবার হতে পারে — spec; (ঘ) response-এ credential/encryptedData/token শব্দযুক্ত কোনো key নেই — spec; (ঙ) live: sandbox-এ ভুয়া token-এ connect = verify boundary-তে 400 (আগের আচরণ অপরিবর্তিত), manual account তৈরি → health `manual`, api-চিহ্নিত account integration ছাড়া → `disconnected`।

#### AD2 — Disconnect & Reconnect Lifecycle
**স্কোপ:**
- `POST organizations/:id/ad-accounts/:accountId/disconnect` (OWNER/ADMIN): account detach। Integration শুধু এই account-এর হলে `IntegrationsService.disconnect`-এর semantics (credential delete + DISCONNECTED + audit) পুনঃব্যবহার; **shared হলে** (Meta-এর এক token-এ একাধিক account) শুধু এই account-এর `integrationId = null` — shared credential অন্য account-এর জন্য জীবিত থাকে। Account row, campaigns, metrics — **সব ডেটা থাকে**; `AdAccount.status = "DISCONNECTED"`; audit `ad_account.disconnect` (metadata-তে shared ছিল কিনা)।
- **Reconnect hygiene (তিন platform-এর connect-এই):** নতুন connect সফল হলে ওই platform identity-র (Meta: token-এর user id; Google/TikTok: account external id) আগের CONNECTED integration-গুলো DISCONNECTED চিহ্নিত হবে এবং তাদের credential মুছে যাবে — **accounts নতুন integration-এ repoint হওয়ার পরেই**, কোনো মুহূর্তে account credential-ছাড়া থাকবে না। ফলে CONNECTED duplicate আর জমবে না।
- Disconnect করা account পুনরায় connect করলে একই AdAccount row-ই ফিরে আসে (unique key upsert — বিদ্যমান আচরণ), status আবার "ACTIVE"।
- **Web:** card-এ "সংযোগ বিচ্ছিন্ন করুন" বোতাম (শুধু api-connected account-এ) — confirm-এ পরিণতি বাংলায় স্পষ্ট: "ডেটা থেকে যাবে, Sync ও Publish বন্ধ হয়ে যাবে"। Shared token হলে confirm-লেখায় তা-ও বলা থাকবে ("শুধু এই Accountটি বিচ্ছিন্ন হবে, একই Token-এর অন্য Account চলবে")।
**Acceptance:** (ক) একক-account disconnect-এ credential সত্যিই মুছে গেছে (DB যাচাই) + integration DISCONNECTED + audit row — spec; (খ) shared disconnect-এ অন্য account-এর sync তখনো কাজ করে (service spec-এ credential অক্ষত প্রমাণ); (গ) reconnect-এর পর পুরনো integration DISCONNECTED + credential নেই, নতুনটি CONNECTED, ঠিক একটি CONNECTED integration ওই identity-র জন্য — spec; (ঘ) disconnect-এর পর sync ডাকলে সৎ error ("not connected"), 500 নয় — spec; (ঙ) csv/manual account-এ disconnect ডাকলে 400 (বিচ্ছিন্ন করার মতো সংযোগ নেই)।

### Batch 2
#### AD3 — Platform Account Status ও Timezone Sync
- নতুন migration: `AdAccount.platformStatus String?`, `platformStatusAt DateTime?`, `timezone String?`।
- Refresh পথ: connect-সময় Meta account_status সংরক্ষণ (যেটি আজ ফেলে দেওয়া হয়) + `POST ad-accounts/:accountId/refresh-status` (Meta: stored token দিয়ে পুনরায় listAdAccounts মিলিয়ে; Google: customer resource — status + timeZone ক্ষেত্র চেয়ে; TikTok: advertiser/info — status ক্ষেত্র চেয়ে)। Platform যা ফেরত দেয় হুবহু তা-ই সংরক্ষণ; না দিলে null (অনুমান নয়)।
- Platform status disabled/restricted শ্রেণির হলে card-এ লাল সতর্কতা + প্রথম transition-এ AD1-এর ধাঁচের notification (type `ad_account_platform_status`)।
- Timezone পেজে দেখানো (currency-র পাশে); পরবর্তী sync-গুলোর date-window ব্যাখ্যায় ব্যবহৃত হবে বলে doc-এ নোট (আচরণ বদল নয়, এই item-এ শুধু সংরক্ষণ + প্রদর্শন)।

#### AD4 — Account-Level Spend Watchdog
- Migration: `AdAccount.dailySpendAlertMinor BigInt?`, `monthlySpendCapMinor BigInt?`, settings PATCH endpoint (OWNER/ADMIN) + card-এ সম্পাদনা।
- নতুন automation job type `ad_spend_watchdog` (org target, A4 gallery template-সহ): প্রতিটি account-এর জন্য DailyAdMetric-এর campaign-level row থেকে আজকের খরচ বনাম আগের ৭টি সম্পূর্ণ দিনের গড় — আজ > 2× গড় **এবং** > dailySpendAlertMinor (সেট থাকলে) হলে `ad_spend_anomaly` notification (account-প্রতি দিনে একবার)। মাসের মোট monthlySpendCapMinor ছুঁলে/পেরোলে `ad_spend_cap` notification (account-প্রতি মাসে একবার, AuditLog marker)। কোনো threshold সেট না থাকলে watchdog ওই account-এ নীরব (ডিফল্টে শব্দ নয়)।
- Card-এ আজকের খরচ + মাসের মোট (account-এর নিজের currency-তে; account জু
...[truncated 2820 chars]
---

## পরিশিষ্ট (২০২৬-১০-১১, Batch 3 শেষে যোগ করা)

এই নথির মূল ফাইলে AD5/AD6 অংশ লেখার সময় ছিন্ন হয়ে গিয়েছিল (AD4-এর মাঝামাঝি শেষ)। AD5 ও AD6 Batch 3-এর brief অনুযায়ী বাস্তবায়িত হয়েছে; যা বানানো হয়েছে তার প্রামাণ্য বিবরণ acceptance doc দুটিতে:

- **AD5 — Meta Discover → Picker + Per-Account Sync Disable:** `docs/ad-accounts-ad5-acceptance.md` (commit `791ef72`; migration `20261010890000_ad5_sync_disabled`)
- **AD6 — Bulk Sync-All + Account Label/Search/Filter:** `docs/ad-accounts-ad6-acceptance.md` (commit `3876f35`; migration `20261010900000_ad6_account_label`)

এর ফলে পুরো প্যাকেজ AD1–AD6 সম্পূর্ণ।
