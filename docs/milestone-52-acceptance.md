# Milestone 52 Acceptance — Courier Live Quotation

## What shipped
- `POST /organizations/:organizationId/courier/quote` (TenantGuard +
  OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT), following the existing
  courier module's patterns (provider in the DTO, `clientFor` builds
  the provider client or throws the connect-first error, provider
  errors mapped through `courierError` verbatim).
- Pathao: `PathaoClient.pricePlan` -> POST
  `/aladdin/api/v1/merchant/price-plan` with the documented fields
  {store_id, item_type, delivery_type, item_weight (kg),
  recipient_city, recipient_zone}. The quoted charge is the
  response's `final_price` exactly as Pathao returns it (plus the
  full breakdown: price, discount, promo_discount, additional_charge,
  cod_enabled, cod_percentage, plan_id). A response without
  `final_price` is refused, never guessed. Service defaults the store
  to the first active store exactly like `bookShipment`, and refuses
  without city+zone (Pathao cannot price without them).
- RedX: `RedxClient.calculateCharge` -> POST
  `/charge/charge_calculator` {delivery_area_id, pickup_area_id
  (optional), cash_collection_amount, weight in GRAMS} — the shape
  already documented in the client header from RedX's open API docs.
  The quoted charge is the returned total (delivery/COD parts
  normalized from the returned fields; a charge-less response is
  refused). The service derives the COD collection amount from the
  order itself when an orderId is given.
- Steadfast: NO quote API exists. The endpoint returns
  `{ quotable: false, chargeMinor: null, reason: "বুকিংয়ের পরে
  চার্জ জানা যাবে — ..." }` — an explicit honest state, no number.
- Weight input: the schema carries no product/order weight, so the
  weight is the explicit user input from the booking form
  (weightKg / weightGrams / per-provider weight) — never guessed.
- UI: the orders-page booking form gained a "💰 ডেলিভারি চার্জ
  দেখুন" action per booking; it shows the returned charge (from the
  provider's own price API) or the honest not-quotable reason /
  the provider's error message.
- A quote performs no writes (no shipment, no audit row).

## Truth table (per provider)
| Provider | Quotable? | Surface | Charge source |
|---|---|---|---|
| Pathao | Yes | POST /aladdin/api/v1/merchant/price-plan | response final_price |
| RedX | Yes | POST /charge/charge_calculator | response total charge |
| Steadfast | No (no API) | — | quotable:false + reason, no number |

## Verification
- New `apps/api/src/courier/m52-quote.spec.ts` (10 tests): client
  request shapes + response normalization at the stubbed-HTTP layer
  (documented Pathao fields incl. final_price refusal; RedX grams +
  pickup omission + charge-less refusal), service matrix
  (steadfast honest state, unconnected connect-first error, Pathao
  quote = final_price in minor units with booking-identical store
  defaulting and zero shipments saved, missing city/zone 400,
  provider failure verbatim, RedX quote with order COD + grams).
- Full monorepo build green; full API suite 529 pass / 76 suites
  (baseline 519/75).
- Live (sandbox, fresh tenant, restarted API on the new build):
  1. Unconnected Pathao quote -> 400 "pathao যুক্ত নেই। আগে Courier
     Connect করুন।"
  2. Steadfast (seeded CONNECTED row) -> 201 quotable:false with the
     honest reason and chargeMinor null.
  3. RedX (seeded CONNECTED row, fake token) -> the request reached
     RedX's REAL host, which answered 404 "Please check your
     specified endpoint and request method"; surfaced verbatim as a
     400, nothing saved. Whether the calculator route differs on
     the legacy base or a valid token changes the answer cannot be
     distinguished without the owner's real RedX credentials — a
     successful priced RedX quote is NOT claimed.
  4. Pathao (seeded CONNECTED row, fake credentials) -> the real
     Pathao host answered the token issue with its own 500
     "Internal Server Error"; surfaced verbatim, nothing saved.
  5. CourierShipment rows for the live org after all quotes: 0.

## Not claimed
- No successful live priced quote (needs the owner's real
  Pathao/RedX merchant accounts — M30 courier sessions).
- No pixel QA of the quote UI (build + API behaviour verified).
