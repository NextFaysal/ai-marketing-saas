# E-Commerce Batch B1 (EC1 + EC2) — Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-package` (base master `4b283d5`) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Full-System-Plan-2026-10-12.md` §২ (৫টি আর্কিটেকচার সিদ্ধান্ত), §৩, §৪ EC1/EC2, §৫ গেট, §৮ নিরাপত্তা।

---

## যা তৈরি হয়েছে

### EC1 — Sync Foundation

1. **Prisma (মাইগ্রেশন `20261013000000_ec1_sync_foundation`):**
   - `StoreListing` — canonical Product ↔ এক স্টোরে তার রূপ: `externalId`, `externalVariantMap` (Json), `publishState` (default `published`), `channelPriceMinor` (BigInt?), `channelStock`, `lastPushedHash`, `lastRemoteHash` (অতিরিক্ত — inbound hash তুলনার জন্য), `lastRemoteUpdatedAt`, `syncStatus` (synced|pending|failed|conflict), `lastSyncError`; unique `[storeId, productId]`, org/status index।
   - `SyncOutbox` — `entityType/entityId/operation/payload/payloadHash`, `idempotencyKey` (unique), `status` (pending|processing|done|failed|dead), `attempts`, `nextRetryAt`, `lastError`, `responseSummary`।
   - `SyncConflict` — `listingId/field/localValue/remoteValue/status/resolution`। B1-এ মডেল + list endpoint শুধু; তৈরি/নিষ্পত্তি EC3-তে।
   - `Store.syncMode` (default `"mirror"`) + `Store.fieldOwnership` (Json?)।
2. **SyncOutboxService** (`apps/api/src/commerce/sync-outbox.service.ts`): enqueue (idempotency-key dedupe — একই key-তে দ্বিতীয় enqueue বিদ্যমান row-ই ফেরত দেয়), processDue (due = pending অথবা nextRetryAt পেরোনো failed; **per-store cap 20/run** — সরল rate discipline; attempts++, exponential backoff `min(3600, 30·2^(attempts-1))` সেকেন্ড, ৫ attempts-এ dead), replay (failed/dead ছাড়া BadRequest, অন্য org-তে NotFound)। Adapter যেটা implement করেনি তা **failed + verbatim `capability_not_implemented`** — `nextRetryAt: null`, অর্থাৎ নিজে থেকে আর চেষ্টা হবে না; কখনো done নয়।
   - Automations job surface-এ যুক্ত: JOB_TYPES-এ `sync_outbox`, টেমপ্লেট `sync_outbox_process` (org, ৫ মিনিট), executeJob case `processDueForOrg` — per-org Automations schedule-এ চালানো যাবে।
3. **CommerceAdapter** (`apps/api/src/integrations/commerce/`): `adapter.ts` (interface + capability contract), `adapters.ts` — Woo/Shopify adapter শুধু `register_webhooks` implement করে (credential থেকে decrypt করে আসল client দিয়ে), বাকি সব write capability **false**; NativeAdapter B1-এ সব write false। `CommerceAdapterRegistry` + `platformKeyForStore`। Test-adapter (শুধু spec ফাইলে সংজ্ঞায়িত) দিয়ে enqueue→process→done পূর্ণ চক্র প্রমাণিত।
4. **Inbound listing wiring:** `IntegrationsService.upsertProduct`-এর call site গুলো (Woo sync + Woo webhook + Shopify sync/webhook — শেষ দুটি shared `wireProductListing` helper দিয়ে) এবং `upsertOrder` (resolved item অনুযায়ী `touchForOrderItem`) এখন StoreListing upsert করে — `@Optional() ListingsService` + try/catch failure-isolated: listing লেখা ব্যর্থ হলে sync কখনো ভাঙে না (শুধু warn log)।
5. **Sync Center API** (`apps/api/src/commerce/`, `@PermissionArea("integrations")`, TenantGuard+RolesGuard): `GET commerce/outbox` (store/status filter + pagination), `GET commerce/listings` (status summary + list, product/store include), `GET commerce/conflicts`, `POST commerce/outbox/:id/replay` (OWNER/ADMIN/MARKETING_MANAGER), `PATCH commerce/stores/:storeId/sync-mode` (OWNER/ADMIN, mode validation, audit `store.sync_mode` {from,to})।
6. **Web Sync Center** (`/dashboard/commerce/sync`): store selector, sync-mode control (তিন মোডের বাংলা ব্যাখ্যাসহ), listing summary cards + table, outbox table (verbatim lastError, শুধু failed/dead-এ replay বোতাম), status filter + pagination, conflicts section — লোড ব্যর্থ হলে "কোনো conflict নেই" **দেখানো হয় না**, এরর banner আসে। Integrations পেজ থেকে লিঙ্ক।
7. **Backfill script** (`scripts/backfill-store-listings.ts`, dry-run default, `--apply`): source woocommerce/shopify + externalId আছে এমন প্রোডাক্টের জন্য listing তৈরি — **শুধুমাত্র** org-তে ওই প্ল্যাটফর্মের ঠিক একটি স্টোর থাকলে; একাধিক থাকলে `ambiguous_stores` হিসেবে skip + গণনা (কখনো অনুমান নয়), স্টোর না থাকলে `no_store`, externalId না থাকলে `not_synced`। `--apply`-তে বিদ্যমান listing overwrite হয় না (`update: {}`)। Pure planner (`backfill-plan.ts`) spec-প্রমাণিত।

