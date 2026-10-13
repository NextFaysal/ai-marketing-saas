# E-Commerce Batch B3 (EC5 + EC9) — Acceptance

**তারিখ:** 2026-10-13 · **ব্রাঞ্চ:** `ec-package` (base B2 `fe31f2b`) · **স্ট্যাটাস:** সম্পূর্ণ, লোকাল কমিট পর্যন্ত — **push হয়নি** (মালিকের নির্দেশ ছাড়া push নয়)।
**প্ল্যান:** `files/Ecommerce-Full-System-Plan-2026-10-12.md` §২ (sync mode — order push co-manage থেকে), §৩ ম্যাট্রিক্স (Shopify status সততা), §৪ EC5/EC9, §৯ item 2 (refund-push owner decision)।

---

## যা তৈরি হয়েছে

### EC5 — Schema (কমিট `08c35f6`, মাইগ্রেশন `20261013040000_ec5_order_tower`)

- `Store.refundPushEnabled` **Boolean DEFAULT false** + `Store.courierTrackingMetaKey` (nullable)।
- `Order.storeDraftId` / `Order.storeInvoiceUrl`।
- Store-push ফলাফলের mirror হিসেবে বিদ্যমান `Order.storeSyncStatus/storeSyncError`-ই পুনঃব্যবহৃত (সিদ্ধান্তটি এখানে লিপিবদ্ধ: chat order-এর জন্য তৈরি এই ফিল্ড জোড়াই এখন সব order push-এর "শেষ ফলাফল")।

### EC5 — Adapters (কমিট `92bef5c`)

নতুন অপারেশন দুই প্ল্যাটফর্মেই capability **true**: `push_order_status`, `create_fulfillment`, `push_order_note`, `push_refund`, `cancel_order`, `push_order_address`, `create_draft_order` (Native সব false)। নতুন ফাইল: `integrations/commerce/order-content.ts` (shared loader + sync mirror), `woo-orders.ts`, `shopify-orders.ts`।

- **Woo (REST):** status = `PUT /orders/{id}` + GET read-back মিলিয়ে যাচাই; cancel = একই পথে `cancelled`; fulfilment = customer note (tracking text) + `meta_data` `tracking_provider`/`tracking_number` (+ স্টোরে `courierTrackingMetaKey` সেট থাকলে সেই key-তেও), read-back = notes তালিকায় tracking code খুঁজে পাওয়া; refund = `POST /orders/{id}/refunds` — restock শুধু Woo-র আসল line_items আকৃতিতে, এবং শুধু যখন refund amount মিলে যাওয়া remote line গুলোর মোটের সমান হয় (আংশিক amount-only refund-এ line নাম করা সত্যিকারভাবে সম্ভব নয় — response summary-তে `restockApplied` বলে দেওয়া হয়); address = `shipping.address_1` (free string — documented সীমা); draft = `POST /orders {status:"pending"}` (chat-order createOrder পথের সাধারণ রূপ) — সফল হলে local order-টি `externalId/source/storeId` দিয়ে store order-এর সঙ্গে যুক্ত হয়, read-back-এ status pending যাচাই হয়।
- **Shopify (GraphQL 2025-10):** status-এর **সৎ subset** — `cancelled` → `orderCancel` mutation + read-back; `pending/processing/on-hold` → remote খোলা (cancelled/closed নয়) যাচাই; `completed` → শুধু remote `displayFulfillmentStatus=FULFILLED` হলেই ok; বাকি সব (refunded/failed/returned) → ব্যর্থ, verbatim **`no_shopify_equivalent`**। Payment state কখনো বানিয়ে দেখানো হয় না। Fulfilment = খোলা fulfillmentOrder-এর বিপরীতে `fulfillmentCreateV2` + trackingInfo (number + courier company; **url বাদ** — নিচে সীমা দেখুন), read-back-এ tracking number মিলিয়ে যাচাই। Refund = `refundCreate` — parent transaction (SUCCESS SALE/CAPTURE) দিয়ে amount refund; parent না থাকলে verbatim `shopify_refund_no_parent_transaction`; restock চাইলে default `StoreLocation` map থাকলে সব line-এ `restockType: RETURN` (location না থাকলে amount পথে fallback, summary-তে বলা)। Note = `orderUpdate {note}` (Shopify-র note একটিই field — SaaS থেকে পাঠানো note সেটিই প্রতিস্থাপন করে; read-back যাচাই)। Address = structured parts না থাকলে কোনো API call ছাড়াই verbatim **`shopify_address_needs_structured_fields`**। Draft = `draftOrderCreate` → `invoiceUrl` read-back যাচাইসহ `storeDraftId`/`storeInvoiceUrl`-এ সংরক্ষিত; client-credentials token refresh EC3-র `resolveShopifyClient` পুনঃব্যবহার করে।
- প্রতিটি op-এর ফলাফল Order-এর `storeSyncStatus/storeSyncError`-এ mirror হয়; platform error verbatim outbox row-তেও থাকে।

