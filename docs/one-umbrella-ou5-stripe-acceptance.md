# OU5 item 3 — Stripe international card rail: acceptance

Addendum to docs/one-umbrella-ou5-acceptance.md (items 1–2:
Nagad NOT BUILT, Refund Center built — neither is disturbed
by this item). Base: f6062221. All commits LOCAL only — no
GitHub push. Evidence: docs/one-umbrella-ou5-stripe-evidence.md.

## Shipped audit

### Foundation (commit 06177737)
- `apps/api/src/common/stripe.client.ts` — the ONE Stripe wire
  implementation: Checkout Session create/retrieve, balance
  credential check, and the documented webhook signature
  verification (HMAC-SHA256 over `${t}.${rawBody}`, constant-time
  compare, 300s tolerance). Injectable fetch, Stripe's own error
  messages propagate, secrets never logged.
- Platform config gains a `stripe` area (SystemSetting key
  `stripeConfig`): secret key + webhook secret BOTH sealed and
  BOTH required for `effectiveStripeConfig()` to resolve
  (admin snapshot → env fallback STRIPE_SECRET_KEY /
  STRIPE_WEBHOOK_SECRET / STRIPE_PUBLISHABLE_KEY).
- TenantGatewayClient delegates its Stripe methods to the same
  client — no second Stripe implementation anywhere.

### (a) Tenant gateway (commit 5ebeb37c)
- Stripe is a per-org gateway provider (`stripe`) in
  TenantPaymentsService / Connect Center, on the SAME sealed
  config + TenantPaymentTransaction bookkeeping as every other
  gateway. Creds: secretKey + webhookSecret (both required —
  a gateway whose payments could not be verified is refused at
  save) + optional publishableKey (the outward identifier).
- Verify-before-save is REAL: `GET /v1/balance` must succeed
  AND its `livemode` must agree with the key's mode, else
  NOTHING is saved (status "verified" on success).
- Mode coherence: Stripe picks test/live BY THE KEY, so the
  LIVE credential set accepts only sk_live_ and the SANDBOX set
  only sk_test_ — a mismatch is refused before any Stripe call,
  so test money can never complete a real order.
- Initiation creates a hosted Checkout Session (mode=payment,
  amountMinor passed verbatim as unit_amount, the order's own
  currency), stores the session id as providerTxnId, returns
  the hosted URL. The txn stays "initiated".
- Paid ONLY via `POST /public/tenant-payments/stripe/webhook`:
  signature verified over the RAW body against THAT
  transaction's sealed webhook secret (a forgery attempt is
  recorded as a CC23 `signature_invalid` IPN event), then
  checkout.session.completed / async_payment_succeeded with
  payment_status "paid" + amount_total + currency matching the
  txn EXACTLY → the shared markVerifiedPaid path (order stamp,
  wallet rules, deposit bookkeeping, link spend, order.paid
  event all inherited). Duplicate delivery → alreadyProcessed.
  checkout.session.expired / async_payment_failed record the
  failure honestly. The browser return
  (`GET /public/tenant-payments/stripe/return`) never marks or
  records anything — it only redirects to the shop success page,
  which polls the verified state.
- The labelled sandbox test initiation (CC19) now supports
  Stripe on the sandbox (test-key) set; its webhook completion
  is recorded as test evidence and, per the existing sandbox
  guard, never touches a real order or wallet.
- Public shop options offer Stripe ONLY as an own gateway
  (never platform); the (provider, source) pair is re-validated
  server-side exactly like the other providers.
- Web: Stripe card in the Connect Center gateway panel
  (secret key + webhook secret + publishable key, honest
  test-mode/live-mode labels, webhook-endpoint instructions),
  shop checkout option + labels, staff Collect-Payment button.
- Spec: ou5-stripe-tenant.spec.ts — 15/15 (verify failure saves
  nothing; mode mismatch refused pre-call; valid signature pays
  exactly once + duplicate idempotent; invalid signature /
  tampered body / amount / currency / payment_status never pay;
  initiation and browser return never pay; sandbox isolation;
  secrets never surface).

