# E-Commerce Phase 2 — Batch B8 (EC18 + EC19) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1`, B7-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase2-Plan-2026-10-13.md` §৩ EC18/EC19 + B7 acceptance-এ নথিভুক্ত fee-field বাগ (Part 0)।

## কমিট

| Hash | বিষয় |
|---|---|
| `a7b0513` | Part 0 fix: আসল BusinessProfile delivery charge ফিল্ড (নিচে) |
| `4a41a81` | Schema + migrations `20261013210000_ec18_delivery_slots_tracking`, `20261013220000_ec19_shop_polish` |
| `95eab8f` | EC19 API: PaymentVerification-backed staff advance + order detail due math |
| `62fd37e` | EC19 API: featured top_sellers + locale/trust settings ও payload |
| `98870b9` | EC18 API: delivery slots — staff CRUD + তিনটি checkout পথে validation/capacity |
| `2223228` | EC18 API: branded public tracking lookup |
| `171a262` | Web: shop i18n dictionary (bn/en) + shop surface conversion |
| `7daa218` | Web: `/track/[orgSlug]` + success-page link |
| `5319980` | Web: slot picker + trust elements (তিনটি checkout) |
| `724c076` | Web: dashboard storefront settings + slots CRUD + order advance UI |
| `83fe34d` | EC18 API follow-up: landing/single payload-এ org slug + trust copy |
| (এই ডক) | docs |

## Part 0 — Bug fix (B7 আবিষ্কৃত)

`placePublicOrder`, `getPublicProductBySlug` (checkout info) ও landing order পথ BusinessProfile-এর **অস্তিত্বহীন** `insideDhakaFeeMinor`/`outsideDhakaFeeMinor` পড়ত — আসল কলাম `deliveryChargeInsideMinor`/`deliveryChargeOutsideMinor`। ফলে production-এ মার্চেন্টের সেট করা ডেলিভারি চার্জ উপেক্ষিত হয়ে প্রতিটি single/landing অর্ডার default ৳60/৳120-তেই পড়ত। তিনটি read site-ই এখন আসল ফিল্ড পড়ে; default শুধু তখনই যখন মার্চেন্ট মান সেট করেননি (null)। Spec: landing-এ সেট করা 7000/13000 হুবহু, single checkout-এ 7500/15500 হুবহু, checkout info-তে configured মান প্রদর্শন, null ⇒ দুই পথেই 6000/12000।

## EC19 — Native Shop Polish

- **Manual advance ⇒ PaymentVerification-backed:** বিদ্যমান মডেলটি আসলে inbox screenshot-extraction রেকর্ড (conversation/message-বাঁধা, verdict-ভিত্তিক; কোনো order link বা review status ছিল না) — তাই মডেলটি additive বাড়ানো হয়েছে: `orderId`, `status` (pending|approved|rejected), `source`, `reviewedById`, `note` যোগ; `conversationId`/`messageId` nullable (inbox পথ দুটোই সেট করে, আগের মতোই)। নতুন staff endpoint `POST orders/:orderId/advance-verification { amountMinor, method (bkash|nagad|rocket|cash|bank|other), reference?, note? }`: রো তৈরি হয় `status="approved"`, `verdict="matched"`, `source="manual_advance"`, `reviewedById` = স্টাফ সদস্য (স্টাফ নিজেই যাচাইকারী), `modelProvider="manual_staff"` — কোনো gateway নয়, কোনো টাকা platform ছোঁয় না। Due-এর চেয়ে বেশি amount ⇒ নির্দিষ্ট বার্তাসহ 400; ইতিমধ্যে approved একই TrxID ⇒ 400; foreign order ⇒ 404; audit `orders.advance_verification_recorded`।
- **Due math:** order detail এখন `paymentVerifications` (সব রো), `advancePaidMinor` (শুধু approved-গুলোর যোগফল, total-এ capped), `amountDueMinor` (≥ 0) ফেরত দেয়। পুরনো `advance_unverified` নোট-ওয়ালা অর্ডার অপরিবর্তিত — নোট দেখায়, advancePaid 0, পুরো amount due (additive পথ, আচরণের migration ডকুমেন্টেড: নতুন advance শুধু এই endpoint দিয়েই রেকর্ড হয়)।
- **Featured top_sellers:** `StorefrontSetting.featuredMode` (merchant_picks | top_sellers, default merchant_picks)। top_sellers = শেষ ৩০ দিনের আসল order item থেকে হিসাব — cancelled/refunded/failed বাদ; order qualify করে status completed হলে অথবা delivered Fulfillment থাকলে; productId দিয়ে, না থাকলে SKU দিয়ে resolve (ADD-ON-BUMP বাদ); quantity desc, তারপর revenue desc, সর্বোচ্চ ৮, শুধু ACTIVE পণ্য। বিক্রি না থাকলে ⇒ merchant picks ⇒ newest (বিদ্যমান fallback শৃঙ্খলা)। Settings UI-তে নিয়মটি সৎভাবে লেবেল করা ("শেষ ৩০ দিনের বিক্রি অনুযায়ী")। merchant_picks আচরণ byte-for-byte আগের মতো।
- **Shop i18n:** `StorefrontSetting.locale` (bn|en, default bn) payload-এ যায়; web-এ typed dictionary (`lib/shop-i18n.ts`, ~১২০ key, bn source of truth) — shop home/product/cart/checkout/success/track + header/card/footer dictionary দিয়ে রেন্ডার হয়। Dashboard আগের মতোই বাংলা। Dictionary completeness unit test (দুই locale-এ হুবহু একই key set, কোনো খালি মান নয়, অজানা locale ⇒ bn)। নতুন dependency যোগ হয়নি।