### EC5 — OrderPushService + hooks (কমিট `92bef5c`)

- `commerce/order-push.service.ts` (CatalogPushService-এর sibling): enqueue হয় শুধু **co-manage/full-manage** স্টোরে; mirror-এ কিছুই queue হয় না।
- **REFUND SAFETY GATE (প্ল্যান §৯):** `Store.refundPushEnabled !== true` হলে refund record (S2 আচরণ) সম্পূর্ণ লোকাল থাকে — কোনো `push_refund` enqueue হয় না, সার্ভিস `{gated:true, reason:"refund_push_disabled"}` ফেরত দেয়, UI-তে "স্টোরে refund push বন্ধ আছে" দেখায়। Toggle শুধু **OWNER** রুটে (`PATCH commerce/stores/:id/refund-push`, RolesGuard) ও audit-logged (`store.refund_push_toggle`)।
- **Hooks (সব `@Optional` + failure-isolated; `OrdersService`-এর constructor-এ LAST প্যারামিটার):** S2 PATCH-এ status change → status/cancel enqueue; refund record → gate-সাপেক্ষে refund enqueue; address change (PATCH DTO-তে নতুন `address` ফিল্ড) → address enqueue। **Internal note কখনো push হয় না** — hook-ই নেই, স্পেকে প্রমাণিত।
- **Manual অ্যাকশন:** `POST orders/:id/store-note` (customer-visible note enqueue), `POST orders/:id/create-store-draft {storeId?}` — enqueue + শুধু ওই row প্রসেস (`SyncOutboxService.processDue`-তে নতুন `onlyId` অপশন) করে তখনই ফল জানায়; ইতিমধ্যে store-এ থাকা অর্ডারে Bengali 400 দিয়ে refusal; কোন স্টোর নেবে — order-এর স্টোর, না হলে একমাত্র eligible স্টোর, একাধিক হলে storeId চাওয়া হয়।
- **Commerce endpoints:** `GET commerce/orders/:orderId/push-state` (store, mode, gate, last status/error verbatim, draft/invoice, শেষ ১০টি push), `PATCH commerce/stores/:id/tracking-meta-key`।
- S2-র পিন করা nothing-sent 400 বার্তাটি হুবহু রাখা হয়েছে (address accepted ফিল্ড হলেও বার্তা বদলায়নি — full jest এই contract ধরে ফেলেছিল, কমিট `194a53d`)।

### EC5 — Web (কমিট `fa43cdb`)