### (b) Platform subscription billing (commit b1eeadfc)
- Admin Console platform config gains the Stripe area
  (SUPER-only PATCH + test routes): both secrets sealed; the
  safe view shows only configured booleans, the publishable
  key and the key mode. Verify-before-save runs the REAL
  balance read (+ livemode cross-check) whenever a secret key
  is in the merged config — a failure audits
  `platform_config_verify_failed` and saves NOTHING. A key
  saved without its webhook secret never resolves, so no
  unverifiable checkout can be created.
- PaymentsService accepts gateway "stripe" alongside
  sslcommerz/bkash: the SAME PlanCheckout row, coupon/credit/
  proration math and `activate()` bookkeeping — one Checkout
  Session (mode=payment) per plan purchase, the checkout id in
  the session metadata + client_reference_id. Stripe's own
  subscription objects are deliberately NOT used (no second
  subscription architecture).
- Activation ONLY from `POST /public/payments/stripe/webhook`:
  signature verified over the raw body against the platform's
  sealed webhook secret BEFORE the body is trusted, then paid +
  exact amount_total + currency → activate(). Duplicates answer
  alreadyProcessed (exactly one SaasPayment, method "stripe").
  The browser return is a pure redirect. Reconcile re-reads the
  session from Stripe and judges it by the same rules.
- Web: Billing page gateway choice gains "Stripe (আন্তর্জাতিক
  কার্ড)" — shown only when the platform's Stripe config is
  complete (organizations billing summary `gateways.stripe`);
  the checkout result's test/live mode is honestly labelled via
  the existing sandbox flag. Admin Settings gains the Stripe
  card (mode badge, verify-on-save note, webhook URL).
- Specs: ou5-stripe-billing.spec.ts 7/7; ou5-stripe-platform-
  config.spec.ts 8/8 (one StripeClient error-wrap bug was found
  by the admin spec and fixed in the same commit).

## PayPal verdict — NOT BUILT (by design decision, recorded)

PayPal does NOT fit this codebase's gateway pattern cleanly:
- The pattern every gateway here follows is: hosted redirect →
  asynchronous server notification (IPN / callback) → an
  independent server-side verification (validation API, execute
  call, Search Transaction, or — Stripe — a signature-verified
  webhook carrying the final paid state) → markVerifiedPaid /
  activate().
- PayPal Checkout's documented flow is a different shape:
  Orders v2 create → buyer approval → a separate server-side
  CAPTURE call that the merchant must issue after approval,
  with its own OAuth2 client-credentials token lifecycle and
  its own webhook event family (PAYMENT.CAPTURE.COMPLETED etc.)
  and verification model. Wiring it honestly means a second
  capture-orchestration architecture (approval-state tracking +
  capture + capture verification), not another row in the
  existing initiation + verified-confirmation pattern.
- Per the brief's instruction, no second architecture was
  built and nothing was faked: there is NO PayPal gateway,
  config, or UI in this item. Revisit only as its own item
  with the Orders v2 contract evidenced from PayPal's official
  docs first (verify-first, like Nagad).

## Explicit NOT BUILT list
- PayPal (see verdict above).
- Stripe refunds API: gateway refunds for Stripe transactions
  are NOT wired; PaymentRefundsService still refuses non-
  sslcommerz/bkash gateway refunds honestly. A Stripe refund
  today happens in the merchant's Stripe Dashboard and is NOT
  tracked in the Refund Center (stripe is not in
  MANUAL_REFUND_PROVIDERS — the OU5 Refund Center item was not
  disturbed). Follow-up candidate.
- Stripe platform gateway for SHOP orders (CC10/wallet):
  platform shop payments stay sslcommerz/bkash; Stripe platform
  config serves subscription billing only, and tenant Stripe is
  own-gateway only. No wallet credit path for Stripe exists.
- Stripe subscriptions/recurring objects, Connect, Payment
  Element/embedded checkout, payment links via Stripe — none
  built; hosted Checkout only.
- Currency conversion: none. A Stripe session is created in
  the order's / checkout's own recorded currency; if the
  merchant's Stripe account cannot charge that currency,
  Stripe itself refuses and the error surfaces — nothing is
  converted or invented.
