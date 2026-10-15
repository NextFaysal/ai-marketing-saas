# E-Commerce Phase 2 — Batch B9 (EC14 + EC16) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1`, B8-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase2-Plan-2026-10-13.md` §২ EC14 + §২ EC16।

## কমিট

| Hash | বিষয় |
|---|---|
| `b0f50d7` | EC14 research spike (docs/ec14-marketplace-research.md) |
| `4546c9a` | Schema + migrations `20261013230000_ec14_product_feeds`, `20261013240000_ec16_promotions` |
| `5346bfe` | EC16 backend: evaluator + unified checkout + CRUD/preview + specs |
| `9f5f267` | EC14 backend: feed engine + token serving + specs |
| (এই কমিট) | Web: feeds + promotions পেজ, hub লিংক, referral settings, order/quote/success প্রদর্শন + এই acceptance ডক |

## Step 0 — Research spike সিদ্ধান্ত (সোর্সসহ পূর্ণ ডক: `docs/ec14-marketplace-research.md`)

| চ্যানেল | সিদ্ধান্ত | কারণ (সংক্ষেপে) |
|---|---|---|
| TikTok Shop API | **NO-BUILD** | API আছে কিন্তু Partner Center + app review গেটেড; সবচেয়ে বড় কথা — **TikTok Shop বাংলাদেশে local seller market-ই নয়** (DPL country list-এ BD "Not listed"), অর্থাৎ BD tenant-দের কানেক্ট করার মতো শপই নেই। |
| Daraz / Lazada | **NO-BUILD** | Lazada Open Platform public কিন্তু শুধু my/sg/th/ph/vn/id venture-এর জন্য। Daraz আলাদা South-Asia venture; কোনো পাবলিক Daraz BD seller API/onboarding পাওয়া যায়নি। Lazada integration বানিয়ে Daraz বলা হলে তা মিথ্যা দাবি হতো। |
| Meta catalog feed | **BUILD (feed-only)** | অফিসিয়াল feed spec (Catalog Reference, 2026-10-05 হালনাগাদ) — scheduled fetch, RSS-XML/CSV। |
| Google Merchant feed | **BUILD (feed-only)** | অফিসিয়াল product data specification + RSS 2.0 spec — scheduled fetch। |
| TikTok feed ফাইল | **সাধারণ CSV (generic)** | পাবলিক hostable feed spec নেই। নিচের বিচ্যুতি নোট দেখুন। |

Marketplace order-sync এই ব্যাচে কোনো চ্যানেলের জন্যই বানানো হয়নি (spike সিদ্ধান্ত অনুযায়ী follow-up package-এর বিষয়, সেটিও শুধু API সত্যিই খুললে)।

## EC14 — Feed engine

- **ProductFeed মডেল:** channel (meta | google | tiktok), format (xml | csv), token (random, rotatable — URL-ই credential), includeOutOfStock (default false), defaultGoogleCategory, active, lastGeneratedAt।
- **Generator (একটাই canonical item model, channel serializer আলাদা):** শুধু ACTIVE পণ্য; per-variant row (item_group_id সহ) অথবা single row; id = SKU নইলে product id (৫০ অক্ষরে cap — Google limit); title ≤150, description ≤5,000 (HTML strip; seoDescription অগ্রাধিকার); link = shop চালু থাকলে `/shop/:orgSlug/products/:slug`, নইলে `/checkout/:slug`; price/sale_price গবেষণার semantics অনুযায়ী (sale থাকলে price = compareAt/regular, sale_price = বর্তমান selling price); availability channel-ভেদে শব্দভাণ্ডার (Meta `in stock`, Google `in_stock`); brand = shopName নইলে org name; gtin শুধু আসল barcode থাকলে — **কখনো বানানো হয় না**; Google-এ GTIN না থাকলে `identifier_exists=no`; Meta XML-এ `additional_image_link` unprefixed (Meta-র নিজের উদাহরণ অনুযায়ী), Google-এ repeated `g:` element।
- **সৎ skip:** slug/image/description না থাকা পণ্য placeholder দিয়ে ভরাট না করে feed থেকে বাদ + কারণসহ গণনা (preview-তে reasonMessage দেখা যায়)। Out-of-stock default-এ বাদ (opt-in করলে `out of stock` হিসেবে যায়)।
- **Endpoint:** `GET /feeds/:token.(xml|csv)` (@Public) — token lookup, inactive feed/ভুল extension/অজানা token সব একই 404; সঠিক content-type; প্রতিটি fetch-এ per-request পুনঃতৈরি (এই scale-এ গ্রহণযোগ্য — ডকুমেন্টেড) + lastGeneratedAt রেকর্ড (failure-isolated)।
- **Staff UI:** `/dashboard/commerce/feeds` — তৈরি (channel status নোটসহ: TikTok CSV "সাধারণ এক্সপোর্ট — ইন্টিগ্রেশন নয়", Daraz নেই কেন তাও ব্যানারে), URL কপি, token rotate (পুরনো URL তখনই মরে), active toggle, preview (প্রথম ৫ আইটেম + skip কারণ + Meta category warning), item/skipped count। তৈরি/rotate/toggle/delete audit-logged।
- **Feed-এ EC16 promotions নেই** — promotions cart-level; feed শুধু product price/sale বহন করে (ডকুমেন্টেড সিদ্ধান্ত)।