Orders পেজে **স্টোর সিঙ্ক প্যানেল** (push-state থেকে): স্টোর/মোড, mirror ব্যাখ্যা, শেষ push status + verbatim error, সাম্প্রতিক push তালিকা, refund gate অবস্থা, store-note composer (customer-visible বলে স্পষ্ট লেখা), create-store-draft বোতাম + invoice link copy, রিটার্ন লিংক তৈরি + copy, invoice/packing-slip print লিংক। Sync Center-এর স্টোর সেকশনে refund-push toggle (OWNER ছাড়া চাপলে RolesGuard-এর verbatim error-ই দেখায়) + tracking meta key ইনপুট।

### EC9 — Fulfillment (কমিট `48f6832` API + `fa43cdb` web; মাইগ্রেশন `20261013050000_ec9_fulfillment_returns`)

- `Fulfillment` মডেল (items Json, PARTIAL): বাকি পরিমাণ read-এ হিসাব (ordered − non-cancelled fulfilment গুলোর যোগ)। CRUD API + একটি fulfilment-এ courier shipment/tracking থাকলে EC5 `create_fulfillment` push **ঠিক একবার** (`storePushEnqueuedAt` marker; দেরিতে tracking বসলেও একবারই)।
- **Dispatch board** (`/dashboard/commerce/dispatch`): Dhaka-দিনের + pending/packed fulfilment, কুরিয়ারভেদে grouping, per-item packed checkbox (সব packed হলে status নিজে packed), packed → handed_over বোতাম।
- **Handover manifest:** কুরিয়ার + দিন অনুযায়ী আসল fulfilment/shipment row থেকে তৈরি printable তালিকা (tracking, order number, item count, মোট parcel)।
- **Invoice + packing slip** (`/dashboard/commerce/print?orderId=&kind=invoice|slip`): সংরক্ষিত অর্ডার থেকেই সব সংখ্যা (পুনঃহিসাব নয়); invoice-এ COD প্রাপ্য বড় করে; packing slip-এ **কোনো দাম নেই**।

### EC9 — Returns & RMA (একই কমিট জুটি)

- `ReturnRequest` মডেল + token: staff অর্ডার থেকে লিংক তৈরি করেন; public পেজ `/returns/[token]` (login নেই, token-ই credential; public review/tracking প্যাটার্ন)। কাস্টমার reason + পরিমাণ জমা দেন (অর্ডারের পরিমাণে সীমাবদ্ধ; দ্বিতীয় জমা refused)।
- Staff ফ্লো: approve/reject (resolution refund|exchange|store_credit_note), return courier booking (**বিদ্যমান `CourierService.bookShipment`** — মার্চেন্ট প্রাপক হিসেবে, BusinessProfile-এর ঠিকানা/ফোন; না থাকলে সৎ 400), received (per-item condition → restockDecision), complete:
  - **Restock:** per-line S1 ledger adjustment (reason `return_restock`) — whole-order `applyOrderRestore` নয়, কারণ সেটি কাস্টমারের রেখে দেওয়া লাইনও ফেরত দিত এবং অর্ডারের একমাত্র restore slot খেয়ে ফেলত। Exactly-once = `restockAppliedAt` marker (ledger লেখার **আগে** সেট) + status gate।
  - **Refund:** S2 refund পথ দিয়েই record — ফলে EC5 gate প্রযোজ্য: gate on হলে store push enqueue, off হলে শুধু লোকাল record (UI-তে অবস্থা দেখায়)। Refund record ব্যর্থ হলে completion আটকায় না; কারণ staffNote-তে verbatim থাকে।
  - **Exchange:** `createManual` দিয়ে নতুন অর্ডার, `exchangeOrderId`-তে যুক্ত; কাস্টমারের ফোন না থাকলে সৎ 400।
  - **store_credit_note:** শুধু record — কোনো money instrument তৈরি হয় না (postponed সিদ্ধান্ত অক্ষুণ্ণ)।
- **Notifications:** প্রতিটি status বদলে — linked conversation থাকলে InboxService automated message, নইলে customer email থাকলে EmailProvider, নইলে `notificationStatus = "not_sent_no_channel"` — পাঠানো হয়েছে বলে **কখনো দাবি করা হয় না**; প্র্যাক্টিস অর্ডারে notification বন্ধ।

