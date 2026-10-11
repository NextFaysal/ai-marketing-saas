# Sales & Data S4 — Abandoned Cart (Tenant Stores): Acceptance

Sales & Data Remaining Package-এর Milestone S4। উদ্দেশ্য:
টেন্যান্টের দোকানে কার্টে পণ্য যোগ করে কেনাকাটা সম্পূর্ণ
না করে চলে যাওয়া ভিজিটরদের তালিকা দেখা, এবং (ইমেইল থাকলে)
একবার করে recovery ইমেইল পাঠানো।

## Audit: tracker আসলে যা ধরে

S4 বানানোর আগে coordinator-এর code audit-এর যাচাইকৃত
সত্য (এগুলোর উপরেই ডিজাইন দাঁড়িয়ে):

1. **tracker.js** (`apps/web/public/tracker.js`) auto-emit
   করে: `page_view`, `product_view` (`[data-tp-product]`
   থেকে, properties `{productId, name}`), `add_to_cart`
   (`[data-tp-add-to-cart]` ক্লিকে, properties = শুধু
   `{ productId }` — **নাম/দাম/পরিমাণ নেই**)। Manual hook:
   `TP.purchase(orderExternalId, value, currency)`,
   `TP.lead(properties)`, `TP.track(type, properties)`।
   **`checkout_started` codebase-এর কোথাও emit হয় না** —
   এটি শুধু ingest whitelist-এ আছে।
2. **Ingest** (`tracking.service.ts`): `ALLOWED_TYPES` =
   page_view, product_view, add_to_cart, checkout_started,
   lead, purchase, refund, custom। Event `TrackingEvent`-এ
   জমা হয়: organizationId, storeId, visitorId, sessionKey,
   type, url, properties (free JSON), orderExternalId,
   valueMinor (BigInt — **শুধু payload-তে `value` থাকলেই**
   সেট হয়; TP.track value পাঠায় না, TP.purchase পাঠায়),
   currency, occurredAt। Dedup `(organizationId,
   clientEventId)`-তে; batch সর্বোচ্চ 50।
3. **Visitor model**-এ email/phone ছিল না; TrackingSession-এও
   কোনো contact field নেই। tracker.js-এর header-ই বলত:
   "No names, emails or payment data are collected by this
   script." → S4-এর আগে abandoned cart-এর কোনো প্রাপকই ছিল না।
4. **Store model**: name, url, currency, trackingKey —
   `store.url` একটি আসল return-link target হিসেবে আছে।
5. **Email channel আসল**: `EmailProvider.send({to, subject,
   text})` — platform SMTP (Admin Console config বা `SMTP_*`
   env); unconfigured হলে স্পষ্ট config error throw করে;
   send তখনই সফল ধরা হয় যখন SMTP একটি messageId ফেরত দেয়।
   `MessagingModule` EmailProvider export করে। `AuditService`
   `@Global`।
6. **Tracking controller** আগে শুধু public `POST
   /tracking/events` ছিল। Org-scoped pattern-এর উদাহরণ
   AttributionController: `@PermissionArea("analytics")` +
   TenantGuard/RolesGuard; write action-এ `@Roles`
   (messaging WRITE_ROLES = OWNER, ADMIN, MARKETING_MANAGER)।

## Derivation-এর সংজ্ঞা (হুবহু)

`deriveAbandonedCarts(events, now, opts?)` —
`apps/api/src/tracking/abandoned-carts.ts`, একটি pure function:

- **Signals:** `add_to_cart` ও `checkout_started` event,
  `sessionKey` দিয়ে group করা। শুধু sessionKey-ওয়ালা
  event-ই বিবেচিত; বিবেচিত type শুধু add_to_cart,
  checkout_started, purchase।
- **Lookback:** শুধু `[now − 7 দিন, now]`-এর ভিতরের event।
- **Min age:** cart-এর **শেষ** signal activity যদি
  `now − 1 ঘণ্টা`-র পরে হয় → এখনো ধরা হয় না (ক্রেতা
  হয়তো checkout-এই আছেন)।
