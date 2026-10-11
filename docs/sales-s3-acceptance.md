# Sales & Data S3 — Orders CSV Export: Acceptance

Sales & Data Remaining Package-এর Milestone S3। S3-এর আগে
অর্ডার CSV **ইমপোর্ট** ছিল (M65), কিন্তু এক্সপোর্ট ছিল না —
মার্চেন্ট নিজের অর্ডারের হিসাব spreadsheet-এ নিতে পারতেন না।
S3 একটি মাত্র endpoint যোগ করে:

```
GET /organizations/:organizationId/orders/export
    ?status=&cod=true|false&from=YYYY-MM-DD&to=YYYY-MM-DD
Headers: Content-Type: text/csv; charset=utf-8
         Content-Disposition: attachment; filename=orders-export.csv
অনুমতি: controller-এর class-level @PermissionArea("orders")
        + TenantGuard / RolesGuard (আলাদা write-role নয় —
        এটি একটি read/export)
```

## কলাম তালিকা (হুবহু)

এক সারি = এক অর্ডার। হেডার সারি হুবহু:

```
order_id,external_id,external_number,source,status,is_cod,payment_method,customer_name,customer_phone,customer_email,items,subtotal,shipping,discount,tax,total,refunded,currency,placed_at,created_at
```

| কলাম | উৎস |
|---|---|
| `order_id` | `Order.id` |
| `external_id` | `Order.externalId` (না থাকলে ফাঁকা) |
| `external_number` | `Order.externalNumber` (না থাকলে ফাঁকা) |
| `source` | `Order.source` (woocommerce / shopify / manual / csv …) |
| `status` | `Order.status` |
| `is_cod` | `Order.isCod` → `yes` / `no` |
| `payment_method` | `Order.paymentMethod` (না থাকলে ফাঁকা) |
| `customer_name` | `[firstName, lastName].filter(Boolean).join(" ")`, না হলে `Customer.name`, না হলে ফাঁকা |
| `customer_phone` / `customer_email` | `Customer.phone` / `Customer.email` (না থাকলে ফাঁকা) |
| `items` | সব OrderItem এক সেলে: `নাম ×পরিমাণ`, একাধিক হলে ` \| ` দিয়ে জোড়া — যেমন `Shirt ×2 \| Pant ×1` |
| `subtotal` / `shipping` / `discount` / `tax` / `total` / `refunded` | যথাক্রমে `Order.subtotalMinor / shippingMinor / discountMinor / taxMinor / totalMinor / refundedMinor` — মাইনর ইউনিট (পয়সা) থেকে `minorToMajor` দিয়ে টাকায়, ঠিক ২ ঘর দশমিক (যেমন `1250.50`) |
| `currency` | `Order.currency` |
| `placed_at` | `Order.placedAt`-এর ISO string (null হলে ফাঁকা) |
| `created_at` | `Order.createdAt`-এর ISO string |

CSV escaping C3-এর shared `toCsv` / `csvEscape`
(`apps/api/src/imports/csv.ts`) — কমা, কোট বা নিউলাইন থাকা
মান rule অনুযায়ী quote করা হয়, কোট দ্বিগুণ হয়।

## ফিল্টার semantics

- **Organization:** সবসময় শুধু পথের `organizationId`-র
  অর্ডার। অন্য org-এর অর্ডার কোনো ফিল্টারেই আসে না
  (spec-এ cross-org পরীক্ষা আছে)।
- **status:** দেওয়া হলে হুবহু সেই status-এর অর্ডার
  (`list`-এর মতোই)।
- **cod:** `cod=true` → শুধু COD, `cod=false` → শুধু
  non-COD, না দিলে সব (`list`-এর একই parsing)।