### স্পেক (কমিট `81f2b02`)

| ফাইল | টেস্ট | কী প্রমাণ করে |
|---|---|---|
| `ec5-orders.spec.ts` | 15 | দুই প্ল্যাটফর্মে status push + read-back, read-back mismatch verbatim, Woo fulfilment note+meta (+plugin key), Woo restock line_items আকৃতি, Shopify `no_shopify_equivalent` (refunded + unfulfilled completed), orderCancel, tracking read-back (+url অনুপস্থিত), refundCreate parent transaction, Shopify draft invoiceUrl সংরক্ষণ + duplicate refusal, address structured-fields refusal (শূন্য API call), Woo draft link + not-in-store refusal |
| `ec5-order-push.spec.ts` | 11 | mirror = শূন্য enqueue; co-manage status/cancel enqueue + outbox process; **refund gate OFF = কোনো enqueue নয়, ON = push_refund**; internalNote কখনো push নয়; address enqueue; draft duplicate refusal; pushState; foreign id 404 |
| `ec9.spec.ts` | 11 | partial পরিমাণের হিসাব + অতিরিক্ত refuse, default all-remaining, tracking push exactly-once, packed flip, manifest আসল row থেকে, return পূর্ণ চক্র (token submit সীমা + পুনঃজমা refuse → approve → received restock → complete: restock ঠিক একবার + refund record + inbox notification), return courier (মার্চেন্ট প্রাপক), exchange order তৈরি, no-channel সততা, email fallback, খারাপ token/foreign org 404 |
| `ec-di.spec.ts` (হালনাগাদ) | 1 | আসল Nest graph-এ OrderPushService OrdersService-তে injected, Fulfillment/Returns resolve হয়, দুই প্ল্যাটফর্মে order capability true / native false |

## গেট (সব সবুজ — coordinator নিজে চালিয়ে)

| গেট | ফলাফল |
|---|---|
| Prisma validate | ✅ valid |
| API jest (full) | ✅ **232 suites, 2078/2078** (B2: 229/2041 → +3 suites, +37 tests; প্রথম রানে S2-র পিন করা বার্তার ১টি failure ধরা পড়ে ও ঠিক করা হয় — `194a53d`) |
| API tsc | ✅ 0 errors |
| Web vitest | ✅ 20 files, **140/140** (নতুন পেজগুলোর আলাদা unit test নেই — B2-র মতো typecheck + build দিয়ে যাচাই) |
| Web tsc | ✅ 0 errors |
| Production build | ✅ সব প্যাকেজ (contracts/db/ui/api) + next build green; নতুন রুট `/dashboard/commerce/dispatch`, `/returns`, `/print`, `/returns/[token]` build আউটপুটে আছে |
| DI | ✅ ec-di spec-এ প্রমাণিত (উপরে) |

বিল্ড নোট: এই sandbox shell-এ `pnpm` binary PATH-এ নেই; build চালানো হয়েছে প্রতিটি workspace প্যাকেজের নিজের `build` script দিয়ে (যা `pnpm -r build` চালাত) — contracts/db/ui/api tsc builds + `next build` (exit 0)।

## কমিটসমূহ

| কমিট | বিষয় |
|---|---|
| `08c35f6` | EC5+EC9 schema + মাইগ্রেশন 2টি |
| `92bef5c` | EC5 adapters + OrderPushService + S2 hooks + commerce routes |
| `48f6832` | EC9 API (fulfillment + returns) |
| `81f2b02` | EC5+EC9 specs + ec-di হালনাগাদ |
| `194a53d` | fix: S2 পিন করা বার্তা হুবহু পুনরুদ্ধার |
| `fa43cdb` | EC5+EC9 web |

## মাইগ্রেশন ও deploy নোট

