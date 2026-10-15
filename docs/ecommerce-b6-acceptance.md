# E-Commerce Batch B6 (EC11 + EC12 + wc-auth leftover) — Acceptance

**ব্রাঞ্চ:** `ec-package` · **Base:** B5 HEAD `5dca59c` · **তারিখ:** 2026-10-13
**কমিটসমূহ:** `a21ea92` (wc-auth), `6c53729` (EC11 analytics + hub),
`bcef6c6` (EC11 AI proposals + briefing), `6ca4932` (EC12 hardening) + docs কমিট।

> সৎ সীমা (পুরো ব্যাচ): সবকিছু **fixture/stub-প্রমাণিত**। কোনো আসল WooCommerce/
> Shopify স্টোর, আসল LLM কী বা আসল ডোমেইনে কিছুই যাচাই হয়নি। Live যাচাইয়ের
> পথ `docs/ecommerce-live-verification-checklist.md` — সম্পূর্ণ OPEN।

---

## Part 1 — Woo wc-auth ১-ক্লিক connect (`a21ea92`)

- Dedicated `WcAuthAttempt` মডেল (migration `20261013100000_ec12_wc_auth_attempt`)
  — SocialOAuthState reuse করা হয়নি, কারণ Woo `user_id` হিসেবে attempt id
  ফেরত পাঠায় এবং এর `state` param নেই; সিদ্ধান্তটি কোডে ডকুমেন্টেড।
- `POST integrations/woocommerce/wc-auth/start` (`API_PUBLIC_URL` ছাড়া সৎ
  অস্বীকৃতি) → Woo authorize URL (scope=read_write, return_url = web
  integrations পেজ; state return_url-এ append হয়, verify হয় না — Woo-র
  আচরণ অনুযায়ী)। Public callback: attempt exists/expired/consumed যাচাই,
  তারপর **একই** `connectWooCommerce` পথ (verify-before-save + encrypted
  credential + auto webhook registration); ব্যর্থতায় attempt failed+reason,
  কিছুই save হয় না।
- Web: Woo কানেক্ট কার্ডে "১-ক্লিকে কানেক্ট" ফর্ম; integrations পেজে
  `?from=wc-auth` হলে mount-এ refetch — CONNECTED দেখায় কেবল আসল integration
  থাকলে।
- Specs: `wc-auth.spec.ts` 8/8 + integrations regression 11/11।

## Part 2a — EC11 analytics + Commerce Hub (`6c53729`)

- `CommerceAnalyticsService`: `GET commerce/analytics/summary` (Hub-এর জন্য
  একত্রিত), `/stores`, `/dead-stock`, `/top-products`।
  - Revenue: `REVENUE_EXCLUDED_STATUSES` reuse; per-store + native bucket
    (storeId=null)। **Profit rule: কোনো sold লাইনের COGS coverage <100% হলে
    profit null + coveragePct** — কখনো fabricated নয়।
  - Dead-stock: `trackInventory && stock>0` + window-তে 0 unit sold;
    lastSoldAt/daysSinceLastSale (null = কখনো বিক্রি হয়নি)।
  - Top-products per store: S6 `salesReport`-এর per-store variant (একই
    status predicate ও unit/revenue সংজ্ঞা); storeId ছাড়া org-wide = S6-র
    নিজের সংখ্যাই।
  - `commerceSignals()` briefing-এর জন্য export — failed sync (24h), open
    conflicts, stock-diverged listings, >48h unfulfilled; সব 0 হলে null।
- Hub `/dashboard/commerce`: per-store health (প্রতি integration-এ live
  call; ব্যর্থ হলে "যাচাই হয়নি"), আজকের (Dhaka) per-store + native বিক্রি,
  sync pending/failed, open conflicts, unfulfilled, low-stock, abandoned
  value — প্রতিটি কার্ড সংশ্লিষ্ট কর্মক্ষম পেজে লিংক করে।
- Specs: analytics 13/13; commerce subset regression 73/73।

## Part 2b — EC11 AI proposals + briefing (`bcef6c6`)

