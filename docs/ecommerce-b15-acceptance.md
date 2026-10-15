# E-Commerce Phase 3 — Batch B15 (EC30 + EC31) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (B14 HEAD `999600b`-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase3-Plan-2026-10-13.md` — EC30 (Delivery Pricing Engine v2) + EC31 (Installment / কিস্তি Plans)।

## কমিট

| Hash | বিষয় |
|---|---|
| `0a1b58c` | Schema + migrations `20261013570000_ec30_delivery_pricing`, `20261013580000_ec31_installments`; StorefrontModule ShopAccountService export করে (shared `sendShopSms`-এর জন্য) |
| `ca1a948` | EC30 API: DeliveryPricingService + storefront/landings/orders/fulfillment integration + specs |
| `fcc698d` | EC30 API: staff controller endpoints (rate-rules / pickup-points) + DTOs + module provider |
| `a9c281a` | EC31 API: InstallmentsService + controller + DTO + specs |
| `81ffd94` | EC31 wiring: `installment_due_sweep` job type + template + Automation dispatch; module imports |
| `4e560fb` | Coordinator wiring: trackOrder `installmentSummary` + public pickup-points list endpoint (+ specs) |
| `0203628` | EC30 web: shop-i18n pickup/installment keys (bn+en) + storefront staff rate-rules/pickup-points sections |
| `f023131` | EC30+EC31 web: checkout method toggle + pickup picker, success pickup block, track pickup + installment summary |
| `b3aee26` | EC31 web: order detail installment section, pickup chip/detail, installments page, commerce hub link |
| (এই কমিট) | এই acceptance ডক |

## EC30 — Delivery Pricing Engine v2

- **Weight-slab rules (`ShippingRateRule`):** pure helper `cartWeightOf` — কার্টের মোট ওজন শুধুমাত্র তখনই জানা যখন **প্রতিটি** লাইনের পণ্যে `weightGrams` আছে; একটি লাইনে না থাকলে ওজন `null` এবং ওজন-সীমাবদ্ধ rule কখনো match করে না — **ওজন অনুমান করা হয় না**। Bundle component লাইনগুলো আসল পণ্য বলে ওজনে গণনা হয়; bump pseudo-line লাইনে নেই বলেই বাদ। `ruleMatches`: zone মিল (rule zone null = সব জোন) + সীমা **inclusive** (min ও max দুটোই)। `matchRule`: active rules, priority DESC → createdAt ASC, প্রথম match জেতে এবং zone-এর flat charge **replace** করে। কোনো rule না মিললে / service না থাকলে legacy flat charge হুবহু আগের মতো (parity spec)।
- **একটাই resolution পথ:** `StorefrontService.resolveDeliveryCharge` — shop `computeQuote` এবং landing checkout দুটোই এটা দিয়েই ডেলিভারি চার্জ নির্ধারণ করে (landing-এ পুরনো harness-এর জন্য `typeof` guard + legacy fallback)। Landing-এ ওজন = একক পণ্যের `weightGrams × qty`।
- **Free-shipping threshold:** `ShippingZone.freeAboveMinor` EC8 থেকেই ছিল — এই ব্যাচে নতুন হলো এর **প্রমাণ-সহ প্রয়োগ ও stamp**: judged হয় evaluator-পরবর্তী discounted subtotal-এ (subtotal − promotions/coupon/referral discount; delivery ও exclusive-tax সমন্বয়ের আগের goods-payable), `==` হলেও qualify করে (spec)। Threshold জিতলে চার্জ 0 এবং order-এ `freeShippingApplied = true` + `freeShippingZoneId` stamp; সেই ক্ষেত্রে `shippingRateRuleId` null থাকে — চূড়ান্ত চার্জ rule দেয়নি, threshold দিয়েছে (code comment-এ নথিভুক্ত)। Coupon free-shipping আগের মতোই আলাদাভাবে 0 করে (তার stamp promotions/discount রেকর্ডেই থাকে)।
- **Order stamps:** `deliveryMethod` (`home`|`pickup`), `pickupPointId`, `freeShippingApplied`, `freeShippingZoneId`, `shippingRateRuleId` — shop checkout-এ stamp হয়; landing order-এ delivery provenance stamp হয় (পদ্ধতি সবসময় home)।
- **Pickup points (`PickupPoint`):** staff CRUD (storefront settings API + UI)। Shop checkout-এই শুধু (v1): method `pickup` বাছলে server point validate করে (org-এর + active না হলে verbatim 400 "পিকআপ পয়েন্টটি পাওয়া যায়নি বা বন্ধ আছে — অন্য পয়েন্ট বেছে নিন"), ডেলিভারি চার্জ = point-এর নিজের `feeMinor` — **weight rule, zone charge, free-above threshold, coupon free-shipping কোনোটাই pickup fee-তে প্রযোজ্য নয়** (point-এর ফি ডেলিভারি চার্জ নয় — নথিভুক্ত সিদ্ধান্ত)। Slot picker pickup-এ লুকানো থাকে। Public picker feed: `GET /public/shop/:orgSlug/pickup-points` (active only, public outlet তথ্য মাত্র)। Staff order detail + list-এ pickup chip/line (deliverySlot-এর প্যাটার্নেই `pickupPointForOrder`), pick/pack (dispatch) board-এ `pickupPointName` (bulk-resolved, failure-isolated — point মুছে গেলেও board ভাঙে না)। EC18 tracking response-এ `deliveryMethod` + pickup point-এর name/address/district/phone (point নিষ্ক্রিয় হয়ে গেলেও দেখায় — গ্রাহক সেখান থেকেই সংগ্রহ করবে)।
- **সিঙ্গল checkout:** zone-ভিত্তিক নয় (BusinessProfile চার্জ) — EC30 সেখানে প্রযোজ্য নয়, আগের আচরণই (নথিভুক্ত)।