## EC16 — Promotions v2

- **একটাই মূল্য-সত্য (single source of truth):** `PromotionsService.evaluateCheckout` — তিনটি checkout পথই (shop quote/checkout, single `placePublicOrder`, landing order) এটাই ডাকে; staff preview-ও একই evaluator। PromotionsService না থাকা spec harness-এ পুরনো EC7-only ব্লক fallback হিসেবে থাকে (promotion না থাকলে ফলাফল হুবহু এক — parity specে প্রমাণিত)।

### THE stacking rule (একটাই নিয়ম, spec-প্রমাণিত)

1. **Promotions আগে** — priority DESC, তারপর createdAt ASC ক্রমে; প্রতিটি line-এর effective (sale-aware) unit price-এর উপর।
2. **Unit consumption:** এক promotion-এ ছাড় পাওয়া unit আরেকটিতে পায় না। BOGO শুধু তার GET unit consume করে (buy unit পরের promotion-এর জন্য খোলা থাকে); percent promotion (tiered/flash) যেসব line ছোঁয়, সেগুলোর বাকি সব unit consume করে।
3. **BOGO group integrity:** একই unit buy ও get দুটোই হতে পারে না — overlapping scope-এ complete group-এর union-শর্ত (buy 2 get 1, কার্টে মাত্র ২টা থাকলে কোনো group নয়)। Get unit = get-scope-এর সবচেয়ে সস্তা unit আগে; get পণ্য কার্টে না থাকলে auto-add হয় না (v1 সীমা, ডকুমেন্টেড)।
4. **Flash ≠ product sale-এর উপর:** compareAtMinor > price (product-level sale) line flash এড়িয়ে যায়; BOGO/tiered sale price-এর উপরেই প্রযোজ্য। Flash-এ startsAt+endsAt বাধ্যতামূলক।
5. **Coupon পরে** — EC7 `validateDiscount` হুবহু, কিন্তু post-promotion line total/subtotal-এর উপর (EC7-র নিজের base সংজ্ঞা অপরিবর্তিত; promotion না থাকলে context byte-identical — parity spec)। ফলে coupon-এর min-order-ও post-promotion subtotal-এ বিচার হয় (spec-প্রমাণিত)। Invalid coupon আগের মতোই Bengali BadRequest — অর্ডার লেখা হয় না।
6. **Referral সবার শেষে** — post-promotion, post-coupon merchandise amount-এর উপর percent।
7. Percent math per-line floor — EC7-র integer শৃঙ্খলা।

- **Order persistence:** `Order.discountMinor` আগের মতোই TOTAL (coupon + promotion + referral) — সব বিদ্যমান total/due math অপরিবর্তিত। আলাদা করে `promotionDiscountMinor`, `promotionsApplied` ([{promotionId, name, type, amountMinor}]), `referralDiscountMinor`, `referralCode` stamp হয় (EC18 slot প্যাটার্নে — shop/single stamp service দিয়ে, landing attribution update-এর সঙ্গে)। Staff order detail + তিনটি success screen-ই promotion নামসহ দেখায়। Shop-এর free-above ডেলিভারি বিচার এখন মোট ছাড়-পরবর্তী subtotal-এ (discountedSubtotal-এর বিদ্যমান সংজ্ঞারই ধারাবাহিক বিস্তার)।
- **Referral-as-discount:** brief-এর অনুমান (order/SalesDataService-এ বিদ্যমান referral code) code-এ পাওয়া যায়নি — একমাত্র বিদ্যমান referral system হলো platform-level SaaS user referral (User.referralCode + wallet credit), যা tenant customer-দের জন্য নয়। তাই tenant-level-এ নতুন: `Customer.referralCode` (org-unique, lazily তৈরি — order success response-এ গ্রাহক নিজের কোড পান `yourReferralCode` হিসেবে), config StorefrontSetting-এ (`referralDiscountPercent` null = বন্ধ, `referralMinSubtotalMinor`)। নিয়ম: অন্য গ্রাহকের valid code + ওই ক্রেতার ওই code-এ প্রথম ব্যবহার (cancelled/failed/refunded আগের order বাধা দেয় না) + min subtotal (post-promotion) → ছাড়; **self-referral (একই ফোন, loose-normalized) নীরবে বাতিল**; অজানা code কিছুই record হয় না, কিন্তু আসল referrer-এর code ছাড় না পেলেও order-এ record হয় (tracking সত্য থাকে)। Referrer-এর কোনো reward/wallet credit বানানো হয়নি — tenant-level-এ এমন system ছিলই না; শুধু code-used-এর record-ই tracking।
- **Staff UI:** `/dashboard/commerce/promotions` — per-type config form (আসল product/category picker), window, priority, active toggle; কার্ট সিমুলেটর preview — server evaluation-এর breakdown, client-side কোনো price math নেই।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **283 suites / 2781 tests** (baseline 280/2737 ⇒ +3 suite/+44 test: promotions 16, ec16-checkout 15, feeds 13) — ৪টি chunk-এ চালানো (sandbox-এ একক-প্রসেস রান OOM খায়, B8-র মতোই)। একমাত্র ব্যর্থতা `cx3-debounce` (chunk B) — CX যুগের পরিচিত intermittent ফ্লেক; B9 inbox-এ শূন্য পরিবর্তন করেছে; আলাদাভাবে পরপর ২ রানে **18/18 pass** |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ exit 0 — 33 files, **212/212** (baseline 212 — নতুন test লাগেনি; shop-i18n completeness সবুজ) |
| Web tsc | ✅ exit 0 |
| Prisma validate | ✅ exit 0 (+ generate সবুজ) |
| Full build (`pnpm -r build`) | ✅ exit 0 — ৭ প্যাকেজ Done; next build route table-এ `/dashboard/commerce/feeds` ও `/dashboard/commerce/promotions` আছে |

