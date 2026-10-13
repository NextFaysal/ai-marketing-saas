# E-Commerce Phase 2 — Program Summary (EC13–EC24 + CP)

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1` = EC1–EC12 integrated release + cx7 migration fix) · **স্ট্যাটাস:** **CODE-COMPLETE** — সব ব্যাচ (B7–B11) লোকাল কমিট পর্যন্ত শেষ, **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয় — স্থায়ী নিয়ম)।
**প্ল্যান:** `files/Ecommerce-Phase2-Plan-2026-10-13.md` · **ভিত্তি প্রোগ্রাম:** `docs/ecommerce-program-summary.md` (EC1–EC12)।

## ব্যাচ মানচিত্র

| ব্যাচ | প্যাকেজ | এক লাইনে | Acceptance |
|---|---|---|---|
| B7 | EC13 + EC15 | Landing/funnel builder (A/B variant, post-purchase upsell) + reviews engine (Woo pull, unified display, moderation) | `ecommerce-b7-acceptance.md` |
| B8 | EC18 + EC19 (+Part 0 fix) | Branded tracking page, delivery slots, checkout trust + shop polish (advance = PaymentVerification, top-sellers featured, bn/en i18n) + **live checkout delivery-fee বাগের fix** | `ecommerce-b8-acceptance.md` |
| B9 | EC14 + EC16 | Product feeds (Meta/Google) + promotions v2 (একটাই evaluator, তিন checkout-এ parity)। TikTok Shop / Daraz = গবেষণা-ভিত্তিক **NO-BUILD** | `ecommerce-b9-acceptance.md`, `ec14-marketplace-research.md` |
| B10 | EC20 + EC21 + EC22 | Purchasing/suppliers (weighted-average cost), warehouse bins + stock count, courier auto-select rules + own-rider | `ecommerce-b10-acceptance.md` |
| B11 | EC23 + EC24 + CP | Tax/VAT + fiscal invoice নম্বর + accounting exports; pre-order/digital/subscription/wholesale; EC1–EC12-এর জমা সীমা বন্ধ (field-level conflict, staged upload, weight unit, partial restock, batch push, GDPR erasure) | `ecommerce-b11-acceptance.md` |

## প্যাকেজভিত্তিক যা এল

- **EC13**: LandingPage/Variant/Event; visitor-hash A/B; landing checkout আসল checkout নিয়মেই; upsell শুধু open-status/no-fulfillment/2h window-এ, stock-first।
- **EC14**: ProductFeed token URL (Meta/Google RSS-XML, per-request আসল পণ্য থেকে; GTIN শুধু আসল barcode থাকলে)। TikTok channel = সৎভাবে লেবেল করা generic CSV export, integration নয়।
- **EC15**: Unified public reviews (নিজের + external), Woo review pull, Shopify probe সৎভাবে `unsupported_no_reviews_source`; moderation + staff reply। Review-request automation CX12b-র বিদ্যমান toggle-ই (default OFF) — duplicate বানানো হয়নি।
- **EC16**: `PromotionsService.evaluateCheckout` — BOGO/tiered/flash + EC7 coupon + referral (নতুন `Customer.referralCode`), stacking rule spec-প্রমাণিত, তিন checkout-এ হুবহু একই মোট।
- **EC18**: Tracking lookup phone+order number matching (constant-shape error, PII ফাঁস নেই); DeliverySlot capacity (পূর্ণ স্লটে অর্ডার লেখা হয় না); trust fields শুধু merchant সেট করলেই দেখায়।
- **EC19**: Staff advance = approved PaymentVerification rows; featured `top_sellers` mode; shop bn/en dictionary। **Part 0**: `products.service.ts`-এর অস্তিত্বহীন `insideDhakaFeeMinor` read-এর কারণে live checkout সবসময় default ৳60 নিত — তিনটি read site-ই আসল `deliveryChargeInside/OutsideMinor`-এ fixed।
- **EC20**: Supplier + PurchaseOrder + receive (S1 ledger পথেই, weighted-average ProductCost); reorder suggestions (সরল threshold নিয়ম)।
- **EC21**: Warehouse/Bin/Assignment (move semantics), pick list-এ bin code + walk order, stock count (counted লাইনই adjust হয়), নিজে লেখা CODE128-B দিয়ে label print।
- **EC22**: CourierRule (district/ওজন/COD/payment) booking-এ suggestion/preselect, explicit choice সবসময় জেতে; tracking URL template; own-rider assignment board (delivered ⇒ order completed)।
- **EC23**: TaxSetting (bps rate), inclusive/exclusive VAT evaluator-র শেষ ধাপে, per-rate `taxBreakdown`; fiscal invoice নম্বর (BD FY Jul–Jun, atomic counter); sales/tax/due CSV exports।
- **EC24**: Pre-order (limit + no-decrement rule), digital (delivery-পরবর্তী counted reveal), subscription (staff-created, COD renewal sweep, snapshot price), wholesale tiers (শুধু চেনা wholesale customer, shop checkout)।
- **CP**: Field-level conflict resolution; Shopify staged uploads; Woo per-store weight unit; Shopify partial restock; Woo batch push (≤50); GDPR deep erasure (staff + Shopify redact hook)।

## Migration তালিকা — Phase 2-এর 12টি (সব additive)

`20261013190000_ec13_landings` · `20261013200000_ec15_reviews` · `20261013210000_ec18_delivery_slots_tracking` · `20261013220000_ec19_shop_polish` · `20261013230000_ec14_product_feeds` · `20261013240000_ec16_promotions` · `20261013250000_ec20_purchasing` · `20261013260000_ec21_warehouse` · `20261013270000_ec22_delivery_ops` · `20261013280000_ec23_tax_accounting` · `20261013290000_ec24_product_expansion` · `20261013300000_cp_completion`

**এগুলোর একটিও কোনো আসল DB-তে চালানো হয়নি।** Tree-তে মোট migration 141টি; deploy-এর আগে পুরো sequence fresh DB-তে যাচাই করা উচিত (cx7 শিক্ষা — merged-track migration আগে থেকে apply করে দেখা)।

## চূড়ান্ত গেট (B11 শেষে, coordinator-যাচাইকৃত)

- API jest **299 suites / 2939 tests** (একটিমাত্র load-timeout flake `u4-channels` — standalone 7/7 ×2; Phase-2 শুরুর baseline ছিল 272/2625 ⇒ মোট +27 suite / +314 test)
- Web vitest **217/217** · API tsc **0** · Web tsc **0** · `pnpm -r build` exit 0 (next build-সহ) · Prisma validate ✅

## Deploy checklist (মালিকের push নির্দেশের পর)

1. মালিকের নির্দেশে integration + push (আগে remote fetch — মালিক নিজেও push করেন)।
2. Dokploy Redeploy; API startup-এ `prisma migrate deploy` (Phase 2-এর 12টি-সহ সব pending migration)।
3. Per-org jobs enable: `sync_outbox_process`, `sale_schedule_sweep`, **`commerce_subscription_sweep`** (নতুন), courier/review sweep-গুলো যেখানে লাগে।
4. Env: `API_PUBLIC_URL` (webhook/feed URL), `API_INTERNAL_URL` (custom domain routing) আগের মতোই।
5. Per-store সিদ্ধান্ত: refund push toggle (default OFF-ই থাকবে), Store weight unit (health check নিজে পড়বে, প্রয়োজনে manual override), TaxSetting (VAT হার সেট না করলে tax OFF — checkout অপরিবর্তিত)।

## সৎ সীমা — পুরো প্রোগ্রাম জুড়ে

- **EC12 live verification এখনো সম্পূর্ণ খোলা**: আসল WooCommerce/Shopify স্টোর দিয়ে কোনো Phase-2 feature-ই live-প্রমাণিত নয়। সবকিছু fixture/spec-প্রমাণিত। CP2 (staged upload), CP3-এর health-read, CP4 (partial restock) বিশেষভাবে **LIVE-PENDING**।
- **Feeds** কোনো merchant এখনো Meta/Google-এ live জমা দিয়ে যাচাই করেননি — format spec-প্রমাণিত মাত্র। **Marketplace**: TikTok Shop BD local-seller market-ই নয়; Daraz-এর public BD seller API নেই — দুটোই NO-BUILD সিদ্ধান্ত নথিভুক্ত।
- **Carry-forward caveat**: EC18 slot capacity v1-এ pre-check মাত্র (যুগপৎ checkout-এর race, DB lock নেই); EC21 stock-count delta snapshot-ভিত্তিক (গণনার মাঝে স্টক নড়লে balance সরতে পারে); EC24c renewal order-এ delivery charge ও customer notification নেই; EC23 due export-এ courier COD collection section নেই (collected marker-ই নেই); CP6-তে ExternalReview redact শুধু authorName exact-match-এ (মডেলে অন্য link নেই)।
- **Browser QA হয়নি** — কোনো batch-এই live app-এ screenshot-ভিত্তিক যাচাই হয়নি; শুধু build + spec + tsc গেট।
- Tenant online payment gateway এই প্রোগ্রামেও **postponed-ই** আছে (মালিকের সিদ্ধান্ত) — subscription COD/manual-ই, কোনো auto-charge দাবি করা হয়নি।