- `20261013040000_ec5_order_tower`, `20261013050000_ec9_fulfillment_returns` — **কোনো আসল DB-তে চালানো হয়নি**; deploy-এ `prisma migrate deploy` লাগবে, নইলে Store/Order-এর নতুন কলাম ও Fulfillment/ReturnRequest endpoint 500 দেবে।
- Order push আসলে প্রসেস হতে per-org Automations-এ `sync_outbox` job চালু থাকা দরকার (B1 থেকেই একই শর্ত)। Draft তৈরি সেই মুহূর্তেই নিজের row প্রসেস করে, job ছাড়াও চলে।
- **Refund push ডিফল্টে বন্ধই থাকবে** deploy-এর পরেও — প্রতিটি স্টোরে OWNER-কে Sync Center থেকে স্পষ্টভাবে চালু করতে হবে।

## সৎ সীমা ও বিচ্যুতি

- **কোনো live Woo/Shopify স্টোরে প্রমাণ হয়নি** — সব fixture/stub-fetch/spec-প্রমাণিত। Live verification EC12/M30-তে মালিকের আসল স্টোর দিয়ে হবে।
- **Shopify mutation আকৃতি fixture-অনুমান:** `fulfillmentCreateV2`, `orderCancel`, `refundCreate`, `draftOrderCreate` 2025-10 ডক অনুযায়ী লেখা; live-এ কোনো input field বদলে থাকলে (যেমন orderCancel-এর required args) Shopify-র verbatim userError outbox-এ দেখা যাবে এবং EC12-তে ঠিক করা যাবে। `orderCancel` job-ভিত্তিক — read-back-এ তখনো cancelled না দেখালে push **failed** হিসেবেই থাকে (সফল দাবি করা হয় না), replay/পরে যাচাই করা যাবে।
- **Shopify tracking URL বাদ:** কোনো কুরিয়ারের public tracking-URL প্যাটার্ন এই কোডবেসে নেই, তাই `trackingInfo.url` পাঠানো হয় না (বানিয়ে দেওয়া হয়নি)।
- **Woo ঠিকানা/ট্র্যাকিং সীমা:** address শুধু `shipping.address_1`; tracking core field নেই বলে note + meta পথ — কাস্টমার ইমেইলে note যাওয়া Woo-র নিজের সেটিংসের উপর নির্ভরশীল।
- **Shopify refund restock:** line মেলানো local order items-এর ক্রম ধরে নয়, remote state-এর সব line পূর্ণ পরিমাণে RETURN করা হয় যখন default location map থাকে; আংশিক restock Shopify-তে এই ব্যাচে সমর্থিত নয় (amount পথে যায়, summary-তে বলা থাকে)।
- **Return courier আসল reverse logistics নয়:** provider দের এই কোডবেসে return-product নেই — booking একটি সাধারণ পার্সেল, মার্চেন্ট প্রাপক; provider পিকআপ সুবিধা দেবে কিনা তা তাদের নীতির উপর নির্ভরশীল।
- **Restock পথের বিচ্যুতি (উপরে যুক্তিসহ):** task-এর "S1 restore path" বলতে whole-order `applyOrderRestore` না করে per-line `adjust` (reason `return_restock`) ব্যবহার হয়েছে; একই S1 ledger, একই exactly-once শৃঙ্খলা, কিন্তু আংশিক return-এ সত্যিকারের পরিমাণই ফেরে।
- **Public return পেজে rate-limit:** বিদ্যমান public পেজগুলোর (review/tracking) মতোই token-unguessability-ই প্রতিরক্ষা; আলাদা rate-limiter এই ব্যাচে যোগ হয়নি।
- Dispatch board-এর "আজ" = fulfilment **তৈরির** Dhaka-দিন; আগের দিনের pending/packed-ও বোর্ডে থাকে (ইচ্ছাকৃত, যাতে কিছু হারিয়ে না যায়)।
