# E-Commerce Phase 3 — Batch B13 (EC26 + EC33) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (B12 HEAD `15042e4`-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase3-Plan-2026-10-13.md` — EC26 (Courier COD Reconciliation) + EC33 (Inventory Intelligence)।

## কমিট

| Hash | বিষয় |
|---|---|
| `67d5298` | Schema + migrations `20261013530000_ec26_cod_reconciliation`, `20261013540000_ec33_inventory_intelligence` |
| `0dd98eb` | EC26 backend: reconciliation মডিউল + accounting courier-collections export + specs |
| `94d6f4f` | EC33 backend: inventory intelligence service + controller endpoints + specs |
| `81b35a2` | Web: reconciliation ও inventory-intelligence পেজ, accounting export অপশন, hub লিংক |
| (এই কমিট) | এই acceptance ডক |

## EC26 — Courier COD Reconciliation

- **সত্যের উৎস:** `CourierShipment.codCollectedMinor / codCollectedAt / codCollectionSource` — এই ফিল্ডগুলো শুধু reconciliation import বা staff `accept_sheet` resolution বসায়; delivered status একা কখনো collection ধরে না (EC23-র ঘাটতি এভাবেই বন্ধ হলো)। Expected COD = shipment-এর বুকিং-সময়ের `codAmountMinor` (import-এর মুহূর্তে line-এ `expectedMinor` হিসেবে snapshot; order total থেকে পুনঃহিসাব নয়)।
- **Profile/mapping:** (org, courier) প্রতি একটি `ReconciliationProfile` — header-নাম-ভিত্তিক mapping (tracking + amount আবশ্যক; charge/orderRef/status ঐচ্ছিক)। প্রথম import-এ mapping না থাকলে সৎ 400; import-এর সঙ্গে পাঠানো mapping profile হিসেবে সংরক্ষিত হয় (পরের import এক-ক্লিক)। Import-এর আগে ফাইলের আসল header পড়ে (`POST headers`) mapping যাচাই হয় — mapping-এর কলাম ফাইলে না থাকলে 400-এ **কলামের নাম ধরে** বলা হয়।
- **Money parsing:** `parseSheetMoney` — কমা/স্পেস/currency টোকেন (BDT/৳/Tk) সরিয়ে `1,250.00` / `1250` / `1250.5` পড়ে; অপাঠ্য বা ঋণাত্মক হলে null ⇒ সেই সারি `row_error` (কাঁচা মান note-এ থাকে)।
- **Match ক্রম (নথিভুক্ত):** tracking → `trackingCode`, তারপর → `consignmentId`, তারপর order ref → shipment-এর `invoice`, তারপর order ref → Order `externalNumber`/`externalId` → ওই order-এর ওই provider-এর সর্বশেষ shipment।
- **ছয়টি outcome:** `matched` (শিট = expected; shipment stamp), `amount_mismatch` (শিটের পরিমাণই stamp হয় — শিটই অর্থের সত্য — কিন্তু line পতাকাঙ্কিত ও গণনা থাকে, নীরবে "ঠিক" করা হয় না), `not_found` (কাঁচা মান সংরক্ষিত), `duplicate` (একই ফাইলে একই key দ্বিতীয়বার; **coordinator-এর যোগ করা hardening:** একই shipment ভিন্ন key দিয়েও (tracking বনাম invoice) দ্বিতীয়বার এলে duplicate — প্রথম stamp-ই থাকে, spec-প্রমাণিত), `already_collected` (আগের import-এর রেকর্ড কখনো overwrite হয় না — first truth wins), `row_error` (key নেই বা amount অপাঠ্য; match-এর পরে যাচাই বলে line-এ matched id + expected থেকে যায়)।
- **Idempotency:** একই (org, courier, fileHash) ফাইল পুনঃimport ⇒ 400 "এই ফাইলটি আগেই import করা হয়েছে"; `force=true` দিলে সারিগুলো পুনর্মূল্যায়ন হয় কিন্তু `already_collected` অর্থের ফিল্ড রক্ষা করে। সারির ক্যাপ 5000 (বেশি হলে 400); headerহীন/খালি CSV ⇒ 400। Import row আগে তৈরি হয়, counts পরে লেখা হয় — import-এর count ফিল্ড = line outcome-এর গণনা (spec-asserted identity)।
- **Staff resolution:** `PATCH lines/:id` — `accept_sheet` (sheet পরিমাণ দিয়ে shipment-এর collected overwrite; audit-এ পুরনো/নতুন দুটোই) ও `mark_reviewed` (শুধু reviewed stamp)। বিদেশী courier/line/import ⇒ 404; non-courier integration ⇒ 400।
- **EC23 wiring:** accounting export-এ চতুর্থ ধরন `courier-collections` — period নির্ধারণ order-এর effective date (placedAt ?? createdAt, বাকি export-গুলোর একই নিয়মে); provider-ভিত্তিক shipments / expected (শুধু delivered + partial_delivered shipment-এর booked COD) / collected / outstanding / discrepancy (period-এ তৈরি import-এর amount_mismatch line) + TOTAL সারি। due export-এর semantics অপরিবর্তিত (শুধু মন্তব্য EC26-র দিকে নির্দেশ করে)।
- **UI:** `/dashboard/commerce/reconciliation` — courier picker, ফাইল নিলে আসল header থেকে mapping dropdown, saved profile preselect, force-retry, import summary কার্ড (৭ গণনা), history টেবিল, outcome filter chips + line টেবিল + resolve action (accept কেবল matched shipment + sheet amount থাকলে)।