- **Purchase exclusion:** একই `visitorId`-র কোনো purchase
  event যদি এই cart-এর **প্রথম** signal-এর সময়ে বা পরে
  ঘটে থাকে → cart abandoned নয় (converted)। প্রথম
  signal-এর **আগের** purchase বাদ দেয় না (ক্রেতা ফিরে
  এসে নতুন cart শুরু করেছেন)।
- **Signal label:** session-এ যেকোনো `checkout_started`
  থাকলে `"checkout_started"`, নইলে `"add_to_cart"`।
- **Items:** session-এর signal event-গুলোর properties থেকে,
  occurredAt ক্রমে, `(productId ?? name)` দিয়ে dedupe
  (প্রথমটি থাকে)। `name` = non-empty string properties.name,
  নইলে null; `quantity` = positive finite number, নইলে null;
  `productId` = `String(properties.productId)`, নইলে null।
  Properties-বিহীন event item দেয় না।
- **Value honesty:** `valueMinor`/`currency` আসে শুধু সেই
  signal event থেকে যেটি **নিজে** valueMinor store করেছে
  (এমন event-গুলোর মধ্যে সর্বশেষটি)। Items থেকে **কখনো
  হিসাব করা হয় না** — না থাকলে null ("মূল্য জানা নেই")।
- সাজানো: `lastActivityAt` desc। Service list-এ সর্বোচ্চ
  **200** cart; event fetch cap 20,000 (7 দিনের window-তে)।

## TP.identify hook + privacy

- দোকান স্পষ্টভাবে কল করে: `TP.identify({ email, phone })`
  — যেমন checkout-এ ক্রেতা নিজে ইমেইল/ফোন টাইপ করলে।
  tracker.js নিজে থেকে **কখনো** contact সংগ্রহ করে না;
  header comment সেভাবেই হালনাগাদ করা হয়েছে।
- Ingest-এ `identify` একটি নতুন allowed type। Identify
  event এলে visitor-এ শুধু **valid** field জমা হয়:
  - email: trim + lowercase, `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`,
    দৈর্ঘ্য ≤ 254 — নইলে উপেক্ষিত।
  - phone: trim, দৈর্ঘ্য 6–20, শুধু `[0-9+\-\s]` — নইলে উপেক্ষিত।
  - Identify event-টি নিজেও অন্য event-এর মতোই store হয়
    (properties = দোকানের নিজের submission)।
- Schema: `Visitor.email` / `Visitor.phone` (দুটোই nullable)
  + migration `20261010860000_s4_visitor_contact`।

## Recovery send-এর নিয়ম

`POST /organizations/:organizationId/tracking/abandoned-carts/:visitorId/recover`
(roles: OWNER, ADMIN, MARKETING_MANAGER):

- Cart পুনরায় derive করে visitor-এর cart খোঁজা হয়; না
  থাকলে 400 ("কোনো abandoned cart পাওয়া যায়নি")।
- Visitor-এর email না থাকলে 400 — বার্তায় TP.identify
  hook-এর কথা বলা আছে।
- **এক cart-এর জন্য একবারই:** সফল send-এ AuditLog marker
  লেখা হয় — action `tracking.cart_recovery_sent`,
  entityType `Visitor`, entityId = visitorId, metadata-তে
  `{ storeId, sessionKey, lastCartActivity, to,
  providerMessageId }`। List-এ marker-এর
  `metadata.lastCartActivity` cart-এর `lastActivityAt`-এর
  সঙ্গে মিললেই `recoverySentAt` সেট হয়; marker থাকলে
  দ্বিতীয় send 400 ("ইতিমধ্যে পাঠানো হয়েছে")।
- **SMTP unconfigured / send ব্যর্থ = সৎ ব্যর্থতা:**
  EmailProvider-এর error 400 হিসেবে surface হয় এবং
  **কোনো marker লেখা হয় না** — cart recoverable-ই থাকে।
