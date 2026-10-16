# GB7 Acceptance — G7 Promotions & Tracking Completion (GC17 + GC18)

Batch GB7 of the E-Commerce Completion Program (plan:
`Ecommerce-Completion-Plan-2026-10-15.md`; gap detail:
`gap-audit-B.md` sections 11–12). Built on branch `completion`
(base GB6 HEAD `15f9b7c`). Local commits only — **not pushed**.

Migration: **`20261013970000_gb7_promotions_tracking`** — additive
only. **NOT run on any real DB**; required at deploy. Verified on
a fresh PostgreSQL 16 database: the full sequence applies
**171/171 clean** (241 tables).

---

## GC17 — Promotions completion

### 1. First-order + repeat-customer conditions — DELIVERED

- `StoreDiscount.firstOrderOnly` / `repeatCustomerOnly` (the
  codebase's coupon model is `StoreDiscount`) and a
  `minPriorOrders` condition (integer ≥ 0) normalized into every
  automatic-promotion config type (bogo / tiered / flash / gift)
  by the pure `validatePromotionConfig`; invalid values are
  refused at save with a Bengali message.
- **Identity basis (documented decision):** the resolved
  **Customer record**. Callers compute the prior-order count
  **once per checkout** and pass `{ customerId, priorOrderCount }`
  into `evaluateCheckout`; the evaluator itself stays free of DB
  access (the referral pattern). Counting set = the customer's
  orders with `isPractice = false` and status NOT IN
  (cancelled, failed, refunded). Resolution per path:
  - Shop checkout: the session customer whose phone matches the
    checkout phone, else the phone-matched customer — both are
    resolved **before** pricing, so the check runs against real
    history. A brand-new buyer resolves to no record → count 0.
  - Shop quote: resolved by the presented buyer phone.
  - Landing + single-product checkouts: resolved by the checkout
    phone (phone-loose match, same helper the referral path
    uses).
  - POS: resolved by the counter phone when given. A phone-less
    walk-in sale shares the org's counter identity, so it carries
    **no verifiable customer identity** — customer-conditioned
    coupons refuse there (staff can add the phone).
  - Order surgery: the order's own customer, with the count
    **excluding the order being edited** (and coupon usage
    excluding it too), so re-validation never fails an order
    against itself.
- An unverifiable identity (null count) **refuses** first/repeat
  coupons — it can never grant them. Placement refusal uses the
  existing channel: `কুপন প্রয়োগ করা যায়নি: <reason>` with new
  Bengali reasons `not_first_order` / `not_repeat_customer`.
  Automatic promotions with `minPriorOrders` are **skipped**
  (not errored) when the count is null or below the threshold.

### 2. Per-customer coupon limit — DELIVERED

`StoreDiscount.perCustomerLimit` (nullable). Usage is counted
from **placed orders carrying the GB3 `couponCode` stamp** for
the same customer (same counting set as above), enforced inside
`DiscountsService.validateForCheckout` — i.e. at quote
validation AND placement AND surgery re-validation, through the
one evaluator. Refusal reason: `customer_limit_reached`.

**Coverage honesty:** counting is stamp-based. Orders placed
before the GB3 stamp existed carry no code and cannot be counted
per-customer; the limit therefore counts from GB3 onward. The
dashboard coupon form states this verbatim next to the field
("সীমাটি অর্ডারে সংরক্ষিত কুপন-কোড স্ট্যাম্প থেকে গণনা করা হয়").

### 3. Coupon max value + exclusions — DELIVERED

- `maxOrderMinor` (nullable): a merchandise subtotal **above**
  it refuses the coupon (`above_max_order`), mirroring
  `minOrderMinor`'s semantics in reverse.
- `excludedProductIds` / `excludedCategoryIds` (Json id lists),
  validated against the org's catalog at save (unknown id →
  Bengali 400 naming the list). **V1 semantics:** if the cart
  contains ANY excluded product/category line, the coupon is
  refused with `excluded_items`. Line-level partial application
  is **NOT built** (stated here and in the form help copy).
