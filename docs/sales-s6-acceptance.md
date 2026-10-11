# Sales & Data S6 — Product Sales Report + Variant Management UI: Acceptance

Sales & Data Remaining Package-এর Milestone S6। দুটি অংশ:
(A) পণ্যভিত্তিক বিক্রি রিপোর্ট — আসল `Order` / `OrderItem`
রেকর্ড থেকে, Analytics-এর revenue নিয়মে; (B) ভ্যারিয়েন্ট
সম্পাদনা/মোছা (API + Products পেজের ভ্যারিয়েন্ট ম্যানেজার),
যেখানে ট্র্যাক করা স্টক বদল S1-এর inventory ledger দিয়েই যায়।

## Part A — সংজ্ঞা (হুবহু)

### Revenue rule

- `REVENUE_EXCLUDED_STATUSES = ["cancelled", "refunded", "failed"]`
  — `apps/api/src/analytics/analytics.service.ts` থেকে export করা
  ধ্রুবকটি হুবহু import করে পুনঃব্যবহার করা হয়েছে
  (`ProductsService.salesReport`); নতুন করে সংজ্ঞায়িত করা হয়নি।
  এই status-এর অর্ডার রিপোর্টে আসে না।

### Effective date ও window

- অর্ডারের তারিখ = `placedAt ?? createdAt`। Query-তে এটি OR
  হিসেবে প্রকাশিত: `placedAt` window-তে থাকা অর্ডার, অথবা
  `placedAt: null` এবং `createdAt` window-তে থাকা অর্ডার।
- `days`: undefined / null / `""` → 30; নইলে integer 1..365,
  নইলে `BadRequestException("days must be an integer between 1 and 365")`
  — CRM C6/C5-এর হুবহু একই শৃঙ্খলা।
- Window: `end = dhakaDayStartUtc(now) + 86400000`;
  `start = end − days × 86400000` (Asia/Dhaka দিন, আজসহ;
  `dhakaDayStartUtc` আসে `apps/api/src/crm/lead-followups.ts` থেকে)।
  Fetch cap 20,000 order।

### Returned derivation — দুটি পথই

একটি অর্ডার "returned" ধরা হয় যদি—

1. অর্ডারের নিজের `status === "returned"`, **অথবা**
2. ঐ অর্ডারের সঙ্গে যুক্ত যেকোনো `CourierShipment`-এর
   `classifyShipmentStatus(status) === "returned"`
   (S5-এর pure helper, `apps/api/src/courier/courier-performance.ts`)।

`returnedUnits` = returned অর্ডারগুলোর সংশ্লিষ্ট আইটেমের
quantity-র যোগফল (bucket অনুযায়ী)।

### Aggregation

- আয় (revenue) = `OrderItem.totalMinor`-এর BigInt যোগফল
  (line total সংরক্ষিত থাকে); response-এ money সবসময় string।
- পণ্য bucket: `productId` থাকা আইটেমের জন্য — units, distinct
  orders, revenue, returnedUnits।
- পণ্যের নাম/ক্যাটাগরি: জীবিত `Product` row থেকে। Product row
  না থাকলে (মুছে যাওয়া পণ্য) নাম = ঐ productId-র প্রথম আইটেমের
  সংরক্ষিত `name`, ক্যাটাগরি = null।
- ক্যাটাগরি bucket: শুধু linked (productId থাকা) আইটেম থেকে;
  ক্যাটাগরি null হতে পারে — null-ই আলাদা bucket।
- **Unlinked treatment:** `productId` null আইটেম কোনো পণ্য বা
  ক্যাটাগরি bucket-এ যায় না; সেগুলো আলাদা `unlinked` bucket-এ
  units / orders / revenue / returnedUnits হিসেবে থাকে।
- **Sort ও cap:** পণ্য revenue descending, সমান হলে name
  ascending; সর্বোচ্চ 100টি row। ক্যাটাগরি revenue descending
  (কোনো cap নেই)।
- **Totals semantics:** সব kept আইটেমের উপর — মোট units,
  **distinct orders overall** (সব bucket মিলিয়ে অনন্য অর্ডার),
  মোট revenue, মোট returnedUnits। প্রতি ক্যাটাগরির `orders`
  হলো ঐ ক্যাটাগরি ছোঁয়া distinct অর্ডার — একটি অর্ডার যে
  কটি ক্যাটাগরি ছোঁয়, সে কটিতেই গণনা হয় (তাই ক্যাটাগরিগুলোর
  orders-এর যোগফল totals.orders-এর চেয়ে বেশি হতে পারে)।

