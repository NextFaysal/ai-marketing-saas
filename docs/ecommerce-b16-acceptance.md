# E-Commerce Phase 3 — Batch B16 (EC32 + EC34) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (B15 HEAD `9ec405f`-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)। **Phase 3-এর শেষ ব্যাচ।**
**প্ল্যান:** `files/Ecommerce-Phase3-Plan-2026-10-13.md` — EC32 (Affiliate Program) + EC34 (POS / Quick-Sale)।

## কমিট

| Hash | বিষয় |
|---|---|
| `bb7de20` | Schema + migrations `20261013590000_ec32_affiliate_program`, `20261013600000_ec34_pos` (index-only) |
| `3ed3af4` | EC32 API: AffiliatesService + staff controller + settings round-trip + তিন checkout-এ affiliateCode wiring; 27 specs |
| `71cb46e` | EC32 web: অ্যাফিলিয়েট ড্যাশবোর্ড + commerce hub লিংক + `lib/affiliate-ref` shop/landing/checkout wiring |
| `768946c` | EC34 API: PosService + PosController + pos/search + pos/today + PosModule DI; 19 specs |
| `170d0c3` | EC34 web: POS পেজ + print পেজে `kind=receipt` + nav-এ POS এন্ট্রি |
| (এই কমিট) | এই acceptance ডক + Phase-3 program summary |

## EC32 — Affiliate Program

- **EC16 referral থেকে সম্পূর্ণ আলাদা:** referral = ক্রেতার নিজের code-এ ক্রেতার discount (Customer.referralCode); affiliate = staff-managed partner (`AffiliatePartner`), যার code অন্যের অর্ডারে commission তৈরি করে। দুটি ব্যবস্থা একে অপরকে ছোঁয় না।
- **Attribution:** shop ও landing পেজ `?ref=<code>` পড়ে localStorage-এ (org-প্রতি আলাদা key) `affiliateAttributionDays` (default 30) window-সহ রাখে; shop + landing + single — **তিনটি checkout-ই** `affiliateCode` পাঠায় (single checkout-ও PublicCheckoutOrderDto-তেই ফিল্ড পেয়েছে, পৃথক কাজ লাগেনি)। Server প্রতিবার পুনরায় যাচাই করে: প্রোগ্রাম enabled + partner active না হলে, code অজানা হলে — **নীরবে উপেক্ষা** (কোনো error নয়, কোনো stamp নয়)। Stamp = Order-এ `affiliatePartnerId` + `affiliateCode` (যেমন পাঠানো হয়েছে)। **Self-dealing guard:** অর্ডারের customer phone আর partner phone loose-match মিললে stamp-ই হয় না।
- **Commission:** `order.delivered` ইভেন্টে failure-isolated hook (OrdersService/IntegrationsService-এর একই transition point; ConversionsService-এর একই subscription pattern)। Entry তৈরি হয় শুধু order EC33-র **sold bucket**-এ পৌঁছালে (dead status নয় + status completed/delivered অথবা CourierShipment delivered/partial_delivered)। `CommissionEntry.orderId` UNIQUE + আগের entry থাকলে skip — repeated delivered transition কখনো duplicate বানায় না। **Base সংজ্ঞা:** `subtotalMinor − discountMinor` — অর্থাৎ সব discount (promotion + coupon + referral) বাদে goods payable; **delivery charge ও tax base-এর বাইরে** (দুটোই Order-এর পৃথক কলাম, subtotal-এ কখনো ছিল না)। `commissionMinor = round-half-up(base × percentSnapshot / 100)`; percent partner-এর বর্তমান মান থেকে snapshot হয় (পরে percent বদলালে পুরনো entry বদলায় না)। Base ≤ 0 হলে entry হয় না।
- **Void নিয়ম:** order cancelled হলে বা **full** refund হলে pending/approved entry `voided` হয় (voidReason সংরক্ষিত)। **Paid entry কখনো auto-void হয় না** — partner detail-এ `paidOnRefundedOrders` গণনা পতাকা হিসেবে দেখায়, staff-এর নজরের জন্য। **Partial refund entry বদলায় না** (v1-তে pro-rate নেই — নথিভুক্ত সিদ্ধান্ত)।
- **Payout = শুধু bookkeeping record:** `AffiliatePayout` সারি মানে "মার্চেন্ট সিস্টেমের **বাইরে** (bKash/Nagad/bank/cash হাতে) এই টাকা দিয়েছেন বলে রেকর্ড করা হলো" — সিস্টেম কখনো টাকা পাঠায় না, UI-র ভাষাও "রেকর্ড করা হয়েছে", কোথাও "পাঠানো হয়েছে" দাবি নেই। Payout outstanding-এর বেশি হলে verbatim 400। নথিভুক্তির সময় approved entry-গুলো **FIFO** (পুরনো আগে) ক্রমে cumulative coverage পর্যন্ত `paid` হয়; আংশিক ঢাকা entry `approved`-ই থাকে — payout partner-স্তরের রেকর্ড, entry-স্তরের নয় (একটাই coherent মডেল, service-এ spec-সহ)।
- **Balance সংজ্ঞা (partner detail):** pendingTotal (pending entries), approvedTotal, paidTotal (paid entries), paidOutTotal (সব payout), outstanding = approvedSum − (payoutsSum − paidSum), শূন্যের নিচে নয়।
- **Staff UI:** `/dashboard/commerce/affiliates` — partner CRUD (code org-unique, clash-এ 400; percent 0–50 validated, default = setting-এর `affiliateDefaultPercent` ?? 10), share-link কপি বোতাম (`/shop/<slug>?ref=<code>`), balance কার্ড, payout record ফর্ম + ইতিহাস, entry টেবিল (status filter + approve — শুধু pending → approved), প্রোগ্রাম সেটিংস কার্ড (enabled/default %/attribution days — storefront settings API দিয়েই round-trip)।

