# E-Commerce Phase 2 — Batch B11 (EC23 + EC24 + CP) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1`, B10-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase2-Plan-2026-10-13.md` §১০ EC23 + §১১ EC24 + §১২ CP।

## কমিট (15)

| Hash | বিষয় |
|---|---|
| `58390b7` | B11 schema + migrations `20261013280000_ec23_tax_accounting`, `20261013290000_ec24_product_expansion`, `20261013300000_cp_completion` |
| `3111122` | EC23 tax core — pure computeTax + evaluator wiring + তিন checkout + Product taxRateBps DTO |
| `149a76d` | EC23 tax module — TaxSetting API + invoice numbering + accounting exports |
| `429f013` | EC23 web — accounting পেজ + print invoice + product VAT field |
| `55582cb` | EC23 fix — landings response totals-এর pre-EC23 exact shape পুনরুদ্ধার (order-এ tax লেখা থাকে) |
| `ae4d58f` | CP1 — field-level sync conflicts (fieldDiffs + per_field resolution + Sync Center UI) |
| `35c0101` | CP2 — Shopify staged uploads |
| `32feb1d` | CP3 — Woo per-store weight unit |
| `7806796` | CP4 — Shopify partial restock on returns |
| `bdf07b2` | CP5 — multi-product batch push |
| `3afa629` | CP6 — GDPR deep erasure |
| `3a4719c` | EC24a — pre-order |
| `1760fe9` | EC24b — digital products |
| `8bce388` | EC24c — subscriptions (staff-created, COD/manual) |
| `8fab9b1` | EC24d — wholesale tiers + EC24 product form |

## EC23 — Tax & Accounting

- **TaxSetting** (নতুন মডেল, org-unique): legalName, tin, binVatNo, `defaultVatBps` (basis points — BD VAT-তে 7.5%-এর মতো ভগ্নাংশ হার whole-percent Int-তে ধরা যায় না বলেই bps), `pricesIncludeVat` (default true)। GET/PUT `commerce/tax-settings` (PUT শুধু OWNER/ADMIN, audit)। Row না থাকলে tax সম্পূর্ণ OFF।
- **Tax হিসাব** (`commerce/tax.ts` pure `computeTax` + evaluator-এর LAST step): প্রতি লাইনের কার্যকর হার = `Product.taxRateBps ?? defaultVatBps`। লাইন base = promotions/coupon/referral-পরবর্তী payable অংশ (discounted line totals-কে `merchandisePayable / postPromotionSubtotal` দিয়ে scale); bump শুধু org default rate-এ। **Inclusive**: `taxMinor` = মোটের ভিতরে থাকা VAT অংশ `base·bps/(10000+bps)` — মোট বাড়ে না। **Exclusive**: `base·bps/10000` মোটের উপর যোগ হয় (`taxAddedMinor`)। Rounding: **per-line round-half-up** (BigInt)। Order-এ `taxMinor` + `taxBreakdown` (per-rate snapshot) লেখা হয় — তিনটি checkout পথেই। **Parity**: tax config না থাকলে আচরণ byte-identical (spec-প্রমাণিত)।
- **Invoice নম্বর**: `InvoicesService.ensureInvoiceNumber` — BD fiscal year (Jul–Jun, Asia/Dhaka) অনুযায়ী `INV-<FY>-<seq 5-digit>`; `$transaction`-এ `InvoiceCounter` upsert + atomic `increment` + `invoiceNumber: null` guard-সহ order stamp (race-safe, code comment-এ documented)। Re-issue-তে একই নম্বর ফেরত (counter বাড়ে না)। `GET orders/:orderId/invoice` ensured নম্বর + seller legal/TIN/BIN (set থাকলেই) দেয়; print পেজ kind=invoice-তে তাই ব্যবহার করে।
- **Accounting exports** (`GET commerce/reports/accounting-export?type=sales|tax|due&from&to`, CSV): মেয়াদ validate (≤366 দিন, Bengali 400), Asia/Dhaka period। sales register-এ `amountDue` = EC19-এর approved-advance math (total − refunded − approved advances, floor 0)। tax summary per-rate aggregation; legacy order (breakdown নেই, taxMinor>0) সৎভাবে `"unknown"` rate-এ। **Courier COD collection section বানানো হয়নি** — `CourierShipment`-এ collected marker (flag/collectedAt) নেই, delivered মানেই cash collected-এর প্রমাণ নয়; invent করা হয়নি (code comment + spec-এ recorded)।
- **বিচ্যুতি**: taxBreakdown upsertOrder payload-এ field না থাকায় post-create stamp হয় (EC16 split-এর মতো failure-isolated প্যাটার্ন); landings placement response-এ tax fields নেই (exact-shape spec রক্ষায় — order-এ সব লেখা থাকে; storefront quote + single-checkout response-এ exposed)।

