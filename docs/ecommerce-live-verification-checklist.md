# E-Commerce Live Verification Checklist (EC12) — মালিকের জন্য

**অবস্থা: এই ডকুমেন্টটি শুধু প্রস্তুতি। প্রতিটি আইটেম OPEN / অযাচাইকৃত।**
কোনো আইটেমকে "live-proven" বলা যাবে শুধু তখনই, যখন আসল স্টোরে/আসল ডোমেইনে
সেটি করে দেখা হয়েছে এবং নিচে উল্লেখিত প্রমাণ (evidence) সংরক্ষণ করা হয়েছে।
Fixture/stub টেস্টে পাস করা মানে live প্রমাণ নয় — পুরো EC প্রোগ্রাম এখন পর্যন্ত
শুধু fixture/stub-প্রমাণিত।

প্রতিটি আইটেমের পাশে যাচাই শেষে লিখুন: তারিখ, কে করলেন, প্রমাণের লিংক/স্ক্রিনশট,
এবং ফলাফল (proven / failed + প্ল্যাটফর্মের verbatim error)।

---

## ক. Deploy পূর্বশর্ত (ক্রমানুসারে)

### ক১. মাইগ্রেশন — এই ক্রমে সবগুলো চালান

আগের সব মাইগ্রেশনসহ, EC প্রোগ্রামের মাইগ্রেশনগুলো:

1. `20261013000000_ec1_sync_foundation`
2. `20261013010000_ec2_connection_v2`
3. `20261013020000_ec3_catalog`
4. `20261013030000_ec4_inventory`
5. `20261013040000_ec5_order_tower`
6. `20261013050000_ec9_fulfillment_returns`
7. `20261013060000_ec6_customer_identity`
8. `20261013070000_ec7_discounts`
9. `20261013080000_ec10_abandoned_store_checkout`
10. `20261013090000_ec8_storefront`
11. `20261013100000_ec12_wc_auth_attempt`

- [ ] `prisma migrate deploy` production DB-তে সফল (আউটপুট সংরক্ষিত)
- [ ] `prisma generate` চালানো হয়েছে (API + worker দুটোতেই নতুন client)
- [ ] API/web/worker নতুন build-এ redeploy হয়েছে, health endpoint ঠিক আছে

### ক২. Environment variables

- [ ] `API_PUBLIC_URL` — API-র পাবলিক ঠিকানা (যেমন `https://api.qosprey.com`)।
      এটি ছাড়া: Woo/Shopify webhook auto-registration `skipped_no_public_url`
      হবে এবং wc-auth ১-ক্লিক flow authorize-url দিতে অস্বীকার করবে।
- [ ] `API_INTERNAL_URL` — web থেকে API-র অভ্যন্তরীণ ঠিকানা (B5 custom-domain
      middleware-এর জন্য; B5 acceptance দেখুন)।
- [ ] `WEB_PUBLIC_URL` (ঐচ্ছিক) — wc-auth `return_url`-এর জন্য web অ্যাপের
      পাবলিক ঠিকানা; না থাকলে `APP_PUBLIC_URL`/`API_PUBLIC_URL` ব্যবহৃত হয়।
- [ ] `SHOPIFY_API_VERSION` (ঐচ্ছিক) — না দিলে GraphQL `2025-10`, REST `2024-10`।
- [ ] `ENCRYPTION_KEY` আগের মতোই আছে (credential decrypt না হলে সব connect ভাঙবে)।

### ক৩. প্রতি org-এ Automations jobs চালু করুন (Dashboard → Automations)

- [ ] `sync_outbox_process` (টেমপ্লেট, প্রতি ৫ মিনিট) — এটি ছাড়া কোনো store
      push-ই (product/stock/order/discount) প্রসেস হবে না।
- [ ] `sale_schedule_sweep` (টেমপ্লেট, প্রতি ১৫ মিনিট) — scheduled sale-এর জন্য।
- [ ] Store sync jobs: `woo_products` / `woo_orders` / `woo_customers` /
      `shopify_products` / `shopify_orders` / `shopify_customers`
      (integration-ভিত্তিক টেমপ্লেট) — প্রযোজ্য স্টোরগুলোর জন্য।