### EC2 — Connection v2 & Store Health

1. **WooClient:** `put()`/`delete()` (বিদ্যমান WooApiError verbatim discipline), `listWebhooks/createWebhook/deleteWebhook`। Connect ফ্লোতে **auto webhook registration** (`woocommerce/woo-webhooks.ts`: ৫টি topic — product created/updated/deleted, order created/updated; আগে থেকে থাকলে `exists`, duplicate তৈরি নয়; per-topic ফলাফল verbatim)। Webhook secret: dto → আগের সংরক্ষিত → SaaS-generated (`randomBytes`), credential-এ সংরক্ষিত। Public base URL = env `API_PUBLIC_URL`; **না থাকলে registration `skipped_no_public_url`** — connect সফল হয়, কিন্তু registered বলে দাবি করা হয় না। ফলাফল `Integration.webhookStatus` (Json)-এ রেকর্ড। `POST integrations/:id/repair-webhooks` দুই প্ল্যাটফর্মেই পুনরায় চালায়।
2. **Store health** (`GET integrations/:id/health`, `StoreHealthService`): প্রতিটি check `pass|warn|fail|unknown` + আসল call থেকে evidence। Woo: connection test, system_status থেকে WP/WC version (শুধু যে ফিল্ড আসলে আছে), store URL HTTPS, আমাদের ঠিকানায় webhook আছে কিনা (listWebhooks মিলিয়ে), শেষ sync freshness, এবং **key write-permission সর্বদা `unknown`** — evidence-এ স্পষ্ট লেখা যে write চেষ্টা ছাড়া এটি প্রমাণ করা যায় না। Shopify: GraphQL shop probe, scopes (নিচে), webhook topics উপস্থিতি, token ধরন/মেয়াদ। Overall = worst check।
3. **Shopify GraphQL client** (`shopify/shopify-graphql.client.ts`): `POST /admin/api/{version}/graphql.json`, version = `SHOPIFY_API_VERSION` ?? `"2025-10"`, `X-Shopify-Access-Token`; GraphQL errors verbatim throw (`ShopifyGraphQLError`); `shopProbe()`, `accessScopes()` (`currentAppInstallation`), `webhookTopics()`।
4. **Shopify client-credentials connect:** DTO variant `{storeId, clientId, clientSecret}` → `POST https://{shop}/admin/oauth/access_token` (`grant_type=client_credentials`, form-urlencoded) → **সেভের আগে** GraphQL shop probe; যেকোনো ধাপ ব্যর্থ হলে কিছুই সেভ হয় না, verbatim error। সেভ: token encrypted (বিদ্যমান credential পথ), `Integration.authType = "client_credentials"`, `tokenExpiresAt`। **Refresh:** client তৈরির সময় মেয়াদ শেষ/৫ মিনিটের মধ্যে হলে পুনরায় exchange করে credential + expiry আপডেট; exchange ব্যর্থ হলে verbatim BadRequest (মৃত টোকেন চুপচাপ ব্যবহার নয়)। Legacy `shpat_` পথ অপরিবর্তিত। `expires_in` না এলে `tokenExpiresAt = null` এবং টোকেনটিকে non-expiring ধরা হয় (কোডে documented)।
5. **Shopify webhook subscriptions:** connect ও repair-এ, GraphQL ব্যবহারযোগ্য হলে ১১টি topic-এর subscription (`shopify/shopify-webhooks.ts`: PRODUCTS_CREATE/UPDATE/DELETE, ORDERS_CREATE/UPDATED, INVENTORY_LEVELS_UPDATE, FULFILLMENTS_CREATE, REFUNDS_CREATE, CUSTOMERS_CREATE/UPDATE, APP_UNINSTALLED), callback = বিদ্যমান Shopify webhook controller পথ; per-topic ফলাফল `webhookStatus`-এ। GraphQL ব্যবহারযোগ্য না হলে status **`manual_required`** + verbatim error — fake success নয়। `API_PUBLIC_URL` না থাকলে `skipped_no_public_url`।
6. **GDPR endpoints:** `POST webhooks/shopify/gdpr/customers-data-request | customers-redact | shop-redact` — বিদ্যমান HMAC verification (প্রার্থী integration গুলোর apiSecret দিয়ে; `SHOPIFY_APP_SECRET` env থাকলে shop_domain-মিলে যাওয়া প্রার্থী আগে) + WebhookEvent dedupe (delivery id) দিয়ে রেকর্ড। `customers/*` = record + audit মাত্র। `shop/redact` = এছাড়া integration `DISCONNECTED`। Dispatcher-এর বদলে inline (controller-এ কারণসহ comment)।
7. **Shopify health scopes:** granted বনাম EC ফিচারের প্রয়োজনীয় তালিকা (read/write products, inventory, orders, customers, discounts) — **missing scope নাম ধরে** evidence-এ।
8. **Web integrations v2:** প্রতি স্টোরে health কার্ড (worst status + check বিবরণ), sync-mode badge, authType badge (Client Credentials / Legacy Token), webhookStatus থাকলে তার status লাইন (না থাকলে কিছুই দাবি করা হয় না), "Webhooks মেরামত" বোতাম (ফলাফল verbatim notice), Shopify ফর্মে Client Credentials বিকল্প (টোকেন ফর্মের পাশাপাশি)।

