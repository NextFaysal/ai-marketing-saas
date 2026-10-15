# E-Commerce Phase 3 — Batch B14 (EC27 + EC28) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (B13 HEAD `13935a5`-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase3-Plan-2026-10-13.md` — EC27 (Storefront SEO & Discovery) + EC28 (Retention Pack)।

## কমিট

| Hash | বিষয় |
|---|---|
| `e49fb41` | Schema + migrations `20261013550000_ec27_seo_discovery` (comment-only — নিচে দেখুন), `20261013560000_ec28_retention` |
| `3e86e6f` | EC27 API: search upgrade + bought-together + tracking payload extension; specs |
| `e2672eb` | EC28 API: RetentionService (stock alerts, price-drop sweep, self-service RMA, Q&A) + `sendShopSms` helper + inventory event hook; specs |
| `d98cf3e` | EC27 web: sitemap lastmod, robots.txt, JSON-LD, canonical/OG, recently-viewed |
| `025d1fe` | EC28 web: stock-alert form, Q&A section, tracking-page RMA, staff Q&A page, returns source badge |
| (এই কমিট) | এই acceptance ডক |

## EC27 — Storefront SEO & Discovery

- **Audit-প্রথম সিদ্ধান্ত:** EC8 যুগের sitemap machinery আগেই ছিল (`apps/web/src/app/shop/[orgSlug]/sitemap.ts` + `lib/storefront-sitemap.ts`) — দ্বিতীয় sitemap বানানো হয়নি; ঘাটতি ছিল **lastmod** (সব entry-তে "now" বসত)। এখন: API-র public product payload-এ `updatedAt` যোগ হয়েছে, sitemap entry প্রতি পণ্যের আসল `updatedAt` বহন করে, home entry পায় সবচেয়ে নতুন পণ্যের `updatedAt` (পণ্য না থাকলে তবেই "now")। Pure helper `buildShopSitemapEntries` + test। Category পেজ এই শপে আলাদা route নয় (home-এর `?category=` query), তাই sitemap-এ আলাদা URL হিসেবে আসে না — code comment-এ নথিভুক্ত।
- **robots.txt:** নতুন per-shop route handler `/shop/[orgSlug]/robots.txt` — shop surface Allow, cart/checkout/account/success Disallow, Sitemap লাইন (base = `NEXT_PUBLIC_WEB_URL`, না থাকলে request-এর আসল origin — বানানো domain নয়)।
- **JSON-LD (pure builder `lib/storefront-seo.ts`, unit-tested):** product page-এ Product + Offer — নাম/ছবি/SKU/আসল দাম (minor→major string, currency product-এর নিজের, default BDT) + stockState থেকে availability (untracked ⇒ availability-ই নেই, কোনো দাবি নয়)। **aggregateRating কেবল তখনই যখন EC15 unified reviews summary-তে count > 0** — না হলে field-টাই থাকে না (spec-প্রমাণিত)। Shop home-এ Organization + WebSite (আসল `?q=` SearchAction-সহ) BusinessProfile/org ডেটা থেকে। Canonical + OG URL দুই পেজেই `generateMetadata`-তে যোগ।
- **Shop search upgrade:** আগে DB `contains` শুধু name/description/sku/legacy category string-এ ছিল — categoryId-মাত্র-linked পণ্য তার Category-র নামে খুঁজলে পাওয়া যেত না। এখন bounded ACTIVE scan-এর উপর in-memory contains: name (একটাই name field — বাংলা/ইংরেজি দুটোই সেই field-এ থাকে), description, SKU, legacy category string **এবং structured Category row-এর নাম**। Category filter + pagination/total আগের মতোই। **কোনো FTS দাবি নেই** (IN1 শিক্ষা)। Specs: বাংলা নাম hit, ইংরেজি নাম hit, SKU hit, category-row-name hit, category filter narrowing, no-match empty — ৬টি।
- **Bought-together:** product detail payload-এ `boughtTogether` — গত ১৮০ দিনের **SOLD** অর্ডারে (EC33-র সংজ্ঞা হুবহু: dead state নয় + completed/delivered অথবা CourierShipment delivered/partial_delivered) একই অর্ডারে থাকা পণ্য, অর্ডারপ্রতি একবার গণনা, **gift line বাদ** (উপহার কেনার ইচ্ছা নয় — code-এ নথিভুক্ত), শুধু ACTIVE পণ্য public card shape-এ, count desc + productId asc (deterministic), সর্বোচ্চ ৪টি। **< 2 co-occurrence ⇒ পণ্যটি বাদ; কিছুই না থাকলে খালি array — filler recommendation কখনো নয়।** Pure `rankBoughtTogether` + service spec-এ fixture order দিয়ে exact ranking প্রমাণিত।
- **Recently viewed:** সম্পূর্ণ web-only — localStorage (org slug প্রতি key, সর্বোচ্চ ৮, সাম্প্রতিকতম আগে)। Product page view record করে; home + product page-এ strip। সার্ভার state নেই, tracking দাবি নেই। Stored minimal card (id/slug/name/image/price at view time) — **দাম stale হতে পারে** (lib comment-এ নথিভুক্ত); click গেলে live product page-ই আসল দাম দেখায়। Card-এ stockState "untracked" বসে — stored card থেকে কোনো stock দাবি করা হয় না।