### Endpoint

```
GET /organizations/:organizationId/products/sales-report?days=30
→ { days, windowStart, windowEnd, revenueExcludedStatuses,
    products: [{ productId, name, category, units, orders, revenueMinor, returnedUnits }],
    categories: [{ category, units, orders, revenueMinor, returnedUnits }],
    unlinked: { units, orders, revenueMinor, returnedUnits },
    totals: { units, orders, revenueMinor, returnedUnits } }
```

Controller-এ হ্যান্ডলারটি `@Get(":productId")`-এর **আগে**
ঘোষিত, নইলে `"sales-report"` product id হিসেবে ধরা পড়ত।
Read-only — অতিরিক্ত কোনো `@Roles` guard নেই (list/getOne-এর মতো)।

## Part B — Variant update/delete

### Endpoints ও role gates

```
PATCH  /organizations/:organizationId/products/:productId/variants/:variantId
       @Roles(OWNER, ADMIN, MARKETING_MANAGER)   (WRITE_ROLES)
DELETE /organizations/:organizationId/products/:productId/variants/:variantId
       @Roles(OWNER, ADMIN)
```

`UpdateVariantDto` — সব optional: `name` (string, 1..200),
`sku` (string, ≤100), `price` (string, decimal), `stockQuantity`
(int, ≥0)।

### নিয়ম

- Tenant scope + 404: প্রথমে `getOne(organizationId, productId)`;
  variant খোঁজা হয় `{ id: variantId, productId }` দিয়ে — অন্য
  পণ্যের variant বা অন্য org-এর পণ্য দুটোই
  `NotFoundException("Variant not found for this product")` /
  পণ্যের 404 দেয়।
- **SKU conflict rule:** নতুন SKU দিলে একই পণ্যের অন্য variant-এ
  একই SKU থাকলে
  `ConflictException("A variant with SKU <sku> already exists on this product")`।
  নিজের বর্তমান SKU রাখা conflict নয়; অন্য পণ্যে একই SKU চলবে।
- `price: ""` পাঠালে price override মুছে যায় (`priceMinor = null`
  — পণ্যের দাম প্রযোজ্য); decimal string দিলে `parseMoney` দিয়ে
  minor-এ রূপান্তর।
- **Stock routing:** S1-এর product update-এর branching হুবহু
  mirror করা — inventory উপস্থিত **এবং** variant ইতিমধ্যে
  tracked (`stockQuantity != null`) **এবং** মান বদলাচ্ছে, তখন
  stock সরাসরি লেখা হয় না; বাকি field update-এর পরে
  `InventoryService.adjust(..., { variantId, setTo, note: "ভ্যারিয়েন্ট সম্পাদনা থেকে স্টক হালনাগাদ" })`
  মান + `StockMovement` (reason `manual_adjustment`) + audit
  লেখে। **Baseline exception:** untracked (null) → tracked হওয়া
  একটি plain write — কোনো movement নয়, কারণ এটি ভিত্তি সংখ্যা,
  কোনো delta নয়। মান একই থাকলেও কোনো movement হয় না।
- **Audit:** update-এ `product.variant.update`, delete-এ
  `product.variant.delete` — entityType `ProductVariant`,
  entityId = variantId, metadata `{ productId }`।
- **Delete semantics:** variant row মুছে যায় এবং
  `{ deleted: true, productId, variantId }` ফেরত আসে। Variant-কে
  reference করা আগের `StockMovement` row ledger-এ থেকে যায় —
  ইতিহাস মোছা হয় না।

### Web — Products পেজ

- "📊 পণ্য বিক্রি" প্যানেল: 7/30/90 দিনের select, পণ্য টেবিল
  (পণ্য | ক্যাটাগরি — null হলে "ক্যাটাগরি নেই" | ইউনিট |
  অর্ডার | রিটার্ন (ইউনিট) | আয়, `formatMinor` দিয়ে), মোট
  লাইন, ক্যাটাগরি mini-table, `unlinked.units > 0` হলেই
  লিংকহীন আইটেমের লাইন, এবং হিসাবের নিয়মের ছোট্ট ব্যাখ্যা।