## EC24 — Product Model Expansion

- **(a) Pre-order**: নিয়ম — `preorderEnabled` পণ্য zero stock-এও অর্ডারযোগ্য; সেই লাইন `OrderItem.isPreorder=true`; `applyOrderPlaced` preorder লাইন সম্পূর্ণ skip করে (decrement/movement নেই)। `preorderLimit` shared helper-এ enforce হয় (open = isPreorder items, order status NOT IN cancelled/refunded/failed/completed; অতিক্রমে পুরো অর্ডার Bengali 400)। তিনটি public payload-এ `preorder {enabled, releaseDate}` + web badge। **সীমা**: products/landings পথে আগে থেকেই quantity-vs-stock gate ছিল না (শুধু storefront-এ ছিল) — normal পণ্যের আচরণ সেখানে অপরিবর্তিত রাখা হয়েছে।
- **(b) Digital**: `digitalFileUrl` merchant-hosted (file hosting বানানো হয়নি); public payload-এ কখনো serialize হয় না (spec-asserted) — শুধু `digital: true`। Reveal: `POST public/shop/:orgSlug/track/digital-access` (trackOrder-এর একই phone+order-number matching, একই constant error)। Delivery gate = order completed/delivered অথবা delivered Fulfillment; cap = digital পণ্যগুলোর min non-null `digitalAccessLimit` (সব null = unlimited); success-এ `digitalAccessCount` + `digitalLastAccessedAt` stamp। Tracking response-এ URL ছাড়া `digitalItems[{name, available}]`; তিনটি success screen-এ নোট + tracking পেজে "লিংক দেখুন"।
- **(c) Subscriptions**: **staff-created only v1** (storefront self-serve signup নেই)। `CustomerSubscription` — price/discount snapshot (source-order line > variant SKU > current product); sweep job **`commerce_subscription_sweep`** (নতুন JobType + template, 60min — SaaS billing-এর `subscription_sweep`-এর সঙ্গে নাম সংঘর্ষ এড়িয়ে) renewal order বানায় shared `upsertOrder` দিয়ে (source `subscription`, externalId `sub-<id>-<scheduled ISO>` = idempotent), discount = snapshot %; **shipping 0** (documented — renewal-এ delivery charge ধরা হয় না)। `nextRunAt` scheduled date থেকে এগোয় (drift নেই); failure-এ advance হয় না, `subscriptions.renewal_failed` audit, 5 বার ব্যর্থতায় auto-pause। **Customer notification বানানো হয়নি** — renewal order orders list-এই দৃশ্যমান; এটাই v1 রেকর্ড।
- **(d) Wholesale**: `Product.wholesaleTiers` server-validated (max 10, minQty ≥2 strictly ascending unique, priceMinor >0)। শুধু **shop checkout**-এ: phone-এ চেনা `Customer.isWholesale` হলে tier (highest minQty ≤ qty) regular/sale দাম **সম্পূর্ণ replace** করে evaluator-এর আগে — promotions তার উপরেই চলে (spec-প্রমাণিত)। `wholesaleBreakdown` order-এ stamp + response-এ `wholesaleApplied` + staff order detail-এ marker। Guest quote / single / landing-এ wholesale নেই (identity নেই)।

## CP — Platform Completion Pack

