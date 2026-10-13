# E-Commerce Phase 2 — Batch B10 (EC20 + EC21 + EC22) Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-phase2` (base GitHub main `3e24bc1`, B9-এর উপর) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Phase2-Plan-2026-10-13.md` §৪ EC20 + EC21 + EC22।

## কমিট

| Hash | বিষয় |
|---|---|
| `acb5430` | Schema + migrations `20261013250000_ec20_purchasing`, `20261013260000_ec21_warehouse`, `20261013270000_ec22_delivery_ops` |
| (EC20 কমিট) | EC20 backend: purchasing মডিউল (suppliers, purchase orders, receive, reorder suggestions) + specs |
| (EC21 কমিট) | EC21 backend: warehouse মডিউল (warehouses, bins, assignments, stock counts) + dispatch board-এ bin code + specs |
| (EC22 কমিট) | EC22 backend: courier rules + bookShipment auto-select + tracking URL template + delivery (riders) + EC18 tracking-এ trackingUrl + module wiring + specs |
| (Web কমিট) | Web: purchasing/warehouse/labels পেজ, CODE128 lib, commerce hub লিংক, orders পেজে rules/suggestion/tracking-link/rider panel |
| (এই কমিট) | এই acceptance ডক |

## EC20 — Purchasing & Suppliers

- **Supplier CRUD** (`commerce/suppliers`): name আবশ্যক; DELETE = নিষ্ক্রিয় করা (PurchaseOrder Restrict FK-র কারণে hard delete নয়)। তালিকায় প্রতি সরবরাহকারীর PO সংখ্যা।
- **PurchaseOrder চক্র:** draft → ordered → (receive-চালিত) partially_received → received; বাতিল যেকোনো সক্রিয় অবস্থা থেকে। Items শুধু draft-এ বদলানো যায়; received/partially_received হাতে বসানো যায় না (400 — receiving-ই তা নির্ধারণ করে)।
- **Receiving (একটাই সত্য পথ):** আগে সব লাইন validate (over-receive ⇒ 400, অবশিষ্ট সংখ্যাসহ — কোনো write হয় না), তারপর প্রতি লাইন **S1 `InventoryService.adjust`** দিয়ে (reason `purchase_receive`, note-এ PO id) — ledger-ই stock-এর একমাত্র ইতিহাস। Untracked পণ্য receive-এ আগে tracking প্রতিষ্ঠা (0 বসানো, কোনো movement নয় — S1 baseline নিয়ম), তারপর receive movement পুরো balance ব্যাখ্যা করে।
- **খরচ:** বিদ্যমান `ProductCost` history মডেলেই weighted-average নতুন রো যোগ হয় — `(আগের স্টক × আগের খরচ + প্রাপ্তি × নতুন খরচ) / (আগের স্টক + প্রাপ্তি)`; স্টক ০ বা আগের খরচ না থাকলে নতুন খরচই কার্যকর। PO item-এর অর্ডার-খরচ অপরিবর্তিত থাকে; receive-এ override খরচ দিলে সেটাই কার্যকর খরচের ভিত্তি (audit-এ লাইনভিত্তিক লেখা থাকে)।
- **Reorder suggestions** (`GET inventory/reorder-suggestions`): threshold = `Product.lowStockThreshold ?? 5` (S1-এর নিজের নিয়ম)। Tracked variant থাকলে variant-ভিত্তিক এন্ট্রি (product রো aggregate — আলাদা এন্ট্রি নয়)। suggestedQty = `max(1, threshold×2 − currentStock)` — এটি একটি **সরল পরামর্শ-নিয়ম**, sales-velocity হিসাব নয় (প্ল্যানের velocity-ভিত্তিক সংস্করণের বদলে brief-এর নির্দিষ্ট নিয়মই প্রয়োগ হয়েছে)। lastSupplier/lastUnitCost = সবচেয়ে সাম্প্রতিক non-cancelled PO থেকে। UI-তে "PO তৈরি করুন" সাধারণ create endpoint-ই ডাকে — lastSupplier না থাকলে বোতাম নিষ্ক্রিয় ও কারণ লেখা থাকে।

## EC21 — Warehouse Ops