- ইমেইলের বিষয়বস্তু: subject `${storeName}: আপনার কার্টটি
  এখনও অপেক্ষা করছে`; text-এ item line শুধু items থাকলেই,
  মূল্যের line শুধু valueMinor থাকলেই
  (`minorToMajor` দিয়ে `৳…`), এবং return link শুধু
  `store.url`। **কোনো discount নেই, কোনো বানানো link নেই।**

## API + files

```
GET  /organizations/:organizationId/tracking/abandoned-carts
     → { generatedAt, minAgeHours: 1, lookbackDays: 7,
         carts: [ …derivation row + storeName, storeUrl,
                  contact { email, phone }, recoverySentAt ] }
POST /organizations/:organizationId/tracking/abandoned-carts/:visitorId/recover
     → { sent: true, to, providerMessageId }
দুটোই @PermissionArea("analytics") + TenantGuard/RolesGuard;
POST-এ অতিরিক্ত @Roles(OWNER, ADMIN, MARKETING_MANAGER)।
```

| ফাইল | পরিবর্তন |
|---|---|
| `packages/db/prisma/schema.prisma` | `Visitor.email` / `Visitor.phone` (nullable) |
| `packages/db/prisma/migrations/20261010860000_s4_visitor_contact/migration.sql` | নতুন migration (২টি `ADD COLUMN`) |
| `apps/web/public/tracker.js` | `TP.identify({email, phone})` hook + header privacy doc হালনাগাদ |
| `apps/api/src/tracking/tracking.service.ts` | `identify` allowed type + visitor contact sanitize/update |
| `apps/api/src/tracking/abandoned-carts.ts` | নতুন — pure derivation |
| `apps/api/src/tracking/abandoned-carts.service.ts` | নতুন — list enrichment + recovery send |
| `apps/api/src/tracking/abandoned-carts.controller.ts` | নতুন — ২টি endpoint |
| `apps/api/src/tracking/tracking.module.ts` | নতুন controller/service + `MessagingModule` import (EmailProvider-এর জন্য) |
| `apps/api/src/tracking/abandoned-carts.spec.ts` | নতুন spec (20টি test) |
| `apps/web/src/app/dashboard/attribution/page.tsx` | Attribution পেজের নিচে "Abandoned Carts" সেকশন |
| `docs/sales-s4-acceptance.md` | এই দলিল |

Prisma client regenerate করা হয়েছে repo-র নিজের পদ্ধতিতে
(`pnpm --filter @repo/db generate` — সফল, Prisma Client
v5.22.0)।

## সৎ সীমাবদ্ধতা

- **`checkout_started` whitelisted, কিন্তু কোনো কিছুই তা
  emit করে না** — দোকানকে নিজে `TP.track("checkout_started")`
  কল করতে হবে, নইলে signal শুধু `add_to_cart`।
- **পণ্যের নাম** শুধু তখনই আসে যখন দোকান properties-এ
  `name` পাঠায় — auto `add_to_cart`-এ শুধু productId আসে,
  তাই বেশিরভাগ cart-এ item শুধু productId দেখাবে।
- **Cart-এর মূল্য** শুধু তখনই জানা যায় যখন কোনো signal
  event নিজে valueMinor store করেছে — সাধারণ add_to_cart-এ
  তা থাকে না, তাই "মূল্য জানা নেই"-ই স্বাভাবিক অবস্থা।
- **Contact শুধু TP.identify থেকে** — hook না বসালে কোনো
  cart-এরই email/phone থাকবে না, recovery ইমেইল পাঠানো
  যাবে না (ফোন থাকলেও SMS recovery এই milestone-এ নেই)।
- Recovery **এক cart-এ একবার** — নতুন signal activity এলে
  (নতুন lastActivityAt) সেটি নতুন cart হিসেবে আবার
  recoverable হয়।
- তালিকা প্রতি request-এ live derive হয় (7 দিনে সর্বোচ্চ
  20,000 event পড়ে, 200 cart ফেরত) — কোনো materialized
  table নেই।

