# E-Commerce Phase 3 — Batch B12 (EC25 + EC29) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1`, Phase 2 HEAD `a029713`-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase3-Plan-2026-10-13.md` — EC25 (EC17 সমাপনী) + EC29।

## কমিট

| Hash | বিষয় |
|---|---|
| `9fbd46a` | Schema + migrations `20261013510000_ec25_storefront_accounts`, `20261013520000_ec29_bundles_gifts` + storefront DTO |
| `683d956` | EC25 API: OTP/session/account/wishlist + checkout session pin + specs |
| `089458d` | EC29 API: bundles + gift promotion + gift wrap (shared storefront ফাইলে EC25-র route/pin wiring-ও এই কমিটে) |
| `9c83038` | Web: account area, wishlist hearts, bundles/gift/wrap UI, dashboard bundles + gift form + print |
| (এই কমিট) | এই acceptance ডক |

## EC25 — Storefront Account + Wishlist (EC17 সমাপনী)

- **পরিচয়:** account identity = org-scoped `Customer` রো নিজেই (phone match, checkout-এর একই upsert পথ)। আলাদা identity টেবিল বানানো হয়নি।
- **OTP:** `POST public/shop/:orgSlug/auth/request-otp` — 6-digit code, শুধু SHA-256 hash সংরক্ষিত (`orgId:phoneKey:code`), মেয়াদ ৫ মিনিট, attempt cap 5 (৫ম ভুলে challenge মৃত), নতুন request আগের সব open challenge supersede করে। Rate cap: ফোনপ্রতি ঘণ্টায় 3টি + 60 সেকেন্ডে 1টির বেশি নয় (429), পাশাপাশি controller-এ `@RateLimit(10, 60)`। Code কোনো response/log-এ কখনো যায় না (spec-asserted)।
- **SMS পাঠানোর পথ:** org-এর নিজের MessagingSenderConfig (MS4 tenant gateway) থাকলে সেটি দিয়ে, নইলে platform gateway; **কোনোটাই না থাকলে challenge consume করে সৎ 400** — "এই দোকানে SMS লগইন সেটআপ করা নেই — দোকানে যোগাযোগ করুন"। Gateway ব্যর্থ হলেও challenge consumed + gateway-এর নিজের বার্তা ফেরত। কোনো pretend-send বা dev backdoor নেই।
- **Session:** 32-byte random token, শুধু hash সংরক্ষিত, 30 দিন। প্রতিটি ব্যবহারে org মিল যাচাই (cross-org token ⇒ 401, spec-প্রমাণিত), revoked/expired ⇒ 401, logout ⇒ revoked (পুরনো token মৃত)। Merged customer-এর sessionও মৃত।
- **Account endpoints:** me/profile, orders (শুধু নিজের — অন্য customer-এর order একই org-এও কখনো আসে না; foreign order detail/reorder ⇒ 404), reorder (বর্তমান ক্যাটালগ দিয়ে যাচাই — discontinued ⇒ "পণ্যটি আর পাওয়া যাচ্ছে না", stock শেষ ⇒ "স্টক শেষ", in-stock ⇒ **বর্তমান** দাম + stock অনুযায়ী qty clamp; কোনো order তৈরি হয় না, web cart-এ লোড করে), addresses CRUD (default স্যুইচ, default মুছলে পুরনোটা promote), wishlist (`priceAtAddMinor` snapshot ⇒ আসল price-drop badge; merge: foreign/inactive/already-present ⇒ skipped গণনা সৎভাবে)।
- **Checkout pin:** session token থাকলে এবং session customer-এর phone checkout phone-এর সঙ্গে মিললে order-এর `customerId` pin হয় (upsertOrder-এর EC24c pinned-customerId পথ); phone না মিললে/invalid token হলে নীরবে guest flow — response byte-identical (spec-প্রমাণিত guest parity)।
- **Web:** `/shop/[orgSlug]/account` (OTP login + ৪ ট্যাব), header-এ account + wishlist (count badge), product card/detail-এ heart (guest = localStorage, login-এ merge), checkout-এ session prefill।

## EC29 — Bundles & Gifts