- **Warehouse/Bin CRUD + ProductBinAssignment:** এক (warehouse, product, variant)-এর একটাই primary bin — একই পণ্য আবার assign করলে নতুন রো না হয়ে **move** হয়। Bin code প্রতি warehouse-এ unique (400)।
- **Dispatch board:** EC9 board-এর প্রতি লাইনে `binCode` (default warehouse-এর assignment থেকে; না থাকলে "—") এবং লাইনগুলো bin code অনুযায়ী সাজানো ("—" সবার শেষে — walk order)। পুরো bin লজিক failure-isolated: টেবিল/ডেটা না থাকলে board আগের মতোই চলে, সব "—"।
- **Stock count:** session তৈরিতে systemQty snapshot (bin-scoped হলে সেই bin-এর assignment থেকে; নইলে সব tracked variant + variant-হীন tracked পণ্য)। Untracked পণ্য লাইন পায় না — `skippedUntracked` হিসেবে গণনা হয়। Close-এ **শুধু counted লাইন** `InventoryService.adjust` দিয়ে (reason `stock_count`, delta = counted − snapshot systemQty); uncounted লাইন কখনো zero হয় না — skipped তালিকায় ফেরত আসে। **সীমা (নথিভুক্ত):** delta snapshot-এর বিপরীতে — snapshot-এর পর স্টক নড়লে landing balance সেই পরিমাণ সরে যায়। Closed session immutable (count/close আবার ⇒ 400)।
- **Barcode labels:** `/dashboard/commerce/warehouse/labels` print পেজ — নিজে লেখা CODE128-B encoder (নতুন কোনো dependency নয়; API প্যাকেজের `qrcode` শুধু QR-এর জন্য, barcode নয়)। Label-এর মান = আসল `barcode` থাকলে তা, নইলে SKU — caption-এ কোনটি তা লেখা থাকে; দুটোর একটিও না থাকলে পণ্য skipped তালিকায়, **কোনো বানানো নম্বর নয়**।

## EC22 — Delivery Ops

- **CourierRule:** conditions validated Json (districts / ওজন সীমা / অর্ডার-মূল্য সীমা / paymentType)। `courierAccountId` = courier Integration রো — org-এর বাইরের হলে 404, courier provider না হলে (যেমন meta) 400। Priority DESC, তারপর createdAt ASC ক্রমে প্রথম match।
- **Order facts (সৎ সীমাসহ):** district = linked customer-এর `address.district` (Json) — district না থাকা অর্ডারে district-শর্ত মেলে না। মোট ওজন = সব আইটেমের পণ্যে `weightGrams` থাকলেই হিসাব হয়; **একটিতেও না থাকলে ওজন null এবং ওজন-শর্ত কখনো মেলে না — ওজন অনুমান করা হয় না।** paymentType = `Order.isCod` থেকে।
- **প্রয়োগ:** `bookShipment`-এ provider **না দিলে** rule engine চলে; match হলে সেই provider-এ বুকিং + shipment-এ `courierRuleId` + audit `courier_auto_selected`। কোনো match না হলে আগের steadfast default-ই। **Explicit provider সবসময় জেতে** — rule প্রয়োগ হয় না (spec-প্রমাণিত, আসল booking harness-এ)। Suggestion endpoint (`GET courier/suggestion/:orderId`) একই facts+evaluate ব্যবহার করে; orders পেজ বুকিং ফর্মে suggestion এলে provider preselect করে, স্টাফ বদলাতে পারেন।
- **Tracking URL template:** Integration রোতে plain column (credential blob-এর বাইরে — এটি গোপন নয়)। `{trackingId}` থাকা বাধ্যতামূলক (400 নইলে); substitution-এ URL-encode হয়। যেখানে tracking লিংক দেখানো হয় — staff shipment তালিকা, CX6 public tracking (`/t`), EC18 branded tracking page (`/track`) — template থাকলে `trackingUrl`, না থাকলে আগের আচরণই (শুধু নম্বর; **কোনো provider-এর URL বানানো হয়নি** — আগেও কোনো built-in provider URL ছিল না)।
- **Own-rider:** Rider CRUD + DeliveryAssignment (assigned → picked_up → delivered/returned)। এক অর্ডারে একটাই সক্রিয় (assigned/picked_up) assignment (service-এ enforced; DB unique দিয়ে "while active" প্রকাশ করা যায় না)। **Delivered ⇒ order `completed`** — `OrdersService.updateOrder` দিয়েই (সেই একই transition/ইনভেন্টরি/ইভেন্ট পথ); updateOrder ব্যর্থ হলে assignment অপরিবর্তিত থাকে (আগে order, পরে stamp — spec-প্রমাণিত)। **Returned অর্ডারের status ছোঁয় না** (v1 সিদ্ধান্ত: ফেরত আসা মানেই অর্ডারের ভাগ্য নির্ধারিত নয় — স্টাফ ঠিক করবেন)। Rider-এর কোনো login/app নেই — স্টাফ-চালিত রেকর্ড মাত্র। COD সংগ্রহের আলাদা রেকর্ড এই ব্যাচে নেই (assignment note-ই একমাত্র জায়গা) — প্ল্যানের "COD সংগ্রহের রেকর্ড" অংশটি v1-এ note-ভিত্তিক, নিচের সীমায় স্পষ্ট করা হলো।

