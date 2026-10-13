# E-Commerce Phase 3 — Program Summary (EC25–EC34)

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (Phase 2 HEAD `a029713`-এর উপর; Phase 3 একই branch-এই এগিয়েছে) · **স্ট্যাটাস:** **CODE-COMPLETE** — লোকাল কমিট পর্যন্ত, **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase3-Plan-2026-10-13.md` · ব্যাচভিত্তিক acceptance: `docs/ecommerce-b12..b16-acceptance.md`।

## ব্যাচভিত্তিক যা তৈরি হলো

| ব্যাচ | প্যাকেজ | সারসংক্ষেপ |
|---|---|---|
| B12 | EC25 + EC29 | **EC25 (= বকেয়া EC17):** storefront OTP login (hash করা code, 5-মিনিট মেয়াদ, attempt cap; org-এর আসল SMS config না থাকলে সৎ 400 — ভুয়া send নয়), org-scoped hashed session, account orders/reorder, address book, price snapshot-সহ wishlist ও আসল price-drop badge। **EC29:** fixed-price bundle (component allocation-এর যোগফল হুবহু bundle price; একটি component stock-out হলে পুরো checkout refuse), gift promotion + gift wrap। |
| B13 | EC26 + EC33 | **EC26:** courier COD reconciliation — settlement sheet CSV import, (org, courier) header mapping, 6 ধরনের line outcome; `codCollected*` শুধু reconciliation বা staff accept_sheet দিয়েই বসে (delivered মানেই collected নয় — EC23-এর ফাঁক বন্ধ); accounting-এ courier-collections export। **EC33:** delivered-bucket "sold" সংজ্ঞায় velocity, reorder v2 = ceil(dailyVelocity × leadTimeDays) − stock, dead-stock রিপোর্ট, costed-stock-only valuation (coverage count দৃশ্যমান)। |
| B14 | EC27 + EC28 | **EC27:** EC8-র sitemap machinery ঠিক করে আসল `updatedAt` lastmod, per-shop robots.txt, JSON-LD (aggregateRating শুধু EC15 summary count > 0 হলেই), shop search (bounded ACTIVE scan-এ in-memory contains — FTS নয়, সৎভাবে নথিভুক্ত), আসল sold সংজ্ঞায় bought-together। **EC28:** InventoryService-এর 0→>0 hook থেকে back-in-stock alert (exactly-once, failure-isolated), `wishlist_price_alert_sweep` job (failed_no_channel price point খরচ করে না), tracking matcher দিয়ে customer self-service RMA (source=customer), product Q&A (phone কখনো public নয়), একটি মাত্র `sendShopSms` helper (EC25 OTP-ও সেটাতেই)। |
| B15 | EC30 + EC31 | **EC30:** weight-slab shipping rule (সব লাইনের ওজন জানা থাকলেই প্রযোজ্য — অনুমান কখনো নয়), zone free-shipping threshold-এর প্রমাণসহ প্রয়োগ + stamp, pickup point (নিজের fee-ই চার্জ; weight rule/threshold pickup-তে প্রযোজ্য নয়), একটি মাত্র `resolveDeliveryCharge` পথ shop + landing-তে। **EC31:** installment (কিস্তি) plan — split math-এর যোগফল হুবহু amountDue snapshot, collection = EC19-এর একই approved PaymentVerification (তাই due গঠনগতভাবেই কমে), `installment_due_sweep` reminder (প্রতি item প্রতি state-তে ঠিক একবার attempt; channel না থাকলে সৎ failed_no_channel)। |
| B16 | EC32 + EC34 | **EC32:** affiliate program (EC16 referral থেকে সম্পূর্ণ আলাদা) — `?ref` attribution (window client-side, যাচাই server-side), sold-bucket commission exactly-once, round-half-up, cancel/full-refund void (paid কখনো নয়), **payout শুধু bookkeeping record** — সিস্টেম টাকা পাঠায় না; FIFO paid marking। **EC34:** POS quick-sale — DTO-তে price ফিল্ডই নেই (দাম server-side), একই evaluator দিয়ে promotion/coupon/tax, upsertOrder "pos" পথে placement + completed, paid = source "pos" approved verification, 80mm receipt, আজকের বিক্রির strip। |

## Migration তালিকা — Phase 3 (সবগুলোই additive; কোনোটিই কোনো আসল DB-তে চালানো হয়নি)

| Migration | বিষয় |
|---|---|
| `20261013510000_ec25_storefront_accounts` | ShopOtpChallenge, ShopSession, CustomerAddress, WishlistItem |
| `20261013520000_ec29_bundles_gifts` | Bundle সংক্রান্ত টেবিল + Order/OrderItem/StorefrontSetting additive কলাম |
| `20261013530000_ec26_cod_reconciliation` | CourierShipment-এ codCollected* + reconciliation টেবিলসমূহ |
| `20261013540000_ec33_inventory_intelligence` | InventorySetting (leadTimeDays) |
| `20261013550000_ec27_seo_discovery` | **comment-only** (EC27 সম্পূর্ণ read-time computed) — sequence-এর ধারাবাহিকতার জন্য রাখা |
| `20261013560000_ec28_retention` | StockAlertSubscription, ProductQuestion + WishlistItem/ReturnRequest কলাম |
| `20261013570000_ec30_delivery_pricing` | ShippingRateRule, PickupPoint + Order-এ 5টি কলাম |
| `20261013580000_ec31_installments` | InstallmentPlan, InstallmentItem + PaymentVerification.installmentItemId |
| `20261013590000_ec32_affiliate_program` | AffiliatePartner, CommissionEntry, AffiliatePayout + Order/StorefrontSetting কলাম |
| `20261013600000_ec34_pos` | **index-only** (Order org+source+createdAt) |

Tree-তে মোট migration এখন **151টি**। প্রতিটি ব্যাচের শেষে fresh-DB পূর্ণ-sequence যাচাই হয়েছে (B13-তে 145/145, B14-এ 147/147, B15-এ 149/149, B16-এ **151/151 clean**, 201টি টেবিল) — কিন্তু **কোনো migration-ই আসল production DB-তে কখনো চালানো হয়নি**; deploy-এ `prisma migrate deploy` বাধ্যতামূলক, এবং তার আগে production-এর বর্তমান অবস্থার সঙ্গে একবার মিলিয়ে দেখা উচিত (cx7-এর শিক্ষা)।

## Deploy checklist (Phase 3-নির্দিষ্ট)

1. `prisma migrate deploy` — Phase 3-র 10টি migration (`20261013510000`–`20261013600000`) সহ পুরো sequence।
2. **Per-org job enable** (অন্যান্য sweep-এর মতো template থেকে install না করলে চলবে না):
   - `wishlist_price_alert_sweep` (EC28 — price-drop alert)
   - `installment_due_sweep` (EC31 — কিস্তি reminder; template interval ৬০ মিনিট)
   - (EC24c-র `commerce_subscription_sweep` Phase 2 থেকেই এই তালিকায় আছে।)
3. **EC25 OTP-র SMS নির্ভরতা:** storefront OTP login কাজ করবে শুধু org-এর MessagingSenderConfig (tenant SMS gateway) অথবা platform SMS config থাকলে — কোনোটিই না থাকলে login সৎভাবে 400 দেবে ("SMS সেটআপ নেই"), কখনো ভুয়া send দেখাবে না। Merchant onboarding-এ এই dependency আগেই জানানো উচিত।
4. EC32 affiliate: কোনো env/job লাগে না (event-driven); প্রোগ্রাম চালু করা merchant-এর সিদ্ধান্ত (StorefrontSetting.affiliateEnabled, default false)।
5. EC34 POS: কোনো env/job লাগে না; staff-এর "orders" permission area-তেই চলে।

## Carry-forward সৎ সীমা (ব্যাচ acceptance থেকে জমা)

- **Live প্রমাণ পুরো Phase 3-তেই নেই** — সব fixture/spec-প্রমাণিত; কোনো আসল SMS, courier sheet, affiliate অর্ডার বা POS বিক্রি বাস্তবে হয়নি। Screenshot QA-ও হয়নি (নতুন UI build + typecheck-প্রমাণিত মাত্র)।
- **EC26** শিটের মানের উপরই নির্ভরশীল — ভুল পরিমাণ amount_mismatch হিসেবে দৃশ্যমান থাকে, সিস্টেম courier-এর টাকা independently যাচাই করতে পারে না; কোনো courier API দাবি করা হয়নি। Collection তারিখ শিটে থাকলেও পড়া হয় না (import-এর মুহূর্তই stamp)।
- **EC28/EC31 reminder exactly-once মানে attempt-once:** channel ব্যর্থ হলে (failed_no_channel/failed) সেই state-এর জন্য আর পাঠানো হয় না। Price-drop alert sweep-নির্ভর (দাম বদলের সঙ্গে সঙ্গে যায় না; template interval ৬০ মিনিট)।
- **EC27** sitemap-এর scan cap (12,000 পণ্য) EC8 থেকেই চলে আসছে; bought-together বড় order ইতিহাসে ভারী হতে পারে (cache/index যোগ হয়নি); shop search FTS নয়।
- **EC29** bundle শুধু shop checkout-এ; gift line placement shop + single-তে (landing-এ stamp/item নেই, প্রতিশ্রুতিও দেখানো হয় না)।
- **EC30** weight rule ততটাই ভালো যতটা merchant `weightGrams` দিয়েছেন — ওজনহীন লাইন থাকলেই rule নীরবে অপ্রযোজ্য (সতর্কীকরণ UI নেই)। Pickup শুধু shop checkout-এ; pickup অর্ডারে delivery slot বাছা যায় না।
- **EC31** এক অর্ডারে জীবনে একটি plan — বাতিল plan-এর পর নতুন plan হয় না; plan তৈরির পর অর্ডারে advance জমা হলে schedule নিজে বদলায় না (due কমে, কিস্তির অঙ্ক থাকে)।
- **EC32** attribution window browser localStorage-নির্ভর (browser বদলালে হারায়); partial refund-এ commission pro-rate হয় না; paid entry refund হলেও auto-void হয় না (partner detail-এ flag count-ই একমাত্র সতর্কতা); commission-এর কোনো backfill sweep নেই।
- **EC33** velocity/forecast সবসময় আনুমানিক — মৌসুম/প্রচারণা ধরে না; valuation শুধু costed stock-এর (coverage count দেখানো হয়)।
- **EC34** offline মোড নেই; POS অর্ডারের `deliveryMethod` ডিফল্ট মান অর্থহীন; barcode hardware live যাচাই হয়নি (keyboard-wedge Enter pattern ধরা হয়েছে)।

## দাঁড়িয়ে থাকা open item (মালিকের সিদ্ধান্ত/কাজ ছাড়া এগোবে না)

- **EC12 live verification এখনো সম্পূর্ণ খোলা** — Phase 1–3-র কোনো feature-ই আসল Woo/Shopify স্টোরে live-প্রমাণিত নয়; CP2/CP3-health/CP4 (Phase 2) বিশেষভাবে LIVE-PENDING।
- **Phase 2 ও Phase 3 দুটোই unpushed** — `ec-phase2` branch-এ লোকাল কমিটে আছে; push শুধু মালিকের স্পষ্ট নির্দেশে। Push-এর সময় Connect Center track-এর সঙ্গে integration লাগবে (migration timestamp range আগেই ledger-এ ভাগ করা: EC Phase 3 = `20261013500000+`, Connect Center = `20261013310000+`)।
- কোনো Phase-3 migration-ই **আসল production DB-তে চালানো হয়নি** — প্রথম deploy-ই হবে তাদের প্রথম আসল পরীক্ষা; উপরের checklist অনুযায়ী এগোনো উচিত।
- Frontier (মালিকের আলাদা সিদ্ধান্ত ছাড়া নয়): native checkout-এ online payment (Connect Center CC9/CC10-র বিষয়), multi-vendor marketplace, gift-card/loyalty wallet।