## EC34 — POS Quick-Sale

- **দাম কখনো client থেকে নয়:** `CreatePosSaleDto`-তে **কোনো price ফিল্ডই নেই**। Unit price server-side: variant.priceMinor ?? product.priceMinor (variant সেট থাকলে variant-ই জেতে — storefront-এর একই নিয়ম)। compareAt কোনো হিসাবে আসে না (display-only)।
- **একটাই evaluator পথ:** totals আসে `PromotionsService.evaluateCheckout` থেকে (promotion + EC7 coupon + EC23 tax — tax configurated থাকলে POS-এও প্রযোজ্য); total = subtotal − totalDiscount + taxAddedMinor, **delivery সবসময় 0**। Invalid coupon placement-এর **আগেই** evaluator-এর verbatim error-এ refuse — অর্ডার লেখা হয় না। Gift candidate POS v1-তে place হয় না (gift discount নয়, তাই totals consistent থাকে)।
- **Placement আসল পথেই:** `IntegrationsService.upsertOrder(..., "pos")` — ফলে S1 stock decrement (placement hook), customer find-or-create, order events সবই অন্য চ্যানেলের মতোই। Stock check placement-এর আগে storefront `assertStock`-এর হুবহু নিয়মে (tracked stock-এ verbatim Bengali refusal, null = untracked = সীমা নেই, preorder exempt; duplicate cart line আগে aggregate হয়)। তারপর `OrdersService.updateOrder`-এ completed (counter-এ হস্তান্তর সম্পন্ন — একই transition/event পথ), paid মোডে EC19-আকৃতির **approved PaymentVerification (source `"pos"`)** — `recordAdvanceVerification` reuse করা হয়নি যাতে POS পেমেন্ট audit-এ আলাদা চেনা যায়; duplicate-approved-TrxID guard placement-এর আগেও চালানো হয় যাতে duplicate reference পুরো sale refuse করে, অর্ধেক-হওয়া sale ফেলে না যায়। Due মোডে কোনো verification নয় — পুরো অঙ্ক EC19 due হিসাবেই বকেয়া (খাতা) দেখায়।
- **Walk-in customer:** phone না দিলে org-প্রতি একটাই shared `pos-walkin` customer ("কাউন্টার ক্রেতা") — upsert-এর (org, source, externalId) matching-এ converge করে; phone দিলে সেই phone-এর customer-ই (checkout-এর একই upsert)।
- **Search:** `GET pos/search` — সঠিক sku/barcode/variant-sku মিললে সরাসরি addable `exact` লাইন; নাহলে ≤20 fuzzy ফলাফল (stock state badge-সহ)। Web-এ Enter চাপলে exact লাইন কার্টে চলে যায় ও ইনপুট খালি হয় (packing-scan-এর keyboard pattern — scanner Enter পাঠায়)। কার্টের stock সতর্কতা **শুধু client hint** — চূড়ান্ত সিদ্ধান্ত server-এর।
- **Receipt:** print পেজে `kind=receipt` — 80mm narrow layout (@media print-এ `.pos-receipt` width), দোকানের নাম, অর্ডার নম্বর, লাইন, totals, paid/due (EC19 `amountDueMinor` থেকে), "ধন্যবাদ!" closing। Invoice/slip আচরণ অপরিবর্তিত।
- **আজকের বিক্রি:** POS পেজের নিচে `GET pos/today` — Asia/Dhaka দিনের [00:00, +24h) সীমানায় (codebase-এর `dhakaDayStartUtc` helper reuse), source "pos" অর্ডার + মোট বিক্রি + প্রতি অর্ডারের due (এক batched approved-verification sum)।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **314 suites / 3172 tests** — ৫টি shard-এ, প্রতিটি exit 0। Baseline 312/3126 ⇒ +2 suite/+46 test (ec32-affiliates 27, ec34-pos 19)। এই run-এ কোনো flake দেখা যায়নি |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ **36 files / 230 tests** (baseline অপরিবর্তিত — নতুন web পেজগুলো vitest-আওতার বাইরে, আগের পেজগুলোর মতোই) |
| Web tsc | ✅ exit 0 |
| Build | ✅ `pnpm -r build` **exit 0** — ৭ প্যাকেজ Done; web route table-এ `/dashboard/pos` ও `/dashboard/commerce/affiliates` উপস্থিত |
| Prisma validate | ✅ exit 0 |
| **Fresh-DB migration sequence** | ✅ **151/151 clean** — throwaway PostgreSQL 16 (local binary, /tmp cluster)-এ পুরো sequence `prisma migrate deploy` exit 0; `_prisma_migrations`-এ 151 finished; **201টি টেবিল** (আগের 198 + AffiliatePartner + CommissionEntry + AffiliatePayout); Order-এর affiliate কলাম ২টি ও EC34 index উপস্থিত যাচাইকৃত। Cluster পরে মুছে ফেলা হয়েছে |