- [ ] যাচাই: একটি job run শেষে SyncJob/Automation run তালিকায় COMPLETED দেখা।

### ক৪. Listings backfill

- [ ] Dry-run: `pnpm tsx scripts/backfill-store-listings.ts` (repo root থেকে;
      স্ক্রিপ্টের হেডার কমেন্টে সঠিক invocation দেখুন) — আউটপুটে
      তৈরি-হবে এমন listing সংখ্যা ও ambiguous (একাধিক একই-প্ল্যাটফর্ম স্টোর)
      skip সংখ্যা নোট করুন।
- [ ] `--apply` দিয়ে আসল run; তারপর Sync Center-এ listing গুলো দেখা যাচ্ছে।

---

## খ. WooCommerce live session (মালিকের আসল স্টোরে)

### খ১. Connect — দুটি পথই

- [ ] **Key-paste পথ:** Stores পেজে REST API key (Read/Write) দিয়ে connect —
      health endpoint সব check `pass` (write-permission check টি ডিজাইন অনুযায়ী
      `unknown` থাকে — এটাই সঠিক আচরণ, fail নয়)।
      প্রমাণ: integrations পেজের health panel স্ক্রিনশট।
- [ ] **wc-auth ১-ক্লিক পথ:** "১-ক্লিকে কানেক্ট" → Woo-তে Approve → ফিরে এসে
      integrations তালিকায় CONNECTED দেখা। প্রমাণ: স্ক্রিনশট + attempt টি
      consumed হয়েছে (দ্বিতীয়বার একই callback কাজ করবে না)।
- [ ] Webhook registration অবস্থা `registered` (না হলে "Webhooks মেরামত" চাপুন
      এবং ফলাফল নোট করুন)।

### খ২. Catalog দুই দিকে

- [ ] স্টোরটিকে **full-manage** মোডে নিন (Sync Center/Integrations থেকে)।
- [ ] SaaS-এ নতুন প্রোডাক্ট তৈরি → listing Publish → Woo admin-এ প্রোডাক্টটি
      হুবহু (নাম/দাম/স্টক/ছবি) দেখা। প্রমাণ: Woo admin স্ক্রিনশট + listing
      syncStatus `synced`।
- [ ] SaaS-এ দাম বদলান → Woo-তে বদলেছে (read-back `synced`)।
- [ ] Woo admin-এ দাম বদলান → পরের sync/webhook-এ SaaS-এ এসেছে; SaaS-এ
      অমীমাংসিত local বদল থাকলে conflict তৈরি হয় এবং Sync Center থেকে
      keep-local / take-remote দিয়ে নিষ্পত্তি হয়।

### খ৩. Order → fulfillment → tracking

- [ ] Woo-তে আসল অর্ডার দিন → SaaS Orders-এ এসেছে।
- [ ] SaaS থেকে কুরিয়ার booking + fulfillment তৈরি → Woo অর্ডারে tracking
      note/meta এসেছে, কাস্টমার তা দেখতে পাচ্ছেন। প্রমাণ: Woo order পেজ।
- [ ] Woo-তে একটি abandoned পরিস্থিতি: tracker health check `pass`
      (ট্র্যাকার বসানো থাকলে) এবং cart টি Abandoned পেজে দেখা।

### খ৪. Refund gate (ডিফল্ট OFF — মালিকের সিদ্ধান্ত)

- [ ] Gate OFF অবস্থায় SaaS-এ refund রেকর্ড করুন → Woo-তে কোনো refund
      তৈরি হয়নি (শুধু local রেকর্ড) — এটাই প্রত্যাশিত।
- [ ] শুধু যাচাইয়ের জন্য OWNER হিসেবে gate ON করে ছোট অংকের refund →
      Woo-তে refund দেখা → gate আবার OFF করে দিন (মালিক সিদ্ধান্ত না বদলালে
      ON রাখবেন না)।

### খ৫. Discount

- [ ] SaaS Discounts থেকে কুপন তৈরি করে এই স্টোরে push → Woo Coupons-এ আছে →
      Woo checkout-এ কোডটি আসল ছাড় দিচ্ছে। প্রমাণ: checkout স্ক্রিনশট।