## EC33 — Inventory Intelligence

- **Sold-এর সংজ্ঞা (codebase-এর delivered bucket, risk-score.ts অনুযায়ী):** order status dead state-এ (cancelled/refunded/failed) নয় **এবং** delivered-প্রমাণিত — status `completed`/`delivered` অথবা CourierShipment `delivered`/`partial_delivered`। শুধু placed (pending/processing, delivered shipment ছাড়া) order বিক্রি নয়। তারিখ = placedAt ?? createdAt।
- **Velocity:** 30/60/90 দিনের window; tracked row-ভিত্তিক (variant-ই granularity, EC20-র একই নিয়ম) unitsSold, `dailyVelocity = unitsSold / windowDays`, `daysOfStockLeft` (velocity 0 ⇒ null — অনুমান করা হয় না), stock 0 + velocity > 0 ⇒ daysOfStockLeft 0 ও stockout = আজ; projectedStockoutDate অন্যথায় null।
- **Reorder v2:** `GET inventory/reorder-suggestions?mode=velocity` — `suggestedQty = max(0, ceil(dailyVelocity × leadTimeDays) − currentStock)`, leadTimeDays নতুন `InventorySetting` থেকে (default 14, 1–180 validate, auditসহ upsert)। Velocity 0-র row suggestion-এ আসে না কিন্তু `noRecentSalesCount`-এ গণনা হয় (নীরবে বাদ নয়)। mode অনুপস্থিত/`simple` ⇒ EC20-র আগের response হুবহু (বিদ্যমান spec অপরিবর্তিত পাস)। Suggestion-এর window স্থির 30 দিন (নথিভুক্ত)। Velocity item-এ supplier তথ্য নেই (null) — `basis: "velocity"` লেবেলসহ।
- **Dead stock:** stock > 0 কিন্তু window-তে বিক্রি নেই এমন tracked row; **সীমানা নিয়ম: ঠিক now − days মুহূর্তের বিক্রি window-এর ভিতরে ধরা হয় (inclusive) — পণ্য dead নয়** (spec-প্রমাণিত; 1ms বাইরের বিক্রিতে dead)। `lastSaleAt` = সবসময়ের সর্বশেষ বিক্রি (কখনো বিক্রি না হলে null)। খরচ = ProductCost ইতিহাসের সর্বশেষ (variant-নির্দিষ্ট রো অগ্রাধিকার পায়); খরচ না থাকলে `stuckValueMinor = null` ও `unvaluedCount`-এ গণনা — মূল্য বানানো হয় না। CSV export একই ডেটার।
- **Valuation:** stock > 0 row-গুলোর Σ stock × সর্বশেষ খরচ; response-এ `valuedProducts` / `unvaluedProducts` coverage — unvalued থাকলে মোটটি **শুধু খরচ-জানা stock-এর** মূল্য (UI-তেও সেই সতর্কতা লেখা থাকে)।
- **UI:** `/dashboard/commerce/inventory-intelligence` — lead-time সেটিং, reorder mode toggle (velocity-তে "আনুমানিক — শেষ ৩০ দিনের বিক্রির ভিত্তিতে" লেবেল প্রতিটি সারিতে), velocity টেবিল (30/60/90 window), dead-stock টেবিল + CSV ডাউনলোড, valuation কার্ড (coverage সতর্কতাসহ)।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **307 suites / 3048 tests** (baseline 304/3000 ⇒ +3 suite/+48 test: ec26-reconciliation 28, ec26-accounting-collections 3, ec33 17) — ৪টি chunk-এ চালানো (একক-প্রসেস full run এই sandbox-এ OOM-এ Killed হয়, batch-এর বাইরের কারণে)। একমাত্র ব্যর্থতা `cx3-debounce` — CX যুগের পরিচিত intermittent ফ্লেক (B13 inbox ছোঁয়নি); standalone পরপর ২ রানে **18/18 pass** |
| API tsc | ✅ exit 0 (দুবার — subagent পর্বের পর ও চূড়ান্ত) |
| Web vitest | ✅ **217/217** (34 files) |
| Web tsc | ✅ exit 0 |
| Build | ✅ সব প্যাকেজ exit 0 (contracts/db/ui/api/worker tsc, web `next build`, admin `next build`) — route table-এ `/dashboard/commerce/reconciliation` + `/dashboard/commerce/inventory-intelligence` |
| Prisma validate | ✅ exit 0 |
| **Fresh-DB migration sequence** | ✅ **145/145 clean** — throwaway PostgreSQL 16 (local binary, /tmp cluster) -এ পুরো sequence `prisma migrate deploy` exit 0; `_prisma_migrations`-এ 145 finished, 0 failed/অসমাপ্ত; 192টি টেবিল; EC26-এর codCollected* কলাম উপস্থিত যাচাইকৃত। Cluster পরে মুছে ফেলা হয়েছে |