## Deploy নোট

- মাইগ্রেশন `20261013230000_ec14_product_feeds` + `20261013240000_ec16_promotions` **কোনো আসল DB-তে চালানো হয়নি** — deploy-এ `migrate deploy` + `prisma generate` বাধ্যতামূলক। দুটোই additive (নতুন টেবিল + nullable/defaulted কলাম)।
- Feed URL production-এ চলতে `API_PUBLIC_URL` (token URL তৈরিতে) ও `WEB_PUBLIC_URL`/`APP_PUBLIC_URL` (product link তৈরিতে) সেট থাকা লাগবে — woo-auth/health check-এর বিদ্যমান convention-ই।
- Feeds list endpoint প্রতিটি feed-এর জন্য count হিসাব করতে একবার generation চালায় (per-request generation-এরই ধারাবাহিকতা) — catalog বড় হলে (হাজারের বেশি পণ্য) এই পেজ ধীর হতে পারে; v1-এ স্বীকৃত সীমা।

## সৎ সীমা ও বিচ্যুতি

- **কোনো live marketplace connection নেই, দাবিও করা হয়নি।** TikTok Shop ও Daraz NO-BUILD (গবেষণা-ভিত্তিক); Meta/Google feed format spec-ভিত্তিতে প্রমাণিত — কোনো মার্চেন্ট আসল feed জমা দিয়ে live যাচাই করেনি। Meta-র `additional_image_link` "Required" বনাম hard-fail অসঙ্গতি এবং Google-র `identifier_exists=no` পথ live Commerce Manager/Merchant Center যাচাই ছাড়া চূড়ান্ত নয় (গবেষণা ডক §৯)।
- **TikTok CSV বিচ্যুতি:** গবেষণা subagent "speculative TikTok CSV বানাবেন না" পরামর্শ দিয়েছিল; batch brief-এর পূর্বনির্ধারিত fallback (Google column set-এর generic CSV, সৎভাবে labelled) অনুসরণ করা হয়েছে — UI ও এই ডকে সর্বত্র "সাধারণ এক্সপোর্ট, TikTok ইন্টিগ্রেশন নয়" স্পষ্ট লেখা আছে। কোনো TikTok-সংযোগের দাবি কোথাও করা হয়নি।
- **Plan-এর EC16-র বাড়তি দুটি আইটেম** — bundle **price** (set price) ও free gift auto-line — এই ব্যাচের brief-এ ছিল না, করা হয়নি (বাদ নয়, scope-এর বাইরে)। BOGO-তে get পণ্য কার্টে না থাকলে auto-add-ও v1-এ নেই (শুধু কার্টে থাকা আইটেমে ছাড়)।
- **Referral code ব্যবস্থার বিচ্যুতি:** উপরে বর্ণিত — বিদ্যমান platform referral পুনঃব্যবহারের বদলে tenant Customer-ভিত্তিক নতুন code; কারণ platform system SaaS user-দের, tenant customer-দের নয়।
- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত; browser QA হয়নি (sandbox-এ running app নেই)। EC12 live sprint এখনো খোলা।
- `cx3-debounce` ফ্লেকের root cause এখনো খোলা (CX প্যাকেজ থেকেই) — এই ব্যাচে ছোঁয়া হয়নি।