- **তারিখের range (শুধু এক্সপোর্টের feature — `list`-এ নেই):**
  - `from` / `to` হলো date-only string `YYYY-MM-DD`, যেগুলো
    **Asia/Dhaka ক্যালেন্ডার দিন** হিসেবে পড়া হয়।
    `from`-এর দিনের Dhaka মধ্যরাত (UTC instant) থেকে শুরু,
    `to`-এর দিনের শেষ পর্যন্ত — অর্থাৎ end হলো `to`-এর
    পরের Dhaka মধ্যরাত, exclusive।
  - Dhaka দিনের সীমানা C1-এর `dhakaDayStartUtc` solver
    দিয়েই হিসাব হয় (অন্য কোথাও "আজ" বলতে যা বোঝায়,
    এখানেও তাই)। পাঠানো instant-টি উদ্দিষ্ট Dhaka তারিখের
    ভিতরেই থাকে — সেজন্য solver-কে দেওয়া হয়
    `from + "T12:00:00.000Z"` (UTC দুপুর)।
  - **কার্যকর অর্ডার-তারিখ = `placedAt ?? createdAt`:**
    যেসব অর্ডারের `placedAt` আছে সেগুলো `placedAt` দিয়ে,
    যেগুলোর নেই সেগুলো `createdAt` দিয়ে range-এ বিচার হয়
    (`where.OR`-এ দুটি শাখা: `placedAt` range, অথবা
    `placedAt: null` + `createdAt` range)।
  - শুধু `from` বা শুধু `to` যেকোনো একটি দিলেও চলে —
    শুধু সেই সীমানাটাই প্রযোজ্য হয়।
  - যাচাই: format কঠোরভাবে `/^\d{4}-\d{2}-\d{2}$/` + আসল
    তারিখ কিনা (যেমন `2026-13-40`, `2026-02-30`, `abc`
    সবই অবৈধ) → `BadRequestException` বাংলা বার্তাসহ।
    `from > to` হলেও একই 400।

## সাজানো ও cap

- সাজানো: `placedAt` **desc** (নতুন অর্ডার আগে) —
  `list`-এর একই order।
- **Cap: সর্বোচ্চ 5000 সারি** (`take: 5000`), যা leads
  এক্সপোর্টের cap-এর mirror। এর বেশি অর্ডার থাকলে শুধু
  সবচেয়ে নতুন 5000টি আসবে; এটি service-এর code comment-এ
  নথিভুক্ত।

## যা অন্তর্ভুক্ত নয় (সৎ তালিকা)

- **কোনো বানানো কলাম নেই:** প্রতিটি টাকার কলামই Order
  model-এর stored field (`subtotalMinor`, `shippingMinor`,
  `discountMinor`, `taxMinor`, `totalMinor`,
  `refundedMinor`)। লাভ, COGS, কুরিয়ার চার্জ বা অন্য কোনো
  হিসাব-করা সংখ্যা এক্সপোর্টে নেই — সেগুলো এই টেবিলে
  stored নয়।
- ঠিকানা (address) কলাম নেই — Order/Customer-এ যেভাবে
  address সংরক্ষিত হয় তা এই এক্সপোর্টের scope-এ আনা হয়নি।
- তারিখের range `GET /orders` (list)-এ যোগ করা হয়নি —
  এটি শুধু এক্সপোর্টের feature।
- কোনো পেজিনেশন/স্ট্রিমিং নেই: একবারে সর্বোচ্চ 5000
  সারির পুরো CSV string ফেরত আসে (leads এক্সপোর্টের
  একই পদ্ধতি)।
- Web পেজে তারিখের range বাছাই করার UI নেই — Orders
  পেজের বাটনটি শুধু বর্তমান status / COD ফিল্টার বহন করে।
  `from`/`to` API দিয়ে সরাসরি ব্যবহার করা যায়।

## Web

Orders পেজ → ফিল্টার সারিতে (status select ও "শুধু COD"
টগলের পাশে) **"এক্সপোর্ট (CSV)"** বাটন:

- ক্লিকে বর্তমান `status` (ফাঁকা হলে বাদ) ও `codOnly`
  (শুধু true হলে `cod=true`) দিয়ে
  `GET /organizations/:orgId/orders/export?...` থেকে blob
  ডাউনলোড হয় — leads পেজের একই pattern (Authorization
  header সহ সরাসরি `fetch` → object URL → অস্থায়ী
  `<a download="orders-export.csv">` ক্লিক)।