## Test evidence

- `cd apps/api && npx jest src/tracking` — **24/24 PASS**
  (2 suite; নতুন spec 20টি + আগের tracking.service.spec.ts
  4টি অপরিবর্তিতভাবে):
  - Derivation matrix: (1) 2 ঘণ্টা আগের cart অন্তর্ভুক্ত,
    signal add_to_cart; (2) প্রথম signal-এর 30 মিনিট পরের
    purchase → বাদ; (3) cart-এর 1 দিন আগের purchase →
    অন্তর্ভুক্ত; (4) শেষ activity 10 মিনিট আগে → বাদ
    (min age); (5) 8 দিন আগে → বাদ (lookback); (6) শুধু
    page_view session → অনুপস্থিত; (7) checkout_started
    থাকলে signal checkout_started; (8) value honesty —
    valueMinor না থাকলে null, পরের valued signal-এর
    মূল্যই নেওয়া হয়, আগের valued + পরের unvalued-তেও
    আগেরটাই থাকে; (9) items dedupe (প্রথমটি জেতে),
    quantity নিয়ম (0 / string → null); এছাড়া
    lastActivityAt desc সাজানো।
  - Ingest identify: `"A@B.com "` → `a@b.com` + valid
    phone visitor-এ জমা হয়; invalid email/phone উপেক্ষিত;
    পরের identify শুধু valid provided field update করে;
    identify event নিজেও stored হয়।
  - Service: list enrichment (contact/store/recoverySentAt
    null); **tenant isolation** (অন্য org-এর cart list-এও
    নেই, recover-ও 400); email না থাকলে BadRequest (কিছু
    পাঠানো হয় না, marker নেই); আগেই পাঠানো থাকলে
    BadRequest; provider throw করলে BadRequest + **শূন্য**
    নতুন audit marker; provider না থাকলে সৎ BadRequest;
    সাফল্যে ঠিক একটি marker (metadata হুবহু), list-এ
    recoverySentAt দেখা যায়, দ্বিতীয় send প্রত্যাখ্যাত।
- `cd apps/api && npx tsc --noEmit` — clean।
- `cd apps/web && npx tsc --noEmit` — clean।
- **পূর্ণ API suite (coordinator): 134 suite / 993 test —
  সব PASS**; monorepo build green; web tests 39/39।
- **Live HTTP যাচাই (coordinator, 25/25 PASS)** — fresh build
  spare port :4100 + আসল Postgres, migration
  `20261010860000_s4_visitor_contact` সত্যিকারের apply করে:
  register → org → psql-এ store seed → **আসল
  `POST /tracking/events` ingest** দিয়ে add_to_cart (2 ঘণ্টা
  আগে) + identify (email বড় হাতের + space সহ) পাঠালে
  abandoned-carts তালিকায় ঠিক 1টি cart আসে — signal
  add_to_cart, email normalized অবস্থায় captured,
  `valueMinor: null` (বানানো হয়নি), items ঠিক যেমন stored,
  recoverySentAt null।
  - Recovery: sandbox-এ SMTP configured নয় বলে send
    **সৎভাবে 400** ("ইমেইল পাঠানো যায়নি: Email is not
    configured…") এবং DB-তে যাচাই করে দেখা গেছে **কোনো
    audit marker লেখা হয়নি** — অর্থাৎ SMTP ঠিক করে আবার
    পাঠানো যাবে। সফল-send পথ (marker + দ্বিতীয় send
    প্রত্যাখ্যান) unit spec-এ fake provider দিয়ে
    প্রমাণিত; live SMTP দিয়ে সফল send এই sandbox-এ
    প্রমাণ করা যায়নি (Mailpit/SMTP নেই) — সৎ সীমা হিসেবে
    রইল।
  - একই visitor-এর purchase event ingest-এর পর cart
    তালিকা থেকে অদৃশ্য হয়ে যায় (live প্রমাণিত)।