- **Bundle (fixed-price set):** নতুন `Bundle` মডেল — EC4 `BundleItem` stock-composition থেকে সম্পূর্ণ আলাদা (নামে মিল থাকলেও ধারণা ভিন্ন; acceptance-এ স্পষ্ট করা হলো)। Staff CRUD (`commerce/bundles`), items server-validated (2–10, org product, variant SKU যাচাই, duplicate pair নিষেধ)। Public payload: component-সহ, `regularTotal` আসল দামে, savings শুধু regularTotal > bundlePrice হলেই (নইলে badge নেই)।
- **Allocation identity (spec-প্রমাণিত):** checkout-এ bundle component OrderItem-গুলোর allocated total-এর যোগফল **হুবহু** `bundlePriceMinor × bundleQty` — proportional allocation, শেষ component remainder শোষণ করে। Cart subtotalও এই exact total-ই ব্যবহার করে। একটি documented সূক্ষ্মতা: promotions evaluator-এর discount base allocated *unit* price (floor) × qty নেয় বলে floored line-এ discount base কয়েক পয়সা কম হতে পারে — merchandise subtotal কখনোই নয়।
- **Stock:** component stock স্বাভাবিক S1 পথে কাটে (OrderItem-এ productId সরাসরি link); যেকোনো component stock-এ না থাকলে **পুরো checkout 400, কোনো order লেখা হয় না** (spec: upsertOrder কখনো call হয় না)। Single checkout/landing-এ bundle v1-এ নেই (নকশা অনুযায়ী)।
- **Gift promotion:** EC16 evaluator-এ নতুন `gift` type। সংজ্ঞা (ডকুমেন্টেড): threshold বিচার হয় **ছাড়ের আগের product-line subtotal**-এ (bump বাদে); subtotal == threshold হলেই qualify। সর্বোচ্চ priority-র একটি মাত্র gift; gift product inactive/মুছে গেলে পরের candidate। Gift line price 0, `isGift` stamp, stock স্বাভাবিকভাবে কাটে; **placement-এ stock না থাকলে gift skip — order সফল, `giftSkipped: true` + `giftPromotionId` stamp**। Gift কখনো `promotionsApplied`/discount মোটে ঢোকে না; tax base-এও নয় (price 0)।
- **Gift wrap:** `StorefrontSetting.giftWrapEnabled + giftWrapFeeMinor`; shop + single checkout-এ checkbox + বার্তা (সর্বোচ্চ 200 অক্ষর)। Fee total-এ **ঠিক একবার** যোগ হয় (delivery-র মতো fee — discount/tax base-এর বাইরে), order-এ `giftWrapMinor + giftMessage` stamp, packing slip-এ বার্তা prominently ছাপা হয়। Wrap চাওয়া হলেও দোকান enable না করলে fee 0 — কোনো চার্জ হয় না। Landing-এ wrap v1-এ নেই।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **304 suites / 3000 tests** — `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand`, process exit 0 (baseline 299/2939 ⇒ +5 suite/+61 test: ec25-accounts 22, ec29 39)। cx3-debounce এই রানে আসেনি |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ **217/217** (34 files; shop-i18n bn/en parity 3/3 সহ) |
| Web tsc | ✅ exit 0 |
| Build | ✅ সব প্যাকেজ exit 0 (contracts/db/ui tsc, api tsc, worker tsc, web `next build`, admin `next build`) — route table-এ `/shop/[orgSlug]/account` + `/dashboard/commerce/bundles`। দ্রষ্টব্য: এই sandbox-এ `pnpm` binary নেই বলে প্রতিটি প্যাকেজের নিজের build script dependency order-এ চালানো হয়েছে (B10-র মতোই) |
| Prisma validate | ✅ exit 0 (DATABASE_URL শুধু config load-এর জন্য) |

নতুন spec: `ec25-accounts.spec.ts` (22), `ec29-bundles.spec.ts` + `ec29-gift.spec.ts` + `ec29-shop.spec.ts` + `ec29-single-checkout.spec.ts` (39)।

## Migration ও deploy নোট

- `20261013510000_ec25_storefront_accounts` (4টি নতুন টেবিল), `20261013520000_ec29_bundles_gifts` (2টি টেবিল + Order/OrderItem/StorefrontSetting-এ additive কলাম) — tree-তে মোট এখন **143টি migration**।
- **⚠️ এই ব্যাচে fresh-DB পূর্ণ-sequence রান পুনরায় করা যায়নি** — বর্তমান sandbox-এ PostgreSQL binary/docker নেই এবং apt lock-এর কারণে installও সম্ভব হয়নি। তার বদলে দুটি migration-এর প্রতিটি table/column/index schema.prisma-র সঙ্গে static cross-check করা হয়েছে (সব মিলেছে) এবং দুটোই Phase-2-তে যাচাইকৃত 141টির হুবহু একই SQL convention-এ additive। **Deploy-এর আগে আগের মতোই fresh DB-তে পুরো 143টির sequence একবার চালিয়ে যাচাই করা জোরালোভাবে সুপারিশকৃত** (cx7-এর শিক্ষা); কোনো migration-ই এখন পর্যন্ত কোনো আসল DB-তে চালানো হয়নি, deploy-এ `prisma migrate deploy` বাধ্যতামূলক।
- নতুন env লাগে না। OTP-র জন্য org-এর SMS sender (tenant gateway অথবা platform) configure থাকতে হবে — নইলে login endpoint সৎ 400 দেবে (উপরে দ্রষ্টব্য)।

## সৎ সীমা

- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত। আসল SMS gateway দিয়ে OTP কখনো পাঠানো হয়নি (adapter stubbed); আসল gateway-তে পৌঁছালে delivery আচরণ M30/EC12 live sprint-এর বিষয়।
- OTP login শুধু native shop-এ; Woo/Shopify storefront-এর customer account এই প্যাকেজের বিষয় নয়।
- Bundle শুধু shop checkout-এ; gift promotion evaluator-এ সব পথে হিসাব হলেও gift line placement shop + single checkout-এই হয় (landing-এ gift stamp/item v1-এ নেই — landing response-এ কোনো gift প্রতিশ্রুতিও দেখানো হয় না)।
- Wrap fee quote-তে তখনই আসে যখন checkout page `giftWrap` পাঠায়; server fee শুধু setting enabled + fee set থাকলেই নেয়।
- Reorder-এ gift line সাধারণ paid line হিসেবে ফেরে (আসল gift-এর পুনরাবৃত্তি নয়) — বর্তমান দামে, যা সৎ আচরণ।
