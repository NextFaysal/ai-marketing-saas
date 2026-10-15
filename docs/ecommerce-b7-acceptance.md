# E-Commerce Phase 2 — Batch B7 (EC13 + EC15) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1`) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase2-Plan-2026-10-13.md` §২ EC13/EC15।

## কমিট

| Hash | বিষয় |
|---|---|
| `3d12cf1` | EC13+EC15 schema + migrations `20261013190000_ec13_landings`, `20261013200000_ec15_reviews` |
| `95b3f63` | EC15 backend — unified reviews, Woo pull + Shopify probe, moderation, `woo_reviews` job |
| `bc826a0` | EC13 backend — landings API, variants, order + upsell, staff CRUD/stats |
| `d2e66fc` | EC13+EC15 web — `/l/[slug]`, dashboard landings + moderation, shop reviews, Sync Reviews |
| (এই ডক) | docs |

## EC13 — Landing Page & Funnel Builder

- **মডেল:** `LandingPage` (product-bound, globally-unique slug, status draft|published|archived, sections Json, upsellProductId), `LandingVariant` (weight/headline/hero/cta/showCompareAt/isControl), `LandingEvent` (view|checkout_started, PII নেই), `Order.landingPageId/landingVariantId`।
- **Sections validator:** নির্দিষ্ট ৮ block (hero|description|benefits|gallery|reviews|faq|offer|trust); benefits ≤8, faq ≤10 (q/a বাধ্যতামূলক), trust string ≤300, description ≤5000, মোট ~20KB cap — লঙ্ঘনে 400। null হলে ৮টি default block।
- **Public API** (`public/landing`): published ছাড়া 404। Variant assignment = visitor token-এর FNV-1a stable hash, cumulative weight walk (weight-0 কখনো নয়; bucket মোট weight ছাড়ালে control → first)। Payload-এ public product shape (gallery + variants), org pixel ids (BusinessProfile থেকে — checkout-এর একই injection পথ, landing নিজে pixel সেটিং রাখে না), sections (enabled+ordered), variant, upsell, EC15 reviews (fail-safe: reviews সার্ভিস ব্যর্থ হলে খালি summary — landing ভাঙে না), ৬৪ জেলা, `delivery.hasZones`।
- **Order:** `placePublicOrder`-এর হুবহু শৃঙ্খলা — server-side variant/product price, bump আগে (`[Special Add-On]` লাইন), EC7 coupon validation + সফলতার পর redeem (log-only failure), ডেলিভারি দুই পথে: org-এ active zone থাকলে `StorefrontService.matchZone` (district বাধ্যতামূলক, freeAbove discounted subtotal-এ, free-shipping শূন্য করে; zone না মিললে EC8-এর বার্তায় 400), zone না থাকলে BusinessProfile inside/outside fee formula হুবহু। Ingestion `upsertOrder(..., "landing")`, পরে order-এ attribution stamp। Response-এ server totals + COD due।
- **Post-purchase upsell:** শুধু যখন order এই landing-এর, status open vocabulary-তে (pending|processing|on-hold), কোনো Fulfillment নেই, placement ≤2 ঘণ্টা, upsell product ACTIVE ও আগে যোগ হয়নি। **Stock step আগে** (`InventoryService.applyOrderPlaced`) — ব্যর্থ হলে পুরো append বাতিল (400), কোনো OrderItem লেখা হয় না। প্রতিটি শর্তভঙ্গে নির্দিষ্ট বাংলা কারণ।
- **Staff:** CRUD (DELETE = archive — attributed order-এর ইতিহাস রক্ষায়), slug uniqueness 409, variant manager (control সেট করলে অন্য control মুছে যায়), stats (LandingEvent + attributed Orders থেকে views/checkout-started/orders/revenue/conversion, per-variant breakdown; views 0 হলে conversion null)।
- **Web:** `/l/[slug]` (server wrapper + `generateMetadata`; client: visitor id, একবার view beacon, প্রথম form interaction-এ checkout-started beacon, সব section render, checkout-হুবহু order form, সফলতায় fbq Purchase + upsell কার্ড verbatim error সহ, sticky mobile bar) + dashboard `/dashboard/commerce/landings` (list/create/editor/variants/stats) + Commerce Hub লিংক।

## EC15 — Reviews & Social Proof Engine