- প্রতিটি পণ্য row-তে "ভ্যারিয়েন্ট" বোতাম (স্টক সমন্বয়ের
  পাশে) → আলাদা variant manager dialog: product detail থেকে
  variants লোড হয়; উপরে create form; প্রতি row-তে নাম, SKU,
  দাম (`priceMinor` না থাকলে "পণ্যের দামই প্রযোজ্য"), স্টক
  (null হলে "ট্র্যাক হয় না"); inline সম্পাদনা (দামের input
  BigInt division/remainder দিয়ে minor → decimal string-এ
  prefill — `@repo/contracts`-এ কোনো minor→major string helper
  নেই, `formatMinor` currency-prefix-সহ ফেরত দেয় বলে input-এর
  জন্য তা ব্যবহার করা হয়নি) এবং `window.confirm` দিয়ে মুছুন।
  প্রতিটি সফল mutation-এর পরে detail variants refetch এবং
  পণ্য টেবিল `load(search)` দিয়ে refresh হয়।

## ফাইলের তালিকা

- `apps/api/src/products/products.service.ts` — `salesReport`,
  `updateVariant`, `deleteVariant`।
- `apps/api/src/products/products.controller.ts` —
  `GET sales-report` (`:productId`-এর আগে), variant PATCH/DELETE।
- `apps/api/src/products/products.dto.ts` — `UpdateVariantDto`।
- `apps/api/src/products/sales-report.spec.ts` — নতুন স্পেক।
- `apps/api/src/products/variant-management.spec.ts` — নতুন স্পেক।
- `apps/web/src/app/dashboard/products/page.tsx` — রিপোর্ট
  প্যানেল + variant manager; `VariantItem.priceMinor`।
- `docs/sales-s6-acceptance.md` — এই নথি।

## Test evidence

- `cd apps/api && npx jest src/products --runInBand` —
  **Test Suites: 3 passed, 3 total; Tests: 16 passed, 16 total**
  (নতুন 12টি: sales-report 3টি — হাতে-হিসাব করা fixture-এর
  প্রতিটি সংখ্যা, OR-where আকারের spy assert, days validation,
  empty org; variant-management 9টি — name/price/sku,
  price-clear, তিনটি 404, SKU conflict/scope, tracked stock-এ
  movement `delta -6 / balanceAfter 4`, untracked baseline-এ
  movement নেই, একই মানে movement নেই, delete + পুনঃdelete
  404; বাকি 4টি pricing-এর আগের স্পেক)।
- `cd apps/api && npx tsc -p tsconfig.json --noEmit` — clean (exit 0)।
- `cd apps/web && npx tsc --noEmit` — clean (exit 0)।
- **Full gate (coordinator):** পুরো API suite **1013/1013 PASS (137 suites)**; web tests **39/39 PASS**; monorepo build (`pnpm -r build`) green।
- **Live HTTP যাচাই (coordinator):** built API আলাদা port (:4100)-এ তুলে আসল Postgres-এর বিরুদ্ধে scripted check — **21/21 PASS**: register → org → product + 2টি variant API দিয়ে তৈরি (price "1200.50" → priceMinor "120050") → order seed (completed ×2 ইউনিট, processing ×1 + তার shipment returned, cancelled ×5) → sales-report-এ product row {units 3, orders 2, revenueMinor "300000", returnedUnits 1} হুবহু, Fashion category ও totals একই (cancelled পুরোপুরি বাদ), route `:productId`-তে capture হয়নি → variant PATCH stock 10→4-এ response 4 এবং DB-তে StockMovement {delta −6, balanceAfter 4, manual_adjustment, variantId-সহ}; price "" → priceMinor null; duplicate SKU → 409; variant DELETE → `deleted: true`, detail-এ আর নেই, ledger row থেকে গেছে। Seed করা সব data যাচাই শেষে মুছে ফেলা হয়েছে (leftover 0)।

## নোট

এটি local work only — coordinator local commit করেছে, কিন্তু
কিছুই GitHub-এ push করা হয়নি; push owner-এর সুস্পষ্ট
নির্দেশের জন্য অপেক্ষা করবে।