## EC31 — Installment (কিস্তি) Plans

- **মডেল:** `InstallmentPlan` (orderId UNIQUE, `totalMinor` = তৈরির মুহূর্তে অর্ডারের **amountDue-এর snapshot**) + `InstallmentItem` (seq, dueDate, amountMinor, paidMinor, paidAt) + `PaymentVerification.installmentItemId`।
- **Split math:** `base = floor(total / count)`; **প্রথম** কিস্তি = base + remainder; বাকি সব base — যোগফল হুবহু total (identity spec: 100000/3 → 33334/33333/33333)। `base = 0` হলে (বকেয়া কিস্তি-সংখ্যার চেয়ে কম) 400। Due date: startDate-এর ঢাকা-দিন + (seq−1) × intervalDays; সংরক্ষণ UTC midnight-এ, সব তুলনা Asia/Dhaka **day-string** দিয়ে।
- **Collections = EC19-এর একই রেকর্ড:** collect করলে ঠিক EC19 আকৃতির approved `PaymentVerification` তৈরি হয় (`source: "installment"`, `installmentItemId` সহ, duplicate-approved-TrxID guard হুবহু একই বার্তায়) — ফলে **অর্ডারের `amountDueMinor` একই পরিমাণে কমে যায়, গঠনগতভাবেই** (coherence spec: fake-এর approved rows থেকে due পুনঃহিসাব করে প্রমাণিত)। Partial collect যায়; item পুরো হলে `paidAt`; সব item পুরো হলে plan `completed`। Overpay (item-এর বাকির বেশি) 400, দুই পরিমাণই বার্তায়।
- **সিদ্ধান্ত (নথিভুক্ত):** কিস্তি **যেকোনো ক্রমে** collect করা যায় — sequence gate নেই (বাংলাদেশের বাস্তব চর্চা: গ্রাহক যেটা দেয় সেটাই জমা হয়); plan সম্পূর্ণ হয় সব item পুরো হলেই। **এক অর্ডারে জীবনে একটি plan** (orderId unique): সক্রিয় plan থাকলে 400, সম্পূর্ণ/বাতিল plan থাকলেও নতুন plan হয় না — বাতিল plan-এর জমা টাকা verification হিসেবে থেকেই যায়, due কমেই থাকে (cancel টাকা ফেরত দেয় না, শুধু schedule থামায়)।
- **Refusals:** due = 0 ⇒ 400 "এই অর্ডারে বকেয়া নেই — কিস্তি প্ল্যান দরকার নেই"; count 2–24 / interval 1–90-এর বাইরে 400; বিদেশী অর্ডার 404 (OrdersService-এর একই বার্তা)।
- **Reminders:** নতুন job type `installment_due_sweep` (template-সহ, প্রতি ৬০ মিনিটের template, per-org enable অন্যান্য sweep-এর মতোই)। অবস্থা: dueDay ∈ [today, today+2] ⇒ `due_soon`; dueDay < today ⇒ `overdue`। প্রতিটি item-এর প্রতিটি অবস্থায় **ঠিক একবার** attempt — stamp (`dueSoonRemindedAt/Status`, `overdueRemindedAt/Status`) attempt-এর সব ফলেই বসে (EC28-এর stock-alert শৃঙ্খলার মতো): SMS গেলে `sent`, org/platform SMS config না থাকলে বা গ্রাহকের ফোন না থাকলে `failed_no_channel` + কারণ — **কখনো "sent" দাবি নয়, নীরব retry-ও নয়**; staff plan-এ status দেখতে পান। প্রতিটি attempt-এ audit (`installments.reminder`, entity InstallmentItem, metadata-তে state/status) লেখা হয়; per-item failure-isolation। পাঠানো হয় EC28-র **একই** `sendShopSms` helper দিয়ে — দ্বিতীয় sender নেই।
- **Staff UI:** order detail-এ কিস্তি section (create form / schedule table + অবস্থা pill — service-এর `fullyPaid`/`overdue` flag-ই প্রাধান্য পায় / per-item collect form — advance form-এর একই method তালিকা / cancel with confirm); commerce-এ নতুন **কিস্তি পেজ**: আজকের due ও অতিবাহিত worklist (`installments/due?bucket=`) + status filter-সহ সব প্ল্যানের তালিকা; hub link যোগ হয়েছে।
- **Customer view:** EC18 tracking response-এ `installmentSummary` — শুধু **সক্রিয়** plan থাকলে: `{ totalInstallments, paidInstallments, nextDueDate, nextDueAmountMinor, remainingMinor }`; track পেজে প্রদর্শিত। একই phone+order-number matcher-এর ভিতরেই — আলাদা কোনো প্রবেশপথ নেই।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **312 suites / 3126 tests** — ৫টি chunk-এ (sandbox-এ একক রান OOM-প্রবণ, আগের ব্যাচগুলোর মতো)। Baseline 309/3075 ⇒ +3 suite/+51 test (ec30 24, ec31 21, ec31-tracking 6)। কোনো flake এই run-এ দেখা যায়নি |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ **36 files / 230 tests** (shop-i18n parity — নতুন pickup/installment keys bn+en দুটোতেই — সহ) |
| Web tsc | ✅ exit 0 |
| Build | ✅ `pnpm -r build` **exit 0** — ৭ প্যাকেজ Done; web route table-এ `/dashboard/commerce/installments`, `/shop/[orgSlug]/checkout`, `/track/[orgSlug]` উপস্থিত |
| Prisma validate | ✅ exit 0 |
| **Fresh-DB migration sequence** | ✅ **149/149 clean** — throwaway PostgreSQL 16 (local binary, `su postgres`, /tmp cluster)-এ পুরো sequence `prisma migrate deploy` exit 0; `_prisma_migrations`-এ 149 finished, 0 unfinished; **198টি টেবিল** (আগের 194 + ShippingRateRule + PickupPoint + InstallmentPlan + InstallmentItem); Order-এর ৫টি EC30 কলাম ও `PaymentVerification.installmentItemId` উপস্থিত যাচাইকৃত। Cluster পরে মুছে ফেলা হয়েছে |