## EC18 — Tracking, Slots, Trust

- **Branded tracking page:** `POST public/shop/:orgSlug/track { phone, orderNumber }` (@Public + `@RateLimit(15, 60)`) — order number (externalNumber/externalId) ও customer phone **দুটোই** মিলতে হবে (phone loose-normalize: 880…/শেষ ১১ ডিজিট); সব ব্যর্থতায় **একই ধ্রুবক 404 বার্তা** (কোন ফিল্ড মেলেনি তা ফাঁস হয় না)। Response-এ শুধু আসল ডেটা: order number, তারিখ, status steps (order/fulfillment/shipment রো থেকে derived reached-flag — কোনো বানানো timestamp নয়), item, total, EC19 advance math-এ COD due, বেছে নেওয়া slot, shipment থাকলে courier নাম + tracking code (fulfillment থেকে fallback)। **ঠিকানা/full phone/email কখনোই response-এ নেই** (spec-এ deep-check)। `trackingPageEnabled` (default true) বন্ধ ⇒ 404। Web `/track/[orgSlug]`: org branding, dict-driven timeline, courier stepper বিদ্যমান `lib/courier-status` mapping দিয়েই (অজানা status verbatim), cancelled/refunded/returned-এ verbatim banner। Shop success + single checkout success + landing success (payload-এ slug এখন আছে) থেকে "অর্ডার ট্র্যাক করুন" লিংক।
- **Delivery slots:** `DeliverySlot` (label, startTime/endTime HH:mm, districtScope Json — খালি = সব জেলা, capacityPerDay nullable = unlimited, active)। Staff CRUD storefront settings-এর অধীনে (zone প্যাটার্নেই; audit সহ) + dashboard UI। Checkout তিন পথেই: quote/landing/single payload-এ slot offer (shop quote district-filtered server-side; single checkout-এ district জানা নেই বলে শুধু all-district slot); order সময়ে server validation — slot active + district scope মিল + তারিখ আজ..+৭ দিন (Asia/Dhaka ক্যালেন্ডার দিন) + capacity (ওই slot+date-এ non-cancelled order count ≥ capacity ⇒ **"এই স্লটটি পূর্ণ"** বার্তাসহ refusal, কোনো order লেখা হয় না)। Order-এ `deliverySlotId` + `deliveryDate` ("YYYY-MM-DD" string — per-day counting হুবহু equality) stamp হয়; staff order detail + order list row-তে slot label + তারিখ দেখায়।
- **Checkout trust:** `StorefrontSetting.returnPolicyText / deliveryPromiseText / supportPhone` (সব nullable, merchant-লিখিত)। Shop checkout + single checkout + landing-তে order বোতামের কাছে delivery promise + support phone, footer এলাকায় return policy; shop footer ও tracking page-তেও। খালি ⇒ ব্লক সম্পূর্ণ অনুপস্থিত — placeholder text কখনোই নয়।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **280 suites / 2737 tests** — একক-প্রসেস রান sandbox-এ SIGABRT (OOM, B7-এর মতোই) খাওয়ায় ৩টি chunk-এ চালানো: 95/858 + 96/1069 + 89/810। Chunk 1-এ একমাত্র ব্যর্থতা `cx3-debounce` (CX প্যাকেজ থেকে পরিচিত intermittent ফ্লেক — B8 inbox/ai-তে শূন্য পরিবর্তন করেছে; আলাদাভাবে পরপর ২ রানে 18/18 pass)। Baseline 276/2693 ⇒ +4 suite/+44 test |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ exit 0 — 33 files, **212/212** (baseline 209 ⇒ +3 i18n test) |
| Web tsc | ✅ exit 0 |
| Prisma validate | ✅ exit 0 (+ generate সবুজ) |
| Full build (`pnpm -r build`) | ✅ exit 0 — ৭ প্যাকেজ Done; next build route table-এ `/track/[orgSlug]` আছে |