## EC28 — Retention Pack

- **Shared SMS helper:** EC25-এর OTP send logic `ShopAccountService.sendShopSms(orgId, phone, text, reference)` নামে একটিই helper-এ তোলা হয়েছে (tenant MessagingSenderConfig → platform fallback → honest not-configured)। OTP ওই helper-এর উপরেই refactor হয়েছে (আচরণ অপরিবর্তিত — EC25 specs সব pass)। EC28-র দুই alert-ই এই একই helper ব্যবহার করে — দ্বিতীয় sender নেই।
- **Back-in-stock alerts:** নতুন `StockAlertSubscription`। Public `POST /public/shop/:orgSlug/stock-alerts` — পণ্য/ভ্যারিয়েন্ট **আসলে out of stock** থাকলেই কেবল subscribe; in stock ⇒ 400 "পণ্যটি এখন স্টকে আছে" (verbatim spec)। বিদেশী পণ্য 404। একই (product, variantSku, phone)-এ pending একটি মাত্র — re-subscribe idempotent (existing row ফেরত)। Logged-in হলে session থেকে customerId link (failure-isolated)। **Hook:** `InventoryService` 0 → >0 transition-এ `inventory.stock_increased` event ছাড়ে — `adjust()` (manual adjust, purchase-receive, stock count, return restock — সবাই এই choke point দিয়ে যায়) এবং `applyOrderRestore` (cancel/return restore) থেকে। EventsService dispatch本身 failure-isolated, তার উপর handler নিজেও কখনো throw করে না — **stock write কোনো অবস্থাতেই alert-এর কারণে ভাঙবে না**। Exactly-once: প্রথম transition-এই subscription "pending" ছেড়ে যায় — পাঠানো গেলে `notified`, sender না থাকলে `failed_no_channel` + কারণ সংরক্ষিত (**কখনো "sent" দাবি নয়**)। দ্বিতীয় restock-এ একই subscription আর fire করে না (spec-প্রমাণিত, আসল InventoryService.adjust + আসল EventsService দিয়ে)। Variant subscription শুধু সেই variant-এর restock-এই fire করে।
- **Wishlist price-drop alerts:** দাম লেখার পথ অনেকগুলো (product update, variant update, bulk edit, listing sale boundary) — **কোনো single choke point নেই, তাই sweep বেছে নেওয়া হয়েছে** (নথিভুক্ত সিদ্ধান্ত): নতুন job type `wishlist_price_alert_sweep` (template-সহ, প্রতি ৬০ মিনিটের template)। `WishlistItem`-এ `lastNotifiedPriceMinor / lastAlertStatus / lastAlertAt`। নিয়ম: current < (lastNotified ?? priceAtAdd) ⇒ একবার SMS; পাঠানো সফল হলেই নতুন price point record হয় — একই দামে re-fire নেই, আরও কমলে আবার, **দাম বাড়লে কখনো নয়**। Sender/phone না থাকলে attempt `failed_no_channel` হিসেবে record হয় কিন্তু **price point consume হয় না** — channel এলে পরের sweep পাঠাতে পারবে। Specs সবগুলো case cover করে।
- **Customer self-service RMA:** tracking page থেকে `POST /public/shop/:orgSlug/track/returns` — EC18/EC24-র **একই** `matchTrackedOrder` matcher পুনরায় ব্যবহার (matcher failure constant-shape 404 — wrong phone আর unknown order-এর message হুবহু এক, spec-প্রমাণিত)। Delivered order না হলে 400। Items order-এর নিজের line দিয়ে validate — qty বেশি হলে EC9-র verbatim message; items বাদ দিলে পুরো order। তৈরি হয় EC9-র একই `ReturnRequest` shape-এ: status "requested" (EC9 initial), `source: "customer"`, নতুন `requestType` (return|exchange), token-সহ (staff flow compatibility)। একই order+type-এ open request থাকলে duplicate 400। Tracking response এখন order-এর নিজের `returnRequests` list দেয় (customer নিজের status দেখে) — সেই জন্যে trackOrder payload-এ item `id` + `returnRequests` যোগ হয়েছে (EC18 spec-এর একটি exact-shape assertion সেই অনুযায়ী update হয়েছে — ইচ্ছাকৃত payload extension)। Staff queue (EC9 ReturnsService list) হুবহু একইভাবে দেখে; returns UI-তে source badge (👤 গ্রাহক নিজে · রিটার্ন/এক্সচেঞ্জ / স্টাফ)।
- **Product Q&A:** নতুন `ProductQuestion`। Public ask (`POST .../products/:slug/questions`, rate-limited) ⇒ **pending — জনসাধারণ দেখে না**। Public payload-এ শুধু published (প্রশ্ন+উত্তর+তারিখ) — **phone কখনো নয়** (spec-এ JSON string ধরে assert)। Staff: `/dashboard/commerce/questions` — pending list, answer (দিলেই publish), hide/unhide, delete; প্রতিটি moderation-এ audit (`product_question.answered/hidden/unhidden/deleted`)। Guard: TenantGuard + RolesGuard + `@PermissionArea("orders")` + EC15 reviews moderation-এর ভূমিকা-তালিকা। বিদেশী পণ্য/প্রশ্ন 404।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **309 suites / 3075 tests** (baseline 307/3048 ⇒ +2 suite/+27 test: ec27-discovery 12, ec28-retention 15) — ৫টি chunk-এ চালানো। দ্রষ্টব্য: chunk 4-এর প্রথম প্রচেষ্টা tool timeout-এ SIGTERM হয়েছিল (কোনো output-ই আসেনি, test failure নয়) — দুই ভাগে re-run করে দুটোই সবুজ (31/436 + 20/112)। cx3-debounce flake এই run-এ দেখা যায়নি। |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ **36 files / 230 tests** (baseline 34/217 ⇒ +2 file/+13 test: storefront-seo, recently-viewed, sitemap entries, i18n parity) |
| Web tsc | ✅ exit 0 |
| Build | ✅ `pnpm build` **exit 0** (log-এ ধরা) — route table-এ `/shop/[orgSlug]/robots.txt`, `/shop/[orgSlug]/sitemap.xml`, `/dashboard/commerce/questions` উপস্থিত |
| Prisma validate | ✅ exit 0 |
| **Fresh-DB migration sequence** | ✅ **147/147 clean** — throwaway PostgreSQL 16 (local binary, `su postgres`, /tmp cluster)-এ পুরো sequence `prisma migrate deploy` exit 0; `_prisma_migrations`-এ 147 finished, 0 failed/অসমাপ্ত; **194টি টেবিল** (আগের 192 + StockAlertSubscription + ProductQuestion); WishlistItem-এর `lastNotifiedPriceMinor/lastAlertStatus/lastAlertAt` ও ReturnRequest-এর `source/requestType` কলাম উপস্থিত যাচাইকৃত। Cluster পরে মুছে ফেলা হয়েছে |
| **Full AppModule boot (অতিরিক্ত)** | ✅ compiled API পুরো AppModule graph (AutomationModule → StorefrontModule-সহ) ওই migrated throwaway DB-র বিরুদ্ধে boot হয়েছে — AutomationService-তে RetentionService injected, RetentionService-তে SMS helper wired, InventoryService-তে EventsService wired — তিনটিই runtime-এ assert করা |