## Migration ও deploy নোট

- `20261013570000_ec30_delivery_pricing` — 2টি নতুন টেবিল + Order-এ ৫টি কলাম (deliveryMethod default 'home', বাকি nullable/default false)। `20261013580000_ec31_installments` — 2টি নতুন টেবিল + `PaymentVerification.installmentItemId` + index। Tree-তে মোট এখন **149টি migration**, সবই additive। **কোনো আসল DB-তে এখনো একটিও চালানো হয়নি** — deploy-এ `migrate deploy` বাধ্যতামূলক।
- নতুন job: `installment_due_sweep` — per-org template থেকে install না করলে reminder sweep চলবে না (অন্যান্য sweep-এর মতোই)।
- নতুন env লাগে না।

## সৎ সীমা

- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত। কোনো আসল SMS কখনো পাঠানো হয়নি: installment reminder org-এর আসল MessagingSenderConfig/platform SMS config-এর উপর নির্ভরশীল; config না থাকলে সৎ `failed_no_channel`-ই production আচরণ। M30/EC12 live sprint এখনো খোলা।
- **Weight rule কেবল ততটাই ভালো যতটা merchant পণ্যের ওজন (`weightGrams`) দিয়েছেন** — ওজন না থাকা লাইন থাকলেই ওজন-rule নীরবে অপ্রযোজ্য (flat charge-এ fallback); কোনো সতর্কীকরণ UI এই ব্যাচে যোগ হয়নি।
- **Pickup শুধু shop checkout-এ** (v1) — landing ও single checkout-এ home delivery-ই একমাত্র পথ। Pickup অর্ডারে delivery slot বাছাই করা যায় না।
- **Free-above threshold judged হয় discounted subtotal-এ** — gift wrap fee ও delivery নিজে এই হিসাবে ঢোকে না; exclusive VAT threshold-এর হিসাবে ঢোকে না (goods-payable-ই ভিত্তি, নথিভুক্ত সংজ্ঞা)।
- **এক অর্ডারে একটিই installment plan (জীবনে)** — বাতিল plan-এর পর একই অর্ডারে নতুন plan তৈরি করা যায় না (v1 সীমা, উপরে নথিভুক্ত)। Plan-এর `totalMinor` snapshot — plan তৈরির পর অর্ডারে নতুন advance জমা হলে schedule নিজে থেকে বদলায় না (due দুটো হিসাবেই কমে, কিন্তু কিস্তির অঙ্ক আগের মতোই থাকে; staff চাইলে plan বাতিল করে থামাতে পারেন, নতুন বানাতে পারেন না)।
- **Reminder exactly-once মানে attempt-once:** SMS ব্যর্থ হলেও (`failed_no_channel`/`failed`) সেই অবস্থার জন্য আর পাঠানো হয় না — channel পরে ঠিক হলে পুরনো অবস্থার reminder আর যাবে না (পরের অবস্থা — যেমন overdue — তার নিজের attempt পাবে)।
- **Screenshot QA হয়নি** — sandbox-এ live app নেই; নতুন UI build + typecheck-প্রমাণিত, চোখে দেখা নয়।