---

## গ. Shopify live session (প্রথমে dev store-এ গ্রহণযোগ্য)

- [ ] **Client-credentials connect:** Dev Dashboard app-এর client id/secret
      দিয়ে connect; token মেয়াদ ও অটো-refresh নোট করুন (মেয়াদ পেরিয়ে
      আবার sync চালিয়ে দেখুন)।
- [ ] **Scopes:** health প্যানেলে প্রয়োজনীয় scope গুলো আছে; অনুপস্থিত থাকলে
      কোন push বোতাম/ক্ষমতা বন্ধ আছে তা মিলিয়ে দেখুন।
- [ ] **Location mapping:** Sync Center → Locations refresh → আসল Shopify
      location গুলো এসেছে; একটি default সেট করুন। Mapping ছাড়া stock push
      করলে `shopify_location_not_mapped` verbatim blocker আসে — এটাও যাচাই করুন।
- [ ] **Product push + read-back:** SaaS থেকে প্রোডাক্ট publish → Shopify
      admin-এ দেখা; দাম/স্টক বদল → মিলেছে। Variant SKU-এর GraphQL অবস্থান
      live-এ যাচাই (B2-তে এটি live-অযাচাইকৃত ছিল)।
- [ ] **Bulk sync:** বড় ক্যাটালগে Sync Products (bulk) → SyncJob COMPLETED;
      bulk ব্যর্থ হলে fallback হয়েছে কিনা job/audit-এ দেখা।
- [ ] **Order → fulfillment:** Shopify-তে অর্ডার → SaaS থেকে fulfillment +
      tracking push → Shopify order-এ tracking দেখা।
- [ ] **Discount:** SaaS থেকে discount code push → আসল Shopify checkout-এ
      কোড কাজ করছে। প্রমাণ: checkout স্ক্রিনশট।
- [ ] **Abandoned checkout:** checkout শুরু করে ফেলে যান → webhook-এ
      Abandoned পেজে এসেছে → recovery email পাঠিয়ে দেখুন।

---

## ঘ. Native storefront session (স্টোরবিহীন মার্চেন্ট)

- [ ] Storefront settings-এ shop চালু করুন; ভিজিটর হিসেবে `/shop/<orgSlug>`
      খুলুন — প্রোডাক্ট/ক্যাটাগরি/cart দেখা যাচ্ছে।
- [ ] Shipping zones ঠিক করুন (জেলা-ভিত্তিক): ভিন্ন জেলায় checkout করে
      delivery charge হিসাব মিলিয়ে দেখুন।
- [ ] COD অর্ডার সম্পূর্ণ করুন → অর্ডারটি SaaS Orders-এ এসেছে → কুরিয়ার
      booking পর্যন্ত যান।
- [ ] কুপন প্রয়োগ করে একটি অর্ডার (ভুল কোডে সৎ error, সঠিক কোডে ছাড়)।
- [ ] **Custom domain:** settings-এ domain দিন → দেওয়া TXT রেকর্ডটি DNS-এ
      বসান → যাচাই সফল হলে domain সক্রিয়; তারপর domain টি web অ্যাপে point
      করুন (Dokploy/Traefik) এবং SSL সার্টিফিকেট আসা পর্যন্ত অপেক্ষা করে
      `https://<domain>`-এ দোকান খুলে দেখুন। TXT ছাড়া domain কখনো সক্রিয়
      হবে না — যাচাই ব্যর্থ অবস্থাটাও দেখে নিন।

---

## ঙ. প্রমাণ সংরক্ষণের নিয়ম

- প্রতিটি proven আইটেমের জন্য অন্তত একটি: স্ক্রিনশট, প্ল্যাটফর্মের response/
  order/product ID, অথবা Sync Center-এর read-back `synced` অবস্থার ছবি।
- ব্যর্থ আইটেম লুকাবেন না: verbatim error টি হুবহু লিখে রাখুন — সেটাই পরের
  fix-এর ভিত্তি।
- এই checklist-এর একটি পূরণকৃত কপি goal ফাইলে সংরক্ষণ করুন এবং
  `docs/ecommerce-program-summary.md`-এর live অবস্থা হালনাগাদ করুন।
