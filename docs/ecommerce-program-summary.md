# Full E-Commerce System — প্রোগ্রাম সারসংক্ষেপ (EC1–EC12)

**ব্রাঞ্চ:** `ec-package` (base master `4b283d5`) · **অবস্থা:** B1–B6 সব ব্যাচের
কোড সম্পূর্ণ, গেট সবুজ, **লোকাল কমিট পর্যন্ত — GitHub push হয়নি**
(মালিকের push-নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `~/workspace/goals/ai-marketing-saas-platform-build/files/Ecommerce-Full-System-Plan-2026-10-12.md`

> সৎ অবস্থা: পুরো প্রোগ্রাম **fixture/stub-প্রমাণিত**। কোনো আসল WooCommerce/
> Shopify স্টোর বা আসল ডোমেইনে কিছুই যাচাই হয়নি। Live প্রমাণের একমাত্র পথ
> `docs/ecommerce-live-verification-checklist.md` — সেটি সম্পূর্ণ OPEN।

---

## ১. প্যাকেজ → ব্যাচ → কমিট ম্যাপ

| ব্যাচ | প্যাকেজ | কমিট রেঞ্জ | Acceptance |
|---|---|---|---|
| B1 | EC1 Sync Foundation + EC2 Connection v2 | `09407fe`–`4fee197` | docs/ecommerce-b1-acceptance.md |
| B2 | EC3 Catalog Write-Back + EC4 Inventory Multi-Channel | `3b20ab6`–`fe31f2b` | docs/ecommerce-b2-acceptance.md |
| B3 | EC5 Order Control Tower + EC9 Fulfillment/Returns | `08c35f6`–`6f1e1d0` | docs/ecommerce-b3-acceptance.md |
| B4 | EC6 Customers Two-Way + EC7 Discounts + EC10 Abandoned | `34e130f`–`934f932` | docs/ecommerce-b4-acceptance.md |
| B5 | EC8 Native Storefront v2 | `fb0eab9`–`5dca59c` | docs/ecommerce-b5-acceptance.md |
| B6 | EC11 Analytics + AI Ops + EC12 Scale/Hardening + wc-auth leftover | `a21ea92` (wc-auth), `6c53729`, `bcef6c6` (EC11), `6ca4932` (EC12) + এই ডকগুলোর কমিট | docs/ecommerce-b6-acceptance.md |

## ২. কী কী আছে (EC অনুযায়ী)

- **EC1:** StoreListing/SyncOutbox/SyncConflict, sync mode (mirror/co-manage/
  full-manage), CommerceAdapter registry, Sync Center, listings backfill script।
- **EC2:** Woo auto webhook registration + repair, store health endpoint,
  Shopify GraphQL client, client-credentials connect + token refresh,
  webhook subscriptions, GDPR endpoints, scope checklist।
- **EC3:** Catalog write-back (Woo batch/Shopify productSet) + বাধ্যতামূলক
  read-back যাচাই, category/tag/gallery/weight/SEO, bulk edit preview→apply,
  duplicate, conflict queue (keep-local/take-remote), OWNER-only remote delete।
- **EC4:** Absolute-quantity stock push, Shopify location mapping
  (`shopify_location_not_mapped` blocker), bundle/combo decrement, stock-
  divergence সংকেত।
- **EC5:** Order status/fulfillment+tracking/note/refund/draft-order push
  (read-back সহ), Shopify `no_shopify_equivalent` সততা, **refund gate
  `Store.refundPushEnabled` DEFAULT OFF**।
- **EC6:** Customer পূর্ণ সিঙ্ক দুই প্ল্যাটফর্মে, CustomerStoreIdentity,
  explicit push-to-store, merge-এ identity বহন।
- **EC7:** StoreDiscount (+Sync) — Woo coupon/Shopify basic discount code
  push + pull (basic subset), validation math, public checkout-এ কুপন প্রয়োগ,
  campaign code generation।
- **EC8:** Native storefront — public shop/category/product/cart/checkout,
  জেলা-ভিত্তিক shipping zone, custom domain TXT যাচাই + middleware routing,
  native abandoned cart।
- **EC9:** Fulfillment (partial), dispatch pick/pack board, handover manifest,
  invoice/packing slip print, Return/RMA পূর্ণ চক্র (token পেজ, restock
  exactly-once, exchange, notification সততা)।
- **EC10:** Shopify abandoned checkout (webhook + REST backfill), Woo tracker
  health check + বসানোর guide, unified abandoned view + recovery email
  (marker discipline)।
- **EC11:** Per-store analytics (revenue/profit — COGS coverage <100% হলে
  profit null), dead-stock, top-products per store, Commerce Hub
  (`/dashboard/commerce`), AI commerce proposals (approval-gated:
  price/stock/listing publish-unpublish/discount/local-only/product copy —
  LLM না থাকলে copy প্রস্তাব সৎভাবে ব্যর্থ), daily briefing-এ commerce অংশ।
- **EC12:** Woo wc-auth ১-ক্লিক connect, Shopify bulk product sync
  (bulk ব্যর্থ/ timeout হলে REST fallback, job-এ রেকর্ডসহ), Woo webhook
  secret rotation (Shopify-তে app-level বলে সৎ ব্যাখ্যা), disconnect purge
  policy (OWNER-only; business records কখনো মোছে না), এই checklist + summary।

## ৩. সম্পূর্ণ মাইগ্রেশন তালিকা (ক্রমানুসারে, deploy-তে আবশ্যক)

`20261013000000_ec1_sync_foundation`, `20261013010000_ec2_connection_v2`,
`20261013020000_ec3_catalog`, `20261013030000_ec4_inventory`,
`20261013040000_ec5_order_tower`, `20261013050000_ec9_fulfillment_returns`,
`20261013060000_ec6_customer_identity`, `20261013070000_ec7_discounts`,
`20261013080000_ec10_abandoned_store_checkout`, `20261013090000_ec8_storefront`,
`20261013100000_ec12_wc_auth_attempt` — **কোনোটিই কোনো আসল DB-তে চালানো হয়নি।**

## ৪. Operational তালিকা

- **Env:** `API_PUBLIC_URL` (webhook registration + wc-auth-এর জন্য আবশ্যক),
  `API_INTERNAL_URL` (storefront domain middleware), `WEB_PUBLIC_URL` (ঐচ্ছিক,
  wc-auth return_url), `SHOPIFY_API_VERSION` (ঐচ্ছিক), `WC_AUTH_APP_NAME`
  (ঐচ্ছিক), `SHOPIFY_BULK_POLL_MS` / `SHOPIFY_BULK_MAX_POLLS` (ঐচ্ছিক tuning)।
- **Per-org jobs:** `sync_outbox_process` (৫মি), `sale_schedule_sweep` (১৫মি),
  store sync টেমপ্লেটসমূহ (`woo_products`, `woo_orders`, `woo_customers`,
  `shopify_products`, `shopify_orders`, `shopify_customers`)।
- **একবারের কাজ:** listings backfill dry-run → apply
  (`scripts/backfill-store-listings.ts`)।
- **Feature flags:** আলাদা EC flag নেই — নিয়ন্ত্রণ হয় per-store
  `syncMode` + `refundPushEnabled` দিয়ে (নিচে সিদ্ধান্তের অবস্থা দেখুন)।

## ৫. Owner-decision আইটেমের অবস্থা

| আইটেম | অবস্থা |
|---|---|
| Native checkout-এ online payment gateway | **Postponed-ই আছে** (2026-10-11 সিদ্ধান্ত) — EC8 COD + manual advance দিয়েই তৈরি |
| Refund push activation | Capability তৈরি; **default OFF** — মালিক 2026-10-13 নিশ্চিত করেছেন ("default OFF-ই থাক"); প্রতি স্টোরে OWNER টগল |
| Shopify বিতরণ: custom/Dev Dashboard app বনাম App Store public app | **অনিশ্চিত** — প্ল্যানের (ক) custom/Dev Dashboard পথেই তৈরি; public app ট্র্যাক খোলা হয়নি |
| Plan gating (কোন প্ল্যানে multi-store/full-manage) | **অনিশ্চিত** — কোডে কোনো plan gate বসানো হয়নি |
| Default sync mode | বিদ্যমান স্টোর Mirror-তেই; connect-এ mode বদলানো মালিক/অ্যাডমিনের হাতে |

## ৬. Live verification

সম্পূর্ণ OPEN। ধাপে ধাপে নির্দেশনা ও প্রমাণের নিয়ম:
**`docs/ecommerce-live-verification-checklist.md`**।
সেই checklist পূরণ না হওয়া পর্যন্ত এই প্রোগ্রামের কোনো অংশকে
"live-proven" বলা যাবে না (প্ল্যান §১১ সংজ্ঞা অনুযায়ী)।
