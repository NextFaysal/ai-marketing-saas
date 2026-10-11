# AD1 — Account Connection Health & Sync Visibility — Acceptance

**প্যাকেজ:** Advertising Accounts (plan: `docs/ad-accounts-package-plan.md`) · **তারিখ:** ২০২৬-১০-১১
**স্কোপ যা বাস্তবায়িত:** accounts list-এ connection block + health band, সব sync পথে একই health লেখা, sync-ব্যর্থতার deduped notification, web card-এ health প্রদর্শন + reconnect prompt।

## API পরিবর্তন

`GET organizations/:id/ad-accounts` — প্রতি account-এ এখন অতিরিক্ত:

- `connection`: integration থাকলে `{ integrationId, status, lastSyncAt, lastError, connectedAt }` (connectedAt = integration-এর createdAt); integration না থাকলে `null`। Integration query শুধু এই ক্ষেত্রগুলো `select` করে — credential relation কখনো include হয় না, আর connection ক্ষেত্র ধরে ধরে বানানো (spread নয়)।
- `health` (server-computed):

| শর্ত | health |
|---|---|
| integrationId নেই, sourceType ≠ api (manual/csv) | `manual` |
| integrationId নেই, sourceType = api | `disconnected` |
| integrationId আছে কিন্তু row পাওয়া যায়নি | `disconnected` |
| integration.status = ERROR | `error` |
| integration.status = DISCONNECTED | `disconnected` |
| status = CONNECTED, lastSyncAt null বা 48 ঘণ্টার বেশি পুরনো | `stale` |
| status = CONNECTED, lastSyncAt ≤ 48h | `connected` |

## Sync health লেখা (uniform)

`markSyncSuccess` / `markSyncFailure` helper দিয়ে **পাঁচটি** sync পথই এখন একইভাবে লেখে — Meta campaign-insights, Meta ad-insights, Meta breakdowns, Google insights, TikTok insights:
- সফল → `status=CONNECTED, lastSyncAt=now, lastError=null`
- ব্যর্থ → `status=ERROR, lastError=<platform-এর নিজের message>`; তারপর আগের মতোই একই BadRequestException (platform message-সহ) throw হয়।
আগে ad-insights ও breakdowns sync **কিছুই লিখত না** — সেই ফাঁকটাই এই item বন্ধ করেছে।

## ব্যর্থতার notification

- Sync ব্যর্থতায় integration আগের status ERROR না হলে (আসল CONNECTED→ERROR transition) ACTIVE OWNER/ADMIN সদস্যদের `AgentNotification` — type `ad_account_sync_failed`, শিরোনামে account নাম + platform, body-তে platform error-এর ≤200-অক্ষরের excerpt + "পুনরায় কানেক্ট করুন" নির্দেশনা।
- **Dedupe:** integration-প্রতি Asia/Dhaka দিনে সর্বোচ্চ একবার — AuditLog marker `ad_account.sync_failed_notified` (entityType `Integration`)। একই দিনে পরের ব্যর্থতা নীরব; পরের দিন আবার জানানো যাবে।
- সম্পূর্ণ **failure-isolated**: notification-এর কোনো ব্যর্থতা sync-এর ফলাফল বদলায় না (spec-এ notification store throw করলেও মূল sync error-ই আসে বলে প্রমাণিত)। ধাঁচ: Automations A3-র `notifyDeadLettered` হুবহু; `dhakaDayStartUtc` CRM থেকে import (copy নয়)।
- AdsService constructor অপরিবর্তিত `(prisma, audit)` — positional spec constructions ভাঙেনি।

## Web (Ad Accounts পেজ)

- প্রতি card-এ health badge: সংযুক্ত (সবুজ) / Sync পুরনো (amber) / Sync ব্যর্থ (লাল) / বিচ্ছিন্ন (slate+লাল) / ম্যানুয়াল (API নেই)।
- `connection.lastSyncAt` থাকলে "শেষ Sync: <bn-BD তারিখ>", `lastError` থাকলে হুবহু লাল লেখায়।
- health `error`/`disconnected` + sourceType `api` হলে **"পুনরায় কানেক্ট করুন"** বোতাম — সংশ্লিষ্ট platform-এর connect ফর্মে (`id="connect-meta|google|tiktok"`) smooth scroll + সাময়িক highlight + প্রথম input-এ focus।

## নিরাপত্তা

Serializer spec প্রমাণ করে: list response-এর কোথাও (recursively) `encryptedData` / `credential` / `accessToken` / `token` জাতীয় কোনো key নেই। Credential আগের মতোই শুধু encrypted আকারে IntegrationCredential-এ থাকে; এই item কোনো নতুন credential পথ খোলেনি।

## Evidence

- **Spec (নতুন `apps/api/src/ads/ad1-account-health.spec.ts`, 12 test):** health matrix-এর প্রতিটি সমন্বয়; serializer key-scan; Meta ad-insights ও breakdowns-এ ব্যর্থতা রেকর্ড + সফলতায় CONNECTED/lastSyncAt (MetaClient.prototype stub — AdsService নিজে client বানায়, fetch inject-এর পথ নেই); notification: transition-এই শুধু, ACTIVE OWNER/ADMIN-ই শুধু, একই দিনে দ্বিতীয়বার নয়, marker-থাকা অবস্থায় নয়, notification ব্যর্থ হলেও sync error অপরিবর্তিত; tenant isolation।
- **Gates:** ads suites 25/25 (5 suites); **full API 1058/1058 (143 suites)**; `pnpm -r build` green (web ad-accounts পেজ-সহ)।
- **Live HTTP: এই session-এ সম্ভব হয়নি — সৎ সীমা।** যাচাইয়ের জন্য sandbox Postgres (127.0.0.1:5432) session চলাকালীন বন্ধ হয়ে যায় (session-এর শুরুতে চালু ছিল; API boot-এ Prisma P1001 "Can't reach database server"; এই filesystem view-তে postgres binary/data নেই যে পুনরায় চালু করা যাবে)। প্রস্তুত live script-এর চেকগুলো ছিল: register→org→ manual account-এ health `manual`, integration-ছাড়া api account-এ `disconnected`, seeded ERROR/stale/fresh/DISCONNECTED integration-এ হুবহু health + lastError, response-এ credential key অনুপস্থিতি, ভুয়া Meta token-এ verify boundary 400 + কিছু persist না হওয়া। এই চেকগুলো চালানো যায়নি; ওপরের spec suite-ই এই item-এর প্রমাণের সিলিং — plan-এর সততার নিয়ম অনুযায়ী এখানে স্পষ্টভাবে লেখা হলো। DB ফিরলে একই script চালিয়ে এই doc হালনাগাদ করা যাবে।

## যা এই item-এ নেই (পরের item-গুলোতে)

Disconnect/reconnect lifecycle = **AD2** · platform account_status সংরক্ষণ = **AD3** · spend watchdog = **AD4** · Meta account picker = **AD5**।
