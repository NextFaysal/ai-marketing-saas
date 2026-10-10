# Milestone 21 Acceptance — Pathao & RedX Couriers + Live-Verification Prep

Delivered 2026-10-10. No schema change: CourierShipment.provider
already anticipated multiple couriers (Milestone 16 note), and each
provider stores its own encrypted Integration credential.

## API shapes (verified from published documentation BEFORE coding)
- Pathao (merchant.pathao.com Developer API docs): Hermes base
  https://api-hermes.pathao.com (sandbox
  https://courier-api-sandbox.pathao.com), OAuth password grant at
  /aladdin/api/v1/issue-token (5-day tokens, refresh grant), stores
  / city-list / cities/:id/zone-list / zones/:id/area-list, order
  create at /aladdin/api/v1/orders (consignment_id + delivery_fee
  back), status at /aladdin/api/v1/orders/:id/info.
- RedX (RedX open API docs): base
  https://openapi.redx.com.bd/v1.0.0-beta (legacy base
  configurable), header API-ACCESS-TOKEN: Bearer <token>,
  POST /parcel, GET /parcel/info/:id, GET /areas,
  GET /pickup/stores; parcel_weight is in grams.

## Delivered
- CourierService generalized to three providers behind the same
  shipment shape: connect / disconnect / connections list, booking
  (per-provider duplicate guard stays), status sync dispatch, and
  the existing chat-thread notifications working unchanged for
  Pathao/RedX statuses via a shared status vocabulary
  (pending / in_transit / delivered / partial_delivered /
  cancelled / returned).
- Pathao client: token issue + refresh (refreshed tokens persist
  back into the encrypted credential), one forced re-issue on 401,
  connect verifies by issuing a token AND reading the real store
  list; booking auto-picks the first active store when none is
  chosen, validates the 01-prefixed 11-digit phone and the
  0.5-10 kg weight range, omits null location fields (Pathao
  rejects them), and stores Pathao's delivery_fee on the response
  + audit. City/zone/area pickers are served from the live API.
- RedX client: connect verifies by reading the real areas list;
  booking requires a delivery area (id + name from the live list),
  converts kg to grams, sends order items as parcel details and
  the order total as the insured value; a response without a
  tracking id is NOT a booking.
- Orders page: Pathao and RedX connect cards (with a sandbox
  toggle for Pathao), provider picker in the booking form with
  cascading Pathao location selects and the RedX area/store
  selects, and per-provider disconnect.
- Live-verification checklist refreshed: owner action table (14
  items: what to bring, where to get it, what it unblocks),
  sections 13-17 for everything since Milestone 12, and honest
  [x] marks only where evidence exists.

## Live evidence gathered today (real APIs, no mocks)
- Pathao PRODUCTION: our client reached the real token endpoint
  and Pathao judged the (deliberately wrong) credentials with its
  own message "The user credentials were incorrect" (HTTP 400) -
  surfaced in the app as a clean 400; nothing was saved.
- Pathao SANDBOX: repeated attempts returned Cloudflare 522 -
  Pathao's sandbox origin was down on 2026-10-10. The full sandbox
  booking E2E is prepared (public test credentials + sandbox
  toggle in the UI) and stays an open checklist item until their
  sandbox responds again; it is NOT claimed as verified.
- RedX: a dummy token received RedX's own 401 "Unauthorized" from
  the real open API - surfaced as a clean 400; nothing saved.

## Verification
- API tests 269 pass (9 new: status mapping both providers, BD
  phone normalization incl. Bengali digits, Pathao token caching +
  refresh grant + null-location omission, RedX header + tracking
  requirement, service-level Pathao connect/book/duplicate guard,
  RedX area requirement + gram conversion + status sync, RedX bad
  token saves nothing). All Milestone 16 Steadfast tests pass
  unchanged.
- Web builds; live endpoint checks above ran against the sandbox
  demo (connections list, both connect boundaries).

## Limitations
- Pathao credentials include the merchant password (their token
  model needs it for re-issue after refresh expiry); it is stored
  AES-256-GCM encrypted like every other secret and never returned.
- RedX accounts on the legacy base URL must enter it in the
  optional Base URL field; the default is the current open API.
- Delivery-charge quoting (Pathao price plan / RedX charge
  calculator) is not wired into the booking form yet - Pathao's
  booking response fee is shown, which covers the common flow.