## Migration ও deploy নোট

- `20261013550000_ec27_seo_discovery` — **ইচ্ছাকৃতভাবে comment-only** (শুধু `SELECT 1;`): EC27 সম্পূর্ণ read-time computed (sitemap/JSON-LD/search/bought-together কোনো নতুন কলাম চায় না); migration-টি sequence-এ রাখা হয়েছে যাতে Phase-3-র ধারাবাহিকতা explicit থাকে। `20261013560000_ec28_retention` — 2টি নতুন টেবিল + WishlistItem-এ 3টি nullable কলাম + ReturnRequest-এ `source` (default 'staff') ও `requestType`। Tree-তে মোট এখন **147টি migration**, সবই additive। **কোনো আসল DB-তে এখনো একটিও চালানো হয়নি** — deploy-এ `migrate deploy` বাধ্যতামূলক।
- নতুন job: `wishlist_price_alert_sweep` — per-org template থেকে install না করলে price-drop sweep চলবে না (অন্যান্য sweep-এর মতোই)। Back-in-stock event hook-এর জন্য আলাদা job লাগে না।
- নতুন env লাগে না। (ঐচ্ছিক: `NEXT_PUBLIC_WEB_URL` থাকলে sitemap/canonical absolute হয়; না থাকলে path-only/origin fallback — আগের EC8 আচরণই।)

