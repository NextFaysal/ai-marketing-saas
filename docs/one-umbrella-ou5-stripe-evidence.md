# OU5 item 3 — Stripe evidence (verify-first)

Fetched 2026-10-16 from Stripe's OFFICIAL documentation
(docs.stripe.com). Only contract points actually relied on by
the code are recorded; each is paraphrased, not quoted at
length.

## Sources (exact URLs fetched/searched)

1. Checkout fulfillment guide —
   https://docs.stripe.com/checkout/fulfillment?lang=node
2. Webhook signature verification (manual verification page) —
   https://docs.stripe.com/webhooks?verify=verify-manually
3. Retrieve balance API reference —
   https://docs.stripe.com/api/balance/balance_retrieve.md
4. Create a Checkout Session API reference —
   https://docs.stripe.com/api/checkout/sessions/create
   (official curl shape also shown on docs.stripe.com Checkout
   pages: POST https://api.stripe.com/v1/checkout/sessions)
5. Checkout Session object —
   https://docs.stripe.com/api/checkout/sessions/object

## Contract points relied on

### Checkout Session creation (source 4 + 1)
- `POST /v1/checkout/sessions`, authenticated with the secret
  key (HTTP basic `-u sk_...:` / Bearer). Form-encoded body.
- One-time payment: `mode=payment`, `success_url` (required),
  `cancel_url`, and `line_items[0]` with
  `price_data[currency]`, `price_data[unit_amount]`,
  `price_data[product_data][name]`, `quantity=1`.
- `unit_amount` is an integer in the currency's MINOR unit
  (e.g. 2000 = $20.00 USD) — our amountMinor values map 1:1.
- The response carries the session `id` (`cs_...`) and a hosted
  `url`; the buyer is redirected to that URL.
- `metadata[...]` key/values and `client_reference_id` can be
  attached to the session and come back on the session object —
  we store our own transaction/checkout id in BOTH.
- Test mode vs live mode is selected by the KEY itself
  (`sk_test_...` / `sk_live_...`); there is no separate host.
  Test-mode payments move no real money; the documented test
  card `4242 4242 4242 4242` (any future expiry, any CVC)
  succeeds in test mode (source 1).

### Webhook confirmation (sources 1 + 2)
- Fulfillment must be driven by webhooks, NOT by the browser
  landing page: a customer can pay and never reach the
  success_url. The event that announces a completed Checkout
  payment is `checkout.session.completed`; delayed payment
  methods complete later via
  `checkout.session.async_payment_succeeded` (and fail via
  `checkout.session.async_payment_failed`).
- On `checkout.session.completed`, fulfillment checks the
  session's `payment_status` — only `paid` (or
  `no_payment_required`, which cannot occur for our paid plan /
  order sessions) means the money arrived; a session can be
  `complete` while `payment_status` is still `unpaid`.
- The session object carries `amount_total` (minor units),
  `currency`, `payment_intent`, `metadata` and
  `client_reference_id` — we require amount_total + currency
  to match the recorded transaction/checkout EXACTLY before
  anything is marked paid.
- Signature verification (manual scheme, source 2):
  - Header `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=…]`.
  - `signed_payload` = `<t>` + `.` + the RAW request body
    (exact bytes; any re-serialization breaks verification).
  - Expected signature = HMAC-SHA256 hex of signed_payload
    keyed with the endpoint's signing secret (`whsec_...`).
  - Compare in constant time against EACH `v1` value, and
    reject when the timestamp is outside tolerance (Stripe's
    libraries default to 5 minutes) to blunt replay.
  - Verification failure → the endpoint answers 400 and the
    event is NOT processed (source 1's handler shape).
- Fulfillment must be idempotent for the same session id:
  Stripe retries deliveries, so the same event can arrive
  more than once (source 1).
- Session retrieval for reconciliation:
  `GET /v1/checkout/sessions/{id}` returns the same session
  object (source 1 uses retrieve in fulfill_checkout).

### Credential verification (verify-before-save) (source 3)
- `GET /v1/balance` with the secret key returns the balance
  object for the authenticated account, including `livemode`
  (false in test mode). A wrong/revoked key is refused by
  Stripe with an error body. This is a true, side-effect-free
  credential check — the Stripe analogue of bKash's grant-token
  and ShurjoPay's get_token calls — and the returned
  `livemode` lets us cross-check the key's mode honestly.

## What is NOT relied on (deliberately out of scope)
- Stripe subscriptions/recurring objects: platform billing
  here is this codebase's own PlanCheckout + Subscription
  bookkeeping (one Checkout Session per plan purchase,
  mode=payment) — no second subscription architecture.
- Stripe Connect: tenant gateways are the tenant's OWN Stripe
  account keys sealed per-org (the CC9 pattern), not Connect
  connected accounts; platform payments use the platform's
  own Stripe account (the CC10/platform-config pattern).
- Refunds API: not wired in this item (see acceptance doc's
  NOT BUILT list).