- NO live charge was made or is claimed: all specs stub the
  Stripe boundary; live proof is the owner's checklist below.

## Migration claim
NONE. No schema change was needed (provider/gateway are plain
strings; secrets live in the existing sealed-config stores).
The OU5 range starting 20261022000000 remains entirely free.

## Gates (serial, as run)
- API jest src/connections: 29 suites — 377/378 tests pass;
  sole failure cc26-payout-automation (known base-proven
  pre-existing, per brief).
- API jest src/payments + src/admin + src/organizations +
  src/public-docs: 44 suites — 393/396 pass; failures are
  gb9-public-docs (2 tests — pre-existing: the TD line's
  /public/shop/domain-allowed + one more shop route were never
  added to the frozen inventory; the spec and storefront files
  are byte-identical to base f6062221 in this tree, and this
  item touches neither) and adx3-nav-counts (1 test — known
  base-proven pre-existing, per brief).
- API jest src/payments alone: 8 suites / 42 tests, all pass.
  API jest src/admin alone: 23 suites / 245 tests, sole
  failure adx3-nav-counts.
- New specs: ou5-stripe-tenant 15/15, ou5-stripe-billing 7/7,
  ou5-stripe-platform-config 8/8. Regression neighbours green:
  cc9, gc11, cc10, ou5-refund-center, m36, m39, b2, b3,
  ou2-cloudflare-config, aa3-config-verify.
- API tsc: 0 errors.
- Web: vitest 110 files / 901 tests, all pass; tsc 0 errors
  (after widening two checkout payload provider unions the gate
  caught — commit 681a41d3); next build green.
- Admin: vitest 9/9; tsc 0 errors; next build green.
- Fresh-PG migration run: N/A — no migration in this item.

## Owner sandbox / test-mode checklist (ALL UNCHECKED)
- [ ] Tenant path: create a Stripe account (or use an existing
      one) in TEST mode; from Stripe Dashboard → Developers →
      API keys copy the test Secret Key + Publishable Key.
- [ ] Tenant path: Stripe Dashboard → Developers → Webhooks →
      add endpoint `https://api.qosprey.com/public/tenant-payments/stripe/webhook`,
      subscribe `checkout.session.completed` (plus
      `checkout.session.async_payment_succeeded`,
      `checkout.session.async_payment_failed`,
      `checkout.session.expired`), copy that endpoint's
      Signing secret (whsec_).
- [ ] Tenant path: Connect Center → Stripe card → Sandbox set:
      save test Secret Key + Signing Secret (save must show
      "যাচাই হয়ে সেভ হয়েছে"); run the labelled ৳100 test
      payment with test card 4242 4242 4242 4242 (any future
      expiry, any CVC) and confirm the transaction history
      shows it as a Sandbox verified test — and that NO real
      order changed.
- [ ] Tenant path: in the Sandbox set's shop flow, place a real
      test order, pay by Stripe (test card), and confirm the
      order becomes paid ONLY after the webhook lands (success
      page polls to verified_paid), exactly once.
- [ ] Platform path: Admin Console → Settings → Stripe card:
      save the platform account's TEST Secret Key + Webhook
      Signing Secret (publishable key optional); the save must
      pass the balance verification and show mode TEST.
- [ ] Platform path: register webhook endpoint
      `https://api.qosprey.com/public/payments/stripe/webhook`
      in the platform Stripe account (same events as above).
- [ ] Platform path: Billing page → buy a plan with Stripe
      (test card 4242…) and confirm the plan activates only
      after the webhook, the payment history shows method
      "stripe", and a replayed webhook (Stripe Dashboard →
      resend) does not double-activate.
- [ ] Negative proof: send the tenant webhook a hand-crafted
      unsigned POST (or resend with a wrong secret) and confirm
      HTTP 400 and no payment state change.
- [ ] Only after all of the above: repeat with LIVE keys
      (tenant live set / platform live save), one smallest
      real charge each, and confirm settlement in the Stripe
      Dashboard. NOTE: plan prices are BDT-denominated; confirm
      the Stripe account can charge BDT (or decide plan
      currency policy) BEFORE enabling live Stripe billing.
