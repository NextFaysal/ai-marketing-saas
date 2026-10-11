# Sales & Data S5 — Courier Performance Report: Acceptance

Sales & Data Remaining Package-এর Milestone S5। উদ্দেশ্য:
প্রতিটি কুরিয়ার provider-এর (Steadfast / Pathao / RedX এবং
ডেটায় থাকা অন্য যেকোনো provider) বুকিং, ডেলিভারি, রিটার্ন
ও বাতিলের হিসাব এবং ডেলিভারি/রিটার্ন হার একটি নির্দিষ্ট
সময়সীমায় দেখা — শুধু আসল `CourierShipment` রেকর্ড থেকে,
কোনো বানানো সংখ্যা ছাড়া।

## সংজ্ঞা (হুবহু)

### Status classification

`CourierShipment.status` একটি free-form string — provider-এর
নিজের ভাষায়। Classification-এর আগে normalize করা হয়:
trim, lowercase, space/hyphen → underscore (ওয়েবের
`apps/web/src/lib/courier-status.ts`-এর একই নিয়ম)। তারপর:

| Outcome | Normalized status |
|---|---|
| delivered | `delivered`, `partial_delivered`, `partially_delivered` |
| returned | `returned`, `return` |
| cancelled | `cancelled`, `canceled`, `cancel` |
| in_flight | উপরের কোনোটিই নয় — null/empty/unknown-সহ সব বাকি |

Pure helper: `classifyShipmentStatus(status)` —
`apps/api/src/courier/courier-performance.ts`।

### Window

- `days` param: undefined / null / `""` → 30; নইলে `Number()`;
  integer 1..365 না হলে `BadRequestException("days must be an
  integer between 1 and 365")` — CRM C6 funnel-এর হুবহু একই
  শৃঙ্খলা।
- Window: `end = dhakaDayStartUtc(now) + 86400000`;
  `start = end − days × 86400000` (Asia/Dhaka দিন)।
  অর্থাৎ শেষ `days`টি ঢাকা-ক্যালেন্ডার দিন, আজসহ:
  `[start, end)` — shipment ঠিক `start`-এ থাকলে ভিতরে,
  ঠিক `end`-এ থাকলে বাইরে।
- গণনায় আসে শুধু এই window-তে **বুক করা** (createdAt)
  shipment, এই organization-এরই। Fetch cap 20,000 row।

### হিসাব

প্রতি provider-এর জন্য:

- `booked` = window-র মোট shipment।
- `delivered` / `returned` / `cancelled` / `inFlight` =
  classification অনুযায়ী ভাগ।
- **decided = delivered + returned + cancelled** — পথে থাকা
  (in-flight) shipment-এর ফলাফল এখনো হয়নি, তাই তারা
  হারের denominator-এ নেই।
- **deliveryRate = delivered / decided**,
  **returnRate = returned / decided** — প্রতিটি
  `Math.round(x × 10000) / 10000` দিয়ে 4 decimal-এ rounded।
- **Null rule:** decided = 0 হলে দুটি হারই `null` — কোনো
  হার বানিয়ে 0 দেখানো হয় না।

### Provider ordering ও totals

- Provider তালিকায় আসে **শুধু** যার window-তে ≥ 1টি
  shipment আছে — অনুপস্থিত provider-এর জন্য কোনো zero row
  নেই।
- ক্রম: প্রথমে `steadfast`, `pathao`, `redx` (যেগুলো ডেটায়
  আছে), তারপর অন্য provider string-গুলো alphabetically।
- `totals.provider = "total"` — সব row-র উপর একই নিয়মে
  হিসাব করা সমষ্টি।

## গড় ডেলিভারি সময়: UNAVAILABLE (রায়)

**গড় ডেলিভারি সময় দেখানো হয় না — এটি genuinely
unavailable।**

- `CourierShipment`-এ কোনো `deliveredAt` field নেই।
- কোনো status-history table-ও নেই — কোন shipment কখন
  delivered অবস্থায় পৌঁছেছে, তা কোথাও সংরক্ষিত হয় না।
- `updatedAt` deliberately ব্যবহার করা হয়নি: status sync
  প্রতিবার check-এ `updatedAt` overwrite করে, তাই সেটি
  ডেলিভারির মুহূর্ত নির্দেশ করে না — সেটি দিয়ে হিসাব
  করলে সংখ্যাটি ভুল হতো।
- তাই response-এ `deliveryTimeAvailable: false` এবং প্রতি
  row-তে `avgDeliveryHours: null` — সবসময়। ভবিষ্যতে
  delivered-at timestamp সংরক্ষণ শুরু হলে তবেই এই হিসাব
  যোগ করা যাবে।

## Endpoint + response shape

```
GET /organizations/:organizationId/courier/performance?days=30
@Controller("organizations/:organizationId/courier")
@PermissionArea("courier") + TenantGuard + RolesGuard (class-level;
read-only — shipments GET-এর মতোই কোনো অতিরিক্ত @Roles নেই)

→ {
    days: number,
    windowStart: string,   // ISO
    windowEnd: string,     // ISO
    deliveryTimeAvailable: false,
    providers: ProviderPerformance[],
    totals: ProviderPerformance
  }

ProviderPerformance = {
  provider: string,        // totals-এর ক্ষেত্রে "total"
  booked: number, delivered: number, returned: number,
  cancelled: number, inFlight: number, decided: number,
  deliveryRate: number | null, returnRate: number | null,
  avgDeliveryHours: null
}
```