## গেট (সব সবুজ)

| গেট | ফলাফল |
|---|---|
| Prisma validate | ✅ valid (schema) |
| API jest (full) | ✅ **221 suites, 1960/1960** + পরে যোগ করা EC DI spec **1/1** (মোট 222 suites / 1961 tests final tree-তে) |
| API tsc | ✅ 0 errors |
| Web vitest | ✅ 20 files, **140/140** |
| Web tsc | ✅ 0 errors |
| Production build (`pnpm build`, সব প্যাকেজ + next build) | ✅ green |
| DI graph spec (`commerce/ec-di.spec.ts`) | ✅ আসল Nest graph-এ ListingsService → IntegrationsService injection, SyncOutboxService/CommerceService/StoreHealthService/registry resolution প্রমাণিত (M65 শিক্ষা) |

নতুন B1 spec গুলো: sync-outbox (test-adapter cycle, dedupe, capability path, backoff→dead, replay, tenant isolation, per-store cap), listings + content-hash, backfill-plan, woo.client (put/delete/webhooks), shopify-graphql, shopify-webhooks, shopify-auth, ec2-connection (Woo skipped-registration + generated secret; Shopify CC connect + failed-probe-saves-nothing; refresh; GDPR HMAC/dedupe/DISCONNECTED), health (write-permission unknown, missing scopes named), ec-di।

## মাইগ্রেশন ও deploy নোট

- `20261013000000_ec1_sync_foundation`, `20261013010000_ec2_connection_v2` — **কোনো আসল DB-তে চালানো হয়নি**; deploy-এর সময় `prisma migrate deploy` দিয়ে চালাতেই হবে, নইলে Sync Center / health / webhookStatus endpoint গুলো 500 দেবে।
- `Integration.webhookStatus/authType/tokenExpiresAt` রাখার সিদ্ধান্ত: registration ফলাফলের জন্য আলাদা টেবিল নয়, integration row-তেই Json রেকর্ড (উপরে বর্ণিত) — কারণ এটি প্রতি integration-এ একটিই সর্বশেষ অবস্থা।
- Production-এ auto webhook registration কাজ করতে **`API_PUBLIC_URL`** env সেট থাকতে হবে (Dokploy)।
- Backfill: deploy-এর পর `scripts/backfill-store-listings.ts` (আগে dry-run, তারপর `--apply`)।

## সৎ সীমা ও বিচ্যুতি

- **কোনো live Woo/Shopify স্টোরে প্রমাণ হয়নি** — সবকিছু fixture/stub-fetch/spec-প্রমাণিত। Live verification EC12/M30-তে মালিকের আসল স্টোর দিয়ে হবে।
- প্ল্যানের EC2-তে থাকা **Woo 1-click `wc-auth` authorization ফ্লো B1-এর কাজের তালিকায় ছিল না** — করা হয়নি; key-paste পথই আছে (auto webhook registration সহ)। পরের ব্যাচে তোলা যাবে।
- প্ল্যান §২-তে `StoreListingVariant` আলাদা মডেলের কথা ছিল; B1 brief অনুযায়ী variant mapping `StoreListing.externalVariantMap` (Json)-এ রাখা হয়েছে — আলাদা মডেল EC3-তে প্রয়োজন হলে আসবে।
- GDPR: WebhookEvent-এর FK-এর কারণে event শুধুমাত্র **মিলে যাওয়া integration-এর বিপরীতেই** রেকর্ড করা যায়; কোনো secret-ই verify না হলে 403। গভীর data-erasure automation (কাস্টমারের সব ডেটা মোছা) future work — এখন record + audit + (shop/redact-এ) disconnect।
- SyncOutbox-এর rate discipline সরল: প্রতি processDue রানে per-store cap 20। Shopify GraphQL cost-bucket ভিত্তিক throttle EC3-র write-back-এর সময় আসবে।
- Oversell/conflict: B1-এ conflict শুধু মডেল + তালিকা; conflict **তৈরি** হওয়ার logic EC3-তে।
- Woo health-এ key write-permission প্রমাণযোগ্যভাবে `unknown` রাখা হয়েছে (উপরে)।