- The dashboard coupon form carries all new fields (both
  condition checkboxes, per-customer limit, max order, both
  exclusion lists), plus an origin badge and a **source filter**
  on the coupon list (all / manual / WooCommerce / Shopify /
  abandoned recovery).

### 4. Flash-sale countdown — DELIVERED

- New public read `GET /public/shop/:orgSlug/flash-sales`:
  only promotions of type `flash` that are active and in-window
  **with an `endsAt`** (a flash sale without an end has no
  countdown and is excluded), product refs resolved from
  `productIds` + ACTIVE products of `categoryIds`, the sale
  price (display-only), and **`serverNow`** in every payload.
- Products in shop home / brand / detail payloads carry
  `flashSale: { promotionId, name, percentOff, endsAt }` when
  covered (highest-priority sale wins).
- Shop UI: a countdown component on the **PDP** (banner over the
  buy panel), a **listing-card badge** with compact countdown,
  and a **home flash section**. **Drift handling:** the client
  computes `offset = serverNow − clientNow` once on mount and
  counts `endsAt − (clientNow + offset)`, so a wrong client
  clock does not move the deadline; the component renders
  nothing once the sale has ended. Countdown is display-only —
  pricing still comes only from the evaluator.

### 5. Abandoned-cart coupon — DELIVERED

- New per-org `AbandonedCouponSetting`: `enabled` **default
  FALSE**, template `kind` (percent | fixed — mirroring coupon
  kinds; free-shipping is not offered), `value`, `expiryHours`
  **default 72**, `minOrderMinor` nullable. Guarded GET/PUT at
  `commerce/abandoned/coupon-setting`, audited, validated
  (enabling with percent outside 1–90 or fixed < 1 refuses).
- On a staff recovery send (both the connected-store path and
  the native-cart path) with the setting ON, the system creates
  a **REAL `StoreDiscount` row**: generated unique code
  (`RCV-` + 8 chars, unique-violation retried), `perCustomerLimit
  1`, `firstOrderOnly false`, `endsAt = now + expiryHours`,
  `origin = "abandoned_recovery"`, `sourceRef` = the abandoned
  checkout / cart id. The code enters the recovery message as
  composed content lines (code + discount + validity hours) in
  the existing message composition, and is recorded in the
  send-audit metadata. It redeems through the normal evaluator —
  no special path, no shadow discounts. Issuance failure is
  logged and the recovery still sends (without a coupon).
- Setting OFF ⇒ the composed recovery is **byte-identical** to
  the pre-GB7 message (spec-pinned with an exact-text assert).
- Dashboard: a recovery-coupon settings card on the abandoned
  page; issued coupons appear in the coupons list under the
  "পরিত্যক্ত কার্ট পুনরুদ্ধার" source (filter + badge +
  `sourceRef` shown).

### 6. Promotion performance report — DELIVERED

- `PromotionsService.stampOrder` — the ONE stamping choke point
  every checkout path shares — now also stamps
  `Order.appliedDiscounts` built **from the evaluator result**:
  `[{ promotionId?, couponCode?, kind: promotion|coupon|referral,
  name, discountMinor }]` for entries that actually discounted.
  Never reconstructed after the fact.
- `GET commerce/promotions/report?from&to` (default last 30
  days): per coupon code `{ redemptions, discountTotalMinor,
  revenueMinor }` (revenue = totals of the orders that redeemed
  it) and per automatic promotion `{ applications,
  discountTotalMinor }`, aggregated from stamped orders only
  (bounded 5000-row fetch with a `truncated` flag).
- **Coverage boundaries (returned in the payload and shown in
  the UI):** data exists only for orders placed after GB7 ships
  (pre-GB7 orders have no `appliedDiscounts`), and coupon rows
  exist only where the GB3 code stamp exists.
- Dashboard promotions page gains the report section (date
  range, coupon + promotion tables, coverage note verbatim).

## GC18 — Tracking tags (merchant's own IDs only)

### 1. Settings fields — DELIVERED

`StorefrontSetting` gains nullable `ga4MeasurementId`,
`gtmContainerId`, `googleAdsId`, `googleAdsConversionLabel`,
`searchConsoleVerification`. Save-time format validation (pure
`apps/api/src/storefront/tracking.ts`): `G-…`, `GTM-…`, `AW-<digits>`,
label token, verification token — loose prefix/shape checks with
per-field Bengali errors; empty string clears (unset). No
platform-owned ID exists anywhere in the code.