- **CP1 Field-level conflicts ✅**: creation-এ (`ListingsService.detectInboundConflict`) canonical fields (name, priceMinor, compareAtMinor, stockQuantity, status, imageUrl, description) জুড়ে শুধু ভিন্ন field-এর `fieldDiffs` সংরক্ষিত। Resolve-এ নতুন `per_field` mode — choices-এর exact coverage validate (missing/unknown field ⇒ field-এর নামসহ Bengali 400); remote-বাছাই field shared mapping দিয়ে Product-এ বসে, তারপর resolve → listing pending → forced push (keep_local-এর ক্রমেই, যাতে merged state read-back pipeline দিয়ে স্টোরে যায়)। পুরনো keep_local/take_remote অপরিবর্তিত। Sync Center-এ expandable per-field diff UI।
- **CP2 Shopify staged uploads ✅ — LIVE-PENDING**: off-CDN ছবি stagedUploadsCreate (IMAGE/PUT) → server-side byte fetch → raw PUT → resourceUrl বিদ্যমান `productSet` files slot-এই বসে। Per-image ব্যর্থতায় আগের URL pass-through-তেই fallback; ফলাফল push summary-তে `images: [{src, via: staged|url_fallback|cdn}]`। Fixture-প্রমাণিত মাত্র — আসল Shopify স্টোরে যাচাই হয়নি।
- **CP3 Woo weight unit ✅ — health-read LIVE-PENDING**: `weightInUnit` (g/kg/lb/oz; null = legacy kg) `Store.weightUnit` থেকে payload-এ। Health check `settings/general` থেকে `woocommerce_weight_unit` পড়ে বদলালে persist করে (failure-isolated)। Sync-mode surface-এ manual override + Sync Center select। Conversion fixture-প্রমাণিত; live Woo settings read যাচাই হয়নি।
- **CP4 Shopify partial restock ✅ — LIVE-PENDING**: return complete-এর পর failure-isolated hook — শুধু restock হওয়া পরিমাণ `inventoryAdjustQuantities` delta দিয়ে (partial restock স্বাভাবিকভাবে সম্ভব), inventory item listing-এর variant map থেকে, location default StoreLocation। ফলাফল `ReturnRequest.shopifyRestock {attempted, succeeded, qty, lines[]}`-তে; no-listing লাইন `reason: "no_listing"`। Non-Shopify অর্ডারে field null থাকে। Local flow কখনো block হয় না (spec-প্রমাণিত)।
- **CP5 Batch push ✅**: `POST products/push-batch` (max 50, খালি হলে 400) — প্রতি পণ্য একই single-push পথ (`enqueueProductPush`); per-item `not_found`/`no_listings` ফলাফল batch fail করে না; একটি audit। Products পেজে multi-select + "স্টোরে পাঠান" + outcome panel।
- **CP6 GDPR deep erasure ✅**: shared `ErasureService` (module cycle এড়াতে CustomersModule + IntegrationsModule দুই জায়গাতেই provided)। Orders-এর financial field অক্ষত, `address` null; CustomerStoreIdentity delete; AbandonedStoreCheckout email/phone match-এ delete; Customer row থাকে কিন্তু PII wipe (referralCode-সহ)। **ExternalReview সীমা**: মডেলে customerId/orderId/email field-ই নেই — একমাত্র link `authorName`; full name exact match হলেই redact (imageUrls review-সংযুক্ত পণ্যের ছবি, reviewer PII নয় — ছোঁয়া হয়নি)। Report + `customers.erase` audit; endpoint OWNER/ADMIN; Shopify `customers/redact` এখন local customer resolve করে একই erasure চালায় (HMAC/ack byte-identical)। **জানা সীমা**: Shopify path-এ audit actor `"shopify_gdpr"` AuditService-এর user FK-তে মেলে না বলে সেই একটি audit row silently skip হতে পারে (erasure ও GDPR audit অক্ষত) — CP builder flag করেছে, আচরণ বদলানো হয়নি।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full, 4 chunk) | ✅ **299 suites / 2939 tests** (baseline 289/2853 ⇒ +10/+86) — একটিমাত্র failure: `inbox/u4-channels` একটি test-এর 5s timeout, অত্যন্ত ভারী parallel load-এর মধ্যে (সেই run-এ অন্য suite 500s+ নিয়েছে); standalone পরপর 2 রানে **7/7 pass** — load flake, B11 inbox ছোঁয়নি। `cx3-debounce` এই run-এ pass। |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ **217/217** · Web tsc ✅ exit 0 |
| Build | ✅ `pnpm -r build` exit 0 (সব প্যাকেজ + next build Done; route table-এ `/dashboard/commerce/accounting` + `/dashboard/commerce/subscriptions`) |
| Prisma validate | ✅ exit 0 |

## Migration ও deploy নোট

- `20261013280000_ec23_tax_accounting`, `20261013290000_ec24_product_expansion`, `20261013300000_cp_completion` — সব additive; **কোনো আসল DB-তে চালানো হয়নি**; deploy-এ `migrate deploy` বাধ্যতামূলক।
- নতুন job: `commerce_subscription_sweep` — প্রতি org-তে Automations থেকে enable করতে হবে (অন্য sweep-গুলোর মতোই)। Tax চালু করা সম্পূর্ণ opt-in: TaxSetting-এ defaultVatBps সেট না করলে checkout আগের মতোই।