## সৎ সীমা

- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত। কোনো আসল SMS কখনো পাঠানো হয়নি: stock alert ও price-drop alert দুটোই org-এর আসল MessagingSenderConfig/platform SMS config-এর উপর নির্ভরশীল; config না থাকলে সৎ `failed_no_channel`-ই production আচরণ। M30/EC12 live sprint এখনো খোলা।
- **Screenshot QA হয়নি** — sandbox-এ live app নেই; shop/track/dashboard-এর নতুন UI build + typecheck-প্রমাণিত, চোখে দেখা নয়।
- **Sitemap-এর সীমা আগের মতোই:** shop API-র pagination scan (pageSize 60, cap 200 page = 12,000 পণ্য) — তার বেশি পণ্যের দোকানে sitemap অসম্পূর্ণ থাকবে (EC8 থেকে চলে আসা সীমা, এই batch-এ বদলানো হয়নি)।
- **Bought-together scan** product detail-এর প্রতিটি request-এ org-এর ১৮০ দিনের order + shipment + item in-memory পড়ে (codebase-এর in-memory discipline-ই); খুব বড় order ইতিহাসে এটি ভারী হতে পারে — কোনো cache/index এই batch-এ যোগ হয়নি।
- **Price-drop sweep-এর বিলম্ব:** দাম বদলের সঙ্গে সঙ্গে alert যায় না — পরের sweep run-এ (template interval ৬০ মিনিট) যায়। এটি নথিভুক্ত trade-off (choke point নেই বলে)।
- **Stock-alert variant মিল:** variant subscription শুধু ওই variant-এর 0→>0 transition-এই fire করে; product-level subscription product row-এর transition-এ। Variant থাকা পণ্যে product row untracked থাকলে product-level subscribe সৎভাবে 400 দেয় (stock ট্র্যাক করা হয় না)।
- **RMA delivered-এর সংজ্ঞা** এখানে order status completed/delivered অথবা fulfillment delivered অথবা courier shipment delivered/partial_delivered — আংশিক ডেলিভারিতে পুরো order-এর line validate হয় order-এর নিজের quantity দিয়ে (per-line delivered qty আলাদা করে গণনা হয় না)।