## Files

| ফাইল | পরিবর্তন |
|---|---|
| `apps/api/src/courier/courier-performance.ts` | নতুন — pure classifier + aggregation builder |
| `apps/api/src/courier/courier.service.ts` | `performance(organizationId, daysInput?, now?)` — শুধু `this.prisma` ব্যবহার করে |
| `apps/api/src/courier/courier.controller.ts` | `GET performance` handler, shipments routes-এর আগে |
| `apps/api/src/courier/courier-performance.spec.ts` | নতুন spec |
| `apps/web/src/app/dashboard/orders/page.tsx` | Orders পেজে “🚚 কুরিয়ার পারফরম্যান্স” প্যানেল (7/30/90 দিন select, provider table, totals row, সংজ্ঞার small print) |
| `docs/sales-s5-acceptance.md` | এই দলিল |

Web প্যানেলের আচরণ: fetch ব্যর্থ হলে বা ডেটা না এলে একটি
শান্ত empty note; provider না থাকলে “এই সময়ে কোনো shipment
বুক হয়নি।” — কোনো provider-এর জন্য বানানো zero row কখনো
দেখানো হয় না। হার null হলে “—”, নইলে এক decimal-এ শতাংশ।

## Test evidence

- `cd apps/api && npx jest src/courier/courier-performance.spec.ts src/courier/courier.spec.ts --runInBand` — **16/16 PASS** (2 suite; নতুন spec 8টি + আগের courier.spec.ts 8টি অপরিবর্তিতভাবে):
  - Classifier unit tests: delivered synonyms (`delivered`, `partial_delivered`, `partially_delivered`, case/space/hyphen normalization-সহ), returned synonyms (`returned`, `return`, `RETURNED`), cancelled synonyms (`cancelled`, `canceled`, `cancel`), এবং বাকি সবকিছু (`in_transit`, `in_review`, `Out for Delivery`, `pending`, unknown, empty, null, undefined) → `in_flight`।
  - Hand computation: steadfast booked 6 / decided 4 / deliveryRate 0.5 / returnRate 0.25; pathao in-flight only → decided 0, দুই হারই null; redx deliveryRate 0.75 / returnRate 0.25; অন্য provider `ecourier`-এ `Out for Delivery` → in_flight, `RETURNED` → returned।
  - Window boundary: ঠিক start-এ থাকা shipment ভিতরে, ঠিক end-এ ও start-এর 1 সেকেন্ড আগেরটি বাইরে (আলাদা provider দিয়ে যাচাই)।
  - Org isolation: org-2-এর shipment org-1-এর হিসাবে নেই; org-2 নিজে শুধু নিজের 2টি দেখে।
  - Totals row হাতে-যোগ করা মানের সঙ্গে হুবহু মেলে: booked 14, delivered 6, returned 3, cancelled 1, inFlight 4, decided 10, deliveryRate 0.6, returnRate 0.3, `avgDeliveryHours: null`, `deliveryTimeAvailable: false`।
  - Provider ordering: `steadfast, pathao, redx, ecourier, zedex` (known আগে, extras alphabetically); empty org-এ provider list `[]` ও totals-এ null হার।
  - Days validation: `"0"`, `"366"`, `"abc"`, `"30.5"` → BadRequestException; undefined → 30; `"90"` → 90।
- `cd apps/api && npx tsc -p tsconfig.json --noEmit` — clean।
- `cd apps/web && npx tsc --noEmit` — clean।
- **Full gate (coordinator):** পুরো API suite **1001/1001 PASS (135 suites)**; web tests **39/39 PASS**; monorepo build (`pnpm -r build`) green।
- **Live HTTP যাচাই (coordinator):** built API আলাদা port (:4100)-এ তুলে আসল Postgres-এর বিরুদ্ধে scripted check — **18/18 PASS**: register → login → org তৈরি → 7টি shipment seed (steadfast delivered/partial_delivered/returned/in_transit, pathao in_review + 10-দিন-আগের delivered, redx 40-দিন-আগের delivered) → `days=30`-এ steadfast booked 4 / decided 3 / deliveryRate 0.6667 / returnRate 0.3333 / inFlight 1 হুবহু, pathao booked 2 / deliveryRate 1, redx অনুপস্থিত (window-এর বাইরে), totals booked 6 / decided 4 / 0.75 / 0.25; `days=7`-এ 10-দিন-আগের delivery বাদ পড়ে pathao-র হার null; `avgDeliveryHours: null` + `deliveryTimeAvailable: false`; `days=abc` → 400; অন্য org → 403। Seed করা সব row যাচাই শেষে মুছে ফেলা হয়েছে (leftover 0)।

## Note

Local work only — nothing pushed. GitHub push happens only on
the owner's explicit instruction in the moment (standing rule).