## Migration ও deploy নোট

- `20261013590000_ec32_affiliate_program` — 3টি নতুন টেবিল + Order-এ 2টি nullable কলাম + StorefrontSetting-এ 3টি কলাম (2টির default আছে)। `20261013600000_ec34_pos` — **index-only** (POS-এর কোনো নিজস্ব টেবিল/কলাম নেই)। Tree-তে মোট এখন **151টি migration**, সবই additive। **কোনো আসল DB-তে এখনো একটিও চালানো হয়নি** — deploy-এ `migrate deploy` বাধ্যতামূলক।
- নতুন কোনো job/env লাগে না: commission hook in-process event-driven (order.delivered); POS সম্পূর্ণ request-driven।

## সৎ সীমা

- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত। কোনো আসল affiliate অর্ডার/কমিশন/payout বাস্তবে হয়নি; EC12 live sprint এখনো খোলা।
- **Attribution window client-side:** `?ref` সংরক্ষণ আর মেয়াদ ব্রাউজারের localStorage-তে — ক্রেতা browser বদলালে বা storage মুছলে attribution হারায়; server শুধু পাঠানো code-টাই যাচাই করে। এটি v1-এর নথিভুক্ত trade-off (cookie-based cross-device attribution বানানো হয়নি)।
- **Commission শুধু `order.delivered` event পথে তৈরি হয়** — event না আসা কোনো অস্বাভাবিক পথে order sold হলেও entry তৈরি হবে না (EC33-র report পথে পরে মিলিয়ে দেখা যায়, কিন্তু কোনো backfill sweep এই ব্যাচে নেই)।
- **Partial refund-এ commission pro-rate হয় না** (উপরে নথিভুক্ত) — মার্চেন্ট চাইলে entry হাতে void করার পথ এই ব্যাচে নেই; শুধু cancel/full-refund-ই void করে।
- **POS offline মোড নেই** (প্ল্যান অনুযায়ীই) — ইন্টারনেট/API ছাড়া POS চলবে না। Barcode scanner-এর আসল hardware আচরণ live যাচাই হয়নি — Enter-ভিত্তিক keyboard-wedge pattern-ই ধরা হয়েছে।
- **POS-এ delivery/slot/pickup নেই** — counter sale মানেই তৎক্ষণাৎ হস্তান্তর; POS অর্ডারে `deliveryMethod` schema default ("home")-ই থাকে, অর্থ বহন করে না।
- **Screenshot QA হয়নি** — sandbox-এ live app নেই; নতুন UI build + typecheck-প্রমাণিত, চোখে দেখা নয়।