## Migration ও deploy নোট

- `20261013530000_ec26_cod_reconciliation` (CourierShipment-এ 3টি nullable কলাম + 3টি নতুন টেবিল), `20261013540000_ec33_inventory_intelligence` (1টি টেবিল) — tree-তে মোট এখন **145টি migration**, সবই additive। উপরের fresh-DB যাচাই এই tree-র উপরেই হয়েছে (141 + B12-এর 2 + B13-এর 2); **কোনো আসল DB-তে এখনো একটিও চালানো হয়নি** — deploy-এ `migrate deploy` বাধ্যতামূলক।
- নতুন env/job লাগে না। Reconciliation সম্পূর্ণ staff-চালিত import; কোনো scheduler নেই।

## সৎ সীমা

- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত। আসল courier settlement sheet দিয়ে import কখনো হয়নি; শিটের ফরম্যাট বৈচিত্র্য (header নাম, অতিরিক্ত কলাম, বাংলা/ইংরেজি মিশ্রণ) বাস্তবে আরও বেশি হতে পারে — mapping ব্যবস্থা সেই বৈচিত্র্যের জন্যই, তবে EC26-র আসল পরীক্ষা হবে merchant-এর প্রথম আসল শিটে (EC12/M30 live sprint এখনো খোলা)।
- **Reconciliation শিটের মানের উপরই নির্ভরশীল:** শিটে ভুল পরিমাণ থাকলে সেটাই "সত্য" হিসেবে stamp হয় (amount_mismatch হিসেবে দৃশ্যমান থাকে); সিস্টেম courier-এর টাকা independently যাচাই করতে পারে না — কোনো courier API দাবি করা হয়নি।
- একই import-এ matched হওয়া shipment-এর `codCollectedAt` সব সারিতে import-এর মুহূর্ত — শিটে আলাদা collection তারিখের কলাম থাকলেও তা পড়া হয় না (v1 সীমা; statusColumn শুধু সংরক্ষিত হয়, সিদ্ধান্তে ব্যবহৃত হয় না)।
- **Velocity/forecast আনুমানিক** — অতীত বিক্রির গড়; মৌসুম/প্রচারণার উত্থান-পতন ধরে না। UI ও API-তে "আনুমানিক" লেবেল আছে; এগুলো প্রতিশ্রুত সংখ্যা নয়।
- Dead-stock/valuation-এ খরচ ProductCost ইতিহাস থেকে — কোনো পণ্যের খরচ কখনো রেকর্ড না হলে তার মূল্য হিসাবের বাইরে থাকে এবং তা গণনায় (unvaluedCount) দেখানো হয়, লুকানো হয় না।
- Stock আগের মতোই org-global (warehouse-ভিত্তিক balance নয়) — intelligence-ও সেই granularity-তেই।