- ৬টি commerce proposal tool (`PROPOSAL_TOOL_CATALOG`, module "commerce",
  roles OWNER/ADMIN/MARKETING_MANAGER): price change, stock adjust,
  listing publish/unpublish, create discount, product copy।
  - **নকশা-সিদ্ধান্ত:** catalog-টি read-only `TOOL_CATALOG`/`ALLOWED_TOOLS`
    থেকে আলাদা রাখা হয়েছে — নইলে read-only planner এগুলোকে "তথ্য সংগ্রহের
    টুল" ভেবে auto-call করত (prompt-injection সীমানা)। Planner কখনো এগুলো
    দেখে না; সনাক্তকরণ হয় chat-এর deterministic pattern থেকে।
  - **Nothing executes before approval.** Approval-এ role floor আবার যাচাই
    (actorRole); execution বিদ্যমান সার্ভিস দিয়েই: ProductsService.update,
    InventoryService.adjust, CommerceService listing actions,
    DiscountsService.create। Per-item verbatim ফলাফল প্রস্তাবে লেখা হয়।
  - Create-discount execution **local-only** (store push নয়) — প্রস্তাবের
    লেখাতেই তা বলা আছে।
  - Product copy: আসল LLM থাকলে draft+SEO প্রস্তাবে সংরক্ষিত, approval-এ
    apply; dev-template provider হলে সৎ BadRequest — কোনো row-ই তৈরি হয় না,
    fabricated copy কখনো নয়।
- Briefing: commerce অংশ কেবল commerce data থাকা org-এ; commerce-হীন org-এ
  কোনো অংশই আসে না (zeros theatre নয়)।
- Specs: proposals 16/16, briefing 6/6, DI 1/1; `src/ai` পূর্ণ 179/179।

## Part 3 — EC12 hardening (`6ca4932`, migration নেই)

- **Shopify bulk sync:** `bulkOperationRunQuery` (products+variants) →
  bounded polling (`SHOPIFY_BULK_POLL_MS`/`SHOPIFY_BULK_MAX_POLLS`) →
  JSONL parse → বিদ্যমান upsert pipeline (`ingestProductRaws`)। ব্যর্থতা/
  timeout-এ **REST fallback**, job COMPLETED + `bulkFallback`/`bulkError`
  return ও audit-এ। Trigger: sync/products endpoint-এ `{bulk:true}`।
- **Woo webhook secret rotation:** `POST integrations/:id/rotate-webhook-secret`
  (OWNER) — নতুন secret, credential re-seal, আমাদের delivery_url-র webhook
  মুছে B1 helper দিয়ে পুনঃনিবন্ধন; audit-এ secret কখনো নয়। `API_PUBLIC_URL`
  ছাড়া stored secret rotate হয়ে `skipped_no_public_url` রেকর্ড হয়।
  Shopify: `{rotated:false, reason:"shopify_app_level_secret"}` সৎ ব্যাখ্যা।
- **Disconnect purge:** optional body `{purgeMappings:true}` (OWNER কেবল;
  ADMIN → Forbidden, কিছুই ঘটে না)। মোছে শুধু ঐ স্টোরের StoreListing/
  StoreDiscountSync/SyncOutbox/CustomerStoreIdentity; Products/Orders/
  Customers/StoreDiscount/Store কখনো মোছে না; response-এ itemized counts +
  kept তালিকা + দ্বিতীয় audit।
- Specs: shopify-bulk 8/8, ec12-hardening 6/6; integrations regression 21/21।

## Part 4 — Docs

- `docs/ecommerce-live-verification-checklist.md` — deploy পূর্বশর্ত (১১টি
  মাইগ্রেশন ক্রমে, env, per-org jobs, backfill dry-run→apply), Woo/Shopify/
  storefront live session ধাপ, প্রমাণের নিয়ম। **সব আইটেম OPEN।**
- `docs/ecommerce-program-summary.md` — EC1–EC12 → B1–B6 ম্যাপ, কমিট রেঞ্জ,
  মাইগ্রেশন/operational তালিকা, owner-decision অবস্থা।

## Gates (final, এই HEAD-এ)

- API jest: **245 suites, 2219/2219 pass** (B5: 2161 → +58 নতুন)
- API `tsc --noEmit`: **0 errors**
- Web vitest: **23 files, 157/157 pass** (isolated run)
- Web `tsc --noEmit`: **0 errors**
- Full build (`pnpm -r build`, next build সহ): **exit 0**
- Prisma validate: **valid**

## Honest limits

- Bulk sync, wc-auth, rotation, purge — সবই stub/fixture-প্রমাণিত; আসল
  স্টোরে অযাচাই। Woo wc-auth callback-এর আসল আচরণ (key_permissions মান,
  return flow) live সেশনেই নিশ্চিত হবে।
- AI product copy org-এর কনফিগার করা LLM-এর ওপর নির্ভরশীল; LLM ছাড়া
  প্রস্তাব সৎভাবে ব্যর্থ হয় (by design)।
- কোনো EC মাইগ্রেশন কোনো আসল DB-তে চালানো হয়নি; deploy-তে `migrate deploy`
  না হলে নতুন endpoint গুলো 500 দেবে।
- Live verification সম্পূর্ণভাবে মালিকের আসল স্টোর/ডোমেইনের ওপর নির্ভরশীল
  এবং OPEN আছে।