## গেট (coordinator নিজে চালিয়ে, exit-code ভিত্তিক)

| গেট | ফলাফল |
|---|---|
| API jest (full) | ✅ **289 suites / 2853 tests** (baseline 283/2781 ⇒ +6 suite/+72 test: ec20-purchasing, warehouse, ec21-board, courier-rules, ec22-courier, delivery, ec18-tracking-এ +1) — ৪টি chunk-এ চালানো (sandbox-এ একক-প্রসেস রান OOM খায়, আগের ব্যাচগুলোর মতো)। এক রানে `cx3-debounce` একবার ব্যর্থ — CX যুগের পরিচিত intermittent ফ্লেক (B10 inbox ছোঁয়নি); standalone পরপর ২ রানে **18/18 pass** |
| API tsc | ✅ exit 0 |
| Web vitest | ✅ **217/217** (34 files; baseline 212 ⇒ +5 code128 test) |
| Web tsc | ✅ exit 0 |
| Build | ✅ সব প্যাকেজ exit 0 (contracts/db/ui/api `tsc`, web `next build`) — route table-এ `/dashboard/commerce/purchasing`, `/warehouse`, `/warehouse/labels`। দ্রষ্টব্য: এই shell-এ `pnpm` binary নেই বলে `pnpm -r build`-এর বদলে প্রতিটি প্যাকেজের নিজের build script একই dependency order-এ চালানো হয়েছে — স্ক্রিপ্ট হুবহু একই |
| Prisma validate | ✅ exit 0 (DATABASE_URL env দরকার শুধু config load-এর জন্য; সংযোগ লাগে না) |

## Migration ও deploy নোট

- `20261013250000_ec20_purchasing`, `20261013260000_ec21_warehouse`, `20261013270000_ec22_delivery_ops` — **কোনো আসল DB-তে চালানো হয়নি**; deploy-এ `migrate deploy` বাধ্যতামূলক। সবই additive (নতুন টেবিল + `CourierShipment.courierRuleId` + `Integration.trackingUrlTemplate` nullable কলাম)।
- নতুন কোনো env/job লাগে না। Courier rules কোনো schedule ছাড়াই booking-এর সময় মূল্যায়িত হয়।

## সৎ সীমা

- **Live প্রমাণ নেই** — সব fixture/spec-প্রমাণিত। কোনো আসল courier বুকিং, supplier receive বা rider delivery live অ্যাকাউন্টে হয়নি (EC12 live sprint এখনো খোলা)।
- **স্টক org-global-ই থাকে** — warehouse অনুযায়ী balance ভাগ হয়নি (S1 মডেল); warehouse শুধু bin + count session-এর মালিক। Multi-warehouse stock splitting চাইলে তা আলাদা প্যাকেজ।
- **Reorder suggestion সরল নিয়ম** (threshold×2 − stock) — sales velocity/lead-time হিসাব নয়।
- **Stock-count delta snapshot-ভিত্তিক** — গণনার মাঝে স্টক নড়লে landing balance সরতে পারে (উপরে নথিভুক্ত)।
- **Rider COD সংগ্রহের রেকর্ড** কাঠামোবদ্ধ নয় — note ফিল্ড মাত্র; কোনো wallet/settlement নেই (নকশা অনুযায়ীই)।
- **Build প্রক্রিয়া:** চারটি build subagent daemon restart-এ মারা গিয়েছিল; তাদের লেখা ফাইল working tree-তে টিকে ছিল — coordinator প্রতিটি ফাইল যাচাই করে, নিজে integration ঠিক করেছে (API `{items}` wrapper বনাম web bare-array অমিল ৮ জায়গায় unwrap; orders পেজে একটি useCallback ordering tsc error; EC18 spec-এ trackingUrl প্রত্যাশা হালনাগাদ + ইতিবাচক template test যোগ) এবং পূর্ণ গেট নিজে চালিয়েছে। কোনো agent-এর self-report-এর উপর ভরসা করা হয়নি — সব সংখ্যা coordinator-এর নিজের রান থেকে।