### 2. Shop rendering — DELIVERED

Through the shop layout (the GB1 metadata machinery):
`searchConsoleVerification` → Next `verification.google`
(`<meta name="google-site-verification">`); GTM → the standard
head script + body noscript iframe; GA4 → gtag.js + config.
**Unset fields render nothing** (web specs pin the
descriptor/decision logic; the tags component returns null when
all unset). GTM + GA4 both set → both render as configured; the
settings UI shows the double-count warning ("GTM দিয়ে GA4
চালালে এখানে আবার বসাবেন না — দ্বিগুণ গণনা হতে পারে") whenever
both fields are filled. Tags render on **shop surfaces only** —
nothing was added to dashboard/admin.

### 3. Google Ads conversion — DELIVERED

On the shop checkout success page, when `googleAdsId` + label
are set, the conversion event fires **once** with
`value` = the placed order's real total (minor/100),
`currency: BDT`, `transaction_id` = the order number, through a
single gtag (reusing the page's gtag when GA4 is also set;
loading gtag with the Ads ID when it is not). **Guard:** it
fires only for the order this browser actually placed — the
session-storage checkout result. The `?order=` display fallback
(arbitrary order ids) never fires. A session-storage flag set
**before** firing makes repeat views / re-renders fire at most
once per order. If neither GA4 nor Ads is set, nothing loads.

### 4. Settings UI — DELIVERED

"ট্র্যাকিং ও অ্যানালিটিক্স" section in storefront settings with
per-field "কোথায় পাবেন" help text and the warnings above; the
five fields ride the page's existing settings save flow.

---

## Gates (run by the coordinator, exit-code verified)

| Gate | Result |
|---|---|
| API jest (chunked, 5 chunks, all exit 0) | **361 suites / 3824 tests passed** (baseline 3779 → +45: 15 GC17 + 30 GC18 specs) |
| API tsc `--noEmit` | exit 0 |
| Web vitest | **54 files / 407 tests passed** (baseline 390 → +17) |
| Web tsc `--noEmit` | exit 0 |
| Full build (7/7) | contracts, db, ui, api, worker, web `next build`, admin `next build` — all exit 0 |
| prisma validate | exit 0 |
| Fresh-DB full sequence | **171/171 migrations applied clean** (PostgreSQL 16, 241 tables) |

No flakes were encountered in this batch's runs.

Specs added: `apps/api/src/commerce/gb7-promotions.spec.ts`
(pure validator accept/refuse matrix incl. null-identity
refusals, `minPriorOrders` skip semantics, evaluator refusal
message, stamp-based usage counting args, `appliedDiscounts`
stamping, report math + coverage, abandoned OFF byte-identity /
ON issuance + redemption path), `apps/api/src/storefront/gb7-storefront.spec.ts`
(tracking validation matrix, settings save reject/store/clear,
flash payload window + sale-price math, shop-home tracking
payload), `apps/web/src/lib/shop-tracking.test.ts` +
`shop-flash.test.ts` (conversion truth table, server-offset
countdown math).

## HONEST LIMITS

- **No live tag firing proof.** Tag rendering and the Ads
  conversion are proven at spec/fixture level only; no real
  GA4/GTM/Ads account was involved (M30-style live verification
  remains the owner's). Nothing here was deployed.
- **Countdown drift:** handled by the server-timestamp offset
  described above; sub-second network latency on the payload
  fetch is not compensated.
- **Per-customer counting boundary:** stamp-based (GB3 onward),
  as documented in §2. Phone-loose identity resolution inherits
  the referral path's matching limits — a customer who changes
  phone numbers is a new identity for counting purposes.
- **Exclusions are refuse-all v1** — no line-level partial
  application (see §3).
- **Flash sales without `endsAt`** get no countdown surface
  (excluded from the countdown payloads); their discount still
  applies through the evaluator as before.
- The migration `20261013970000_gb7_promotions_tracking` has
  **not** run on any real database; it is required at deploy.