- ডাউনলোড চলাকালে বাটন disabled থাকে ("ডাউনলোড হচ্ছে...")।
- ব্যর্থ হলে ত্রুটি পেজের বিদ্যমান `setError` দিয়েই
  দেখায় (সার্ভারের বার্তা হুবহু)।

## Files changed

| ফাইল | পরিবর্তন |
|---|---|
| `apps/api/src/orders/orders.service.ts` | নতুন `exportCsv(organizationId, { status?, isCod?, from?, to? })` — Dhaka date-range যাচাই ও `placedAt ?? createdAt` OR-শর্ত, 5000 cap, shared `toCsv` / `minorToMajor` / `dhakaDayStartUtc` পুনর্ব্যবহার |
| `apps/api/src/orders/orders.controller.ts` | `GET export` route — `list`-এর পরে, `:orderId/risk`-এর **আগে** (literal "export" যাতে `:orderId` দিয়ে ধরা না পড়ে); `Header` import |
| `apps/api/src/orders/s3-orders-export.spec.ts` | নতুন spec (fake-prisma, 12টি test) |
| `apps/web/src/app/dashboard/orders/page.tsx` | "এক্সপোর্ট (CSV)" বাটন + `downloadExport` + `exportBusy` state |
| `docs/sales-s3-acceptance.md` | এই দলিল |

কোনো schema / migration পরিবর্তন হয়নি — এক্সপোর্ট শুধু
আছে এমন field পড়ে।

## Test evidence

- `cd apps/api && npx jest src/orders/s3-orders-export.spec.ts`
  — **12/12 PASS** (1 suite):
  - হেডার সারি হুবহু + একটি পূর্ণ সারির প্রতিটি cell হুবহু
    (টাকা `1250.50` ফরম্যাটে, items `Shirt ×2 | Pant ×1`,
    `is_cod` = `yes`)।
  - status ফিল্টার ও cod ফিল্টার (`isCod: false` সহ) কাজ করে।
  - Dhaka date range: Dhaka 2026-10-05-এ placed অর্ডার
    `from=2026-10-05&to=2026-10-05`-এ আসে; Dhaka
    2026-10-04 23:30-এর অর্ডার আসে না; `placedAt` null
    অর্ডার `createdAt` দিয়ে বিচার হয়; শুধু-`from` ও
    শুধু-`to` সীমানাও পরীক্ষিত।
  - অবৈধ তারিখ (`2026-13-40`, `abc`, `2026-02-30`) →
    `BadRequestException`; `from > to` → একই।
  - Cross-org: অন্য org-এর অর্ডার ফিল্টার ছাড়াও আসে না।
  - Cap: fake-এর রেকর্ড করা `findMany` args-এ
    `take: 5000` assert করা হয়েছে; সঙ্গে
    `orderBy: { placedAt: "desc" }` ও
    `include: { customer: true, items: true }`।
  - Nullable field → ফাঁকা cell; customer `name` fallback।
- `cd apps/api && npx tsc --noEmit` — clean।
- `cd apps/web && npx tsc --noEmit` — clean।
- **পূর্ণ API suite (coordinator): 134 suite / 993 test —
  সব PASS** (orders suites 82/82); monorepo build green;
  web tests 39/39।
- **Live HTTP যাচাই (coordinator)** — fresh build spare
  port :4100 + আসল Postgres: manual order তৈরি করে
  `GET orders/export`-এ header হুবহু, items cell
  (`Live Shirt ×2 | Live Pant ×1`), টাকার পরিমাণ,
  status ফিল্টারে বাদ, আজকের Dhaka তারিখের range-এ
  অন্তর্ভুক্ত / 2020-এর range-এ বাদ, `from=abc` → 400 —
  সব live প্রমাণিত (একই scripted run-এ S4 সহ মোট
  25/25 PASS)।