- **Unified public read** (`GET public/shop/:orgSlug/products/:productSlug/reviews` + landing-এ একই সার্ভিস): নিজের reviews = CX12b `OrderReview` যেগুলোতে rating + receivedAt আছে ও `isVisible` — verified নিয়ম: row শুধু delivery event-এই তৈরি হয়, তাই `verified = deliveredAt != null || order.status === "completed"`। External = `ExternalReview` visible। Summary সব visible-এর উপর (50-item cap-এর আগে), গড় ১ দশমিক, খালি হলে `average: null` (ভুয়া 0 নয়)। লেখক = কাস্টমারের **শুধু first name**; email/phone/full name payload-এ নেই (spec-প্রমাণিত)। নিজের review-তে ছবি নেই (মডেলে নেই — বানানো হয়নি)।
- **Woo pull:** `WooClient.listProductReviews` + `syncReviews` — StoreListing দিয়ে product resolve (অমিল = skipped গণনা, কখনো তৈরি নয়), `[storeId, externalId]` upsert, HTML strip, non-approved → hidden, `reviewer_avatar_urls` ছবি হিসেবে **নেওয়া হয়নি** (ওগুলো avatar)। SyncJob + endpoint + `woo_reviews` automation job (60 min)।
- **Shopify probe:** GraphQL metafield probe (reviews namespace / global) — parseable ডেটা না মিললে বা client অচল হলে স্বাভাবিক ফলাফল `{ reviews: "unsupported_no_reviews_source" }` (exception নয়), SyncJob-এ রেকর্ড। Web-এ সেই ফলাফলে সাফল্যের সংখ্যার বদলে বাংলা ব্যাখ্যা দেখায়।
- **Moderation:** staff unified list (filters সহ) + PATCH hide/show (external-এ status mapping) + নিজের review-তে staff reply (replyText/repliedAt); external-এ reply = 400; foreign id = 404; audit-logged। Hidden review public API থেকে অদৃশ্য (spec-প্রমাণিত)।
- **Web:** shop product page-এ reviews section (shared component), landing reviews block, dashboard `/dashboard/commerce/reviews` moderation, integrations-এ "Sync Reviews" বোতাম।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **276 suites / 2693 tests, সব pass** — একক প্রসেস রান এই sandbox-এ SIGABRT (OOM) খাওয়ায় ৩টি directory chunk-এ চালানো হয়েছে (123/1043 + 116/1270 + 37/380, প্রতি chunk exit 0)। Baseline 272/2625 → +4 suite/+68 test (EC13 53, EC15 16 — একটি baseline test এই tree-তে conditional) |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ exit 0 — 32 files, **209/209** |
| Web tsc | ✅ exit 0 |
| Prisma validate | ✅ exit 0 (DATABASE_URL দিয়ে) |
| Full build (`pnpm -r build`) | ✅ exit 0 — ৭ প্যাকেজ Done, next build route table-এ `/l/[slug]`, landings/reviews dashboard route আছে |

## Deploy নোট

- মাইগ্রেশন `20261013190000_ec13_landings` + `20261013200000_ec15_reviews` **কোনো আসল DB-তে চালানো হয়নি** — deploy-এ `migrate deploy` + `prisma generate` লাগবে, নইলে landing/review endpoint 500 দেবে।
- Landing page production-এ চলতে web→API reachability (`API_INTERNAL_URL`, metadata fetch) ও public API base আগের মতোই লাগবে (EC8-এর নোট প্রযোজ্য)।

## সৎ সীমা ও বিচ্যুতি

- **Live প্রমাণ নেই** — সব fixture/stub/spec-প্রমাণিত; browser QA-ও হয়নি (sandbox-এ running app নেই)। Live যাচাই EC12 sprint-এই খোলা আছে।
- **বিচ্যুতি ১ (review-request টগল):** brief-এ StorefrontSetting-এ নতুন `reviewRequestEnabled` টগলের কথা ছিল — **যোগ করা হয়নি**, কারণ CX12b-তে হুবহু এই টগল ইতিমধ্যে `InboxSetting.reviewRequestEnabled` (default OFF) হিসেবে আছে, delivery-event hook + sweep + conversation→SMS→email precedence + exactly-once শৃঙ্খলাসহ। দ্বিতীয় টগল বিভ্রান্তি তৈরি করত। EC15-এর request-automation চাহিদা বিদ্যমান সিস্টেমেই পূরণ — তার spec (cx12b) সবুজ আছে।
- **বিচ্যুতি ২ (Woo rating push):** প্ল্যানের "Woo listing-এ rating সারাংশ প্রতিফলন" করা হয়নি — Woo নিজের reviews থেকে `average_rating` নিজে হিসাব করে; বাইরে থেকে push মানে fabricated মান বসানো হতো।
- **Shopify reviews:** native reviews API নেই — probe শুধু metafield পথ; বেশিরভাগ আসল স্টোরে ফলাফল `unsupported_no_reviews_source`-ই হবে যদি না কোনো review app metafield-এ ওই আকারে ডেটা রাখে। Client-credentials token refresh এই probe পথে হয় না — মেয়াদোত্তীর্ণ token-এ ফলাফল honest unsupported।
- **পর্যবেক্ষণ (আগের কোড, এই ব্যাচে ছোঁয়া হয়নি):** `placePublicOrder` BusinessProfile-এর `insideDhakaFeeMinor/outsideDhakaFeeMinor` পড়ে, কিন্তু schema-র আসল কলাম `deliveryChargeInsideMinor/...Outside` — ফলে single checkout (ও তার হুবহু mirror হিসেবে landing order-এর no-zone পথ) production-এ কার্যত সবসময় default 6000/12000-এ পড়ে, মার্চেন্টের সেট করা charge সেখানে প্রতিফলিত হয় না। আলাদা ছোট fix-এ দুটো checkout একসাথে ঠিক করা উচিত (এই ব্যাচের scope-এর বাইরে রাখা হলো যাতে বিদ্যমান আচরণ নীরবে না বদলায়)।
- LandingsModule reviews-এর জন্য OrdersModule-এর instance ছাড়াও factory দিয়ে আলাদা `ProductReviewsService` instance বানায় (stateless prisma service — কার্যকরী পার্থক্য নেই, তবে এক instance করা ভবিষ্যতে পরিষ্কার হবে)।
- Shopify/Woo আসল স্টোরে reviews sync, landing order-এর আসল pixel firing — কোনোটাই live চালানো হয়নি।