## Deploy নোট

- মাইগ্রেশন `20261013210000_ec18_delivery_slots_tracking` + `20261013220000_ec19_shop_polish` **কোনো আসল DB-তে চালানো হয়নি** — deploy-এ `migrate deploy` + `prisma generate` বাধ্যতামূলক। EC19 migration `PaymentVerification.conversationId/messageId`-এর NOT NULL তুলে দেয় (additive, বিদ্যমান রো অক্ষত)।
- Tracking page/slot/trust production-এ চলতে web→API reachability (EC8-এর নোট) আগের মতোই লাগবে।

## সৎ সীমা ও বিচ্যুতি

- **Live প্রমাণ নেই** — সব fixture/stub/spec-প্রমাণিত; browser QA-ও হয়নি (sandbox-এ running app নেই)। Live যাচাই EC12 sprint-এই খোলা আছে।
- **PaymentVerification ডিজাইন সিদ্ধান্ত:** brief-এর অনুমান (বিদ্যমান review workflow) মডেলে ছিল না — extraction verdict-ই ছিল একমাত্র অবস্থা। তাই pending→approved workflow বানিয়ে inbox পথ বদলানো হয়নি; বদলে order-advance-এর জন্য status/source ফিল্ড যোগ করে staff রো সরাসরি approved তৈরি হয়। Inbox extraction রো `status="pending"` default পায় (agent-এর সিদ্ধান্ত বাকি — অর্থাৎ আগের আচরণেরই নামকরণ), কোনো inbox আচরণ বদলায়নি।
- **Capacity race:** capacity যাচাই order লেখার আগে হয়; দুটি একযোগে checkout দুটোই pre-check পাস করতে পারে (stamp পরে হয়)। v1-এ এই ছোট race স্বীকার করা হলো — DB-level lock/unique এই ব্যাচে করা হয়নি।
- **Single checkout-এ district নেই** (শুধু inside/outside zone) — তাই সেখানে শুধু all-district slot offer/valid হয়; district-scoped slot সেখানে বেছে নেওয়া যায় না (ভুল করে পাঠালে server সৎভাবে reject করে)।
- **top_sellers-এর delivered সংজ্ঞা:** order status `completed` অথবা delivered Fulfillment — courier-delivered কিন্তু status হালনাগাদ হয়নি এমন order গণনায় আসে না। OrderItem-এ productId না থাকলে SKU মিলিয়ে resolve; SKU-ও মিললে না এমন line গণনা থেকে বাদ (অনুমান করা হয়নি)।
- EC19 প্ল্যানের বাকি দুটি আইটেম — display-only multi-currency ও shop blog/সাধারণ পেজ — এই ব্যাচের brief-এ ছিল না, করা হয়নি (বাদ পড়েনি, scope-এর বাইরে ছিল)।
- `cx3-debounce` ফ্লেকের root cause এখনো খোলা (CX প্যাকেজের সময় থেকেই) — এই ব্যাচে ছোঁয়া হয়নি, শুধু পর্যবেক্ষণ নথিভুক্ত হলো।
