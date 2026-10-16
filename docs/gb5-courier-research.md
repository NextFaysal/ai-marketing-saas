# GB5 (GC13) — Courier provider research: eCourier + Paperfly

Research date: 2026-10-15. Method: official/developer sources
only (provider-owned documentation portals, help centers and
official repos/posts). A marketing page claiming "API
available" without developer documentation is NOT treated as
evidence — the standing TikTok/Daraz/ShurjoPay-refund
precedent. Verdicts below are followed by what was built.

---

## eCourier — VERDICT: BUILD (implemented in GB5)

Official sources (the versioned API documents are the primary
evidence; eCourier's web pages diverge from them in places —
where they conflict, GB5 follows the documents):

- Resources page (links both API documents, labelled v5.5):
  https://ecourier.com.bd/resources/
- General merchant API document (PDF, v5.2, 2022-06-06):
  https://ecourier.com.bd/wp-content/uploads/eCourier_Merchant_API_Document_General_v5.2.pdf
- Reseller API document (PDF, v5.5, 2024-01-25):
  https://ecourier.com.bd/wp-content/uploads/eCourier_Merchant_API_Document_Reseller_v5.5.pdf
- Developer portal (secondary): https://developer.ecourier.com.bd/

### Facts established from the documents

- **API existence**: a documented JSON merchant API. **Every
  operation is a POST** with a JSON body. Live base:
  `https://backoffice.ecourier.com.bd/api`.
- **Auth / credential model** (§1.0): three headers —
  `API-KEY`, `API-SECRET`, `USER-ID` (hyphenated) — plus
  `Content-Type: application/json`; wrong/missing credentials
  return 401. eCourier's web materials have also rendered
  underscore spellings, so the client sends both (the
  hyphenated set is the documented one). **How obtained: the
  documents do NOT evidence a self-serve generation screen** —
  credentials are provider-issued for a merchant account (the
  only evidenced route is obtaining them from eCourier).
- **Verify-before-save call**: `POST /packages` (§2.3) —
  returns the packages ASSIGNED to the merchant (package_code,
  shipping_charge, weight band, coverage), 401 on bad
  credentials. GB5 uses it at connect time. `POST /city-list`
  (§2.6) and `POST /thana-list` (§2.7) power the booking form.
- **Booking**: `POST /order-place` (§2.1, General merchants;
  the Reseller doc's `/order-place-reseller` is a different
  variant, not used). **Mandatory fields**: recipient_name,
  recipient_mobile (11 digits), recipient_city,
  recipient_thana, recipient_area, recipient_address,
  recipient_zip, package_code, product_price, payment_method
  (COD | POS | MPAY | CCRD). There is **no weight field**
  (weight is encoded in the assigned package_code) and **no
  cod_amount field**: for COD, `product_price` IS the amount
  to collect (and must be > 0 for COD). Success returns a
  single **`ID`** — an ECR… identifier used as the
  tracking/consignment id.
- **Charge in the booking response: NONE.** Fee fields exist
  elsewhere (packages: `shipping_charge` — a per-package rate;
  tracking: `shipping_price`). Neither is a booking-response
  charge, so eCourier's `chargeMinor` stays null (GC14 §3
  discipline). The pre-booking quote endpoint likewise answers
  `quotable: false` for eCourier (no documented per-parcel
  charge-calculation call).
- **Tracking**: `POST /track` (§2.2) with `ecr` (the ECR id)
  and/or `product_id`. The response's `query_data` items carry
  `status` as an array of [status, note, timestamp] triples,
  newest first. **The documents publish NO status
  enumeration**; the only status strings evidenced anywhere in
  them are: Initiated, Initiated API, Picked Up, In Source
  Branch, In Transit, In Destination Branch, On the way to
  Delivery, Delivered. GB5 maps those eight, tolerates other
  free-text statuses via defensive fallbacks (eCourier's
  consumer-facing vocabulary, e.g. Return — an in-flight
  "Return Pending" maps to in_transit, never `returned`), and
  preserves every raw string on the GC14 event log.
- **COD**: documented — payment_method COD with product_price
  as the collect amount; the Payment Status call (§2.18)
  returns `cash_on_delivery` / `collected_amount`.
- **Webhooks**: none documented — status is polled, like the
  other providers. **Rate limits**: none documented.
- **Sandbox**: a staging base IS documented (§4.0):
  `https://staging.ecourier.com.bd/api`. No sandbox
  credentials/test accounts are published — a staging
  credential set still comes from eCourier. (The connect form's
  Base URL field accepts it.)

### What GB5 built

- `EcourierClient` implementing the documented contract above
  (all-POST, documented headers, /packages verify, /city-list,
  /thana-list, /order-place with the full mandatory field set,
  /track with query_data parsing), registered in the GC13
  adapter registry. Booking REFUSES when a mandatory field is
  missing, when no tracking id returns, and for a prepaid
  order without a staff-chosen payment method (the documents
  give no prepaid default — never guessed).
- Connect = verify-before-save via the assigned-package list;
  credentials sealed in the existing Integration pattern.
- Booking form: city + thana selects from eCourier's own
  lists, area + zip inputs, a package select from the
  merchant's ASSIGNED packages (code + weight band + rate
  shown), and a payment-method select (COD auto-default only
  when the order collects at the door).
- Multi-account: one Integration row per provider is what this
  tree resolves (see the acceptance doc) — eCourier follows
  the same resolution as the other three.

---

## Per-provider booking-charge facts (GC14 §3)

| Provider | Charge in the BOOKING response? | GB5 behaviour |
|---|---|---|
| Pathao | YES — `delivery_fee` | Stored as `CourierShipment.chargeMinor` (major × 100) |
| Steadfast | No (create_order response documented shape carries none) | null |
| RedX | No (create response carries none; its charge exists only via the separate pre-booking calculator = a quote) | null |
| eCourier | No documented charge field in any response | null |
| Paperfly | NO-BUILD | — |

A quote is never stored as an actual; the EC26 settlement-sheet
charge remains the strongest actual in ON7 profit, with the
booking charge as the labelled fallback (see acceptance).
