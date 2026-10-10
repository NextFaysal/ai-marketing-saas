# Milestone 36 Acceptance — Phase N1 (3/3): SSLCommerz Subscription Payments

Delivered 2026-10-10. With this, Phase N1 (Commercial
Readiness) is complete: M34 billing + invitations, M35 MFA +
onboarding + trial UX, M36 online payments. The whole phase
ships to the owner's GitHub as ONE batched push (his rule).

## Design (decided and documented, per the N1 plan)
- Merchant config is PLATFORM-level (M33 pattern): Admin
  Console -> Settings -> Dynamic Platform Config -> SSLCommerz
  card {storeId, storePass (sealed, never returned), sandbox
  toggle}; env SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASS /
  SSLCOMMERZ_SANDBOX as fallback. Resolution lives in
  common/platform-config.ts (`sslcommerzConfig` SystemSetting
  key; snapshot area added — older snapshot callers keep
  working because new areas default to null).
- Plans are monthly; one successful payment extends the
  subscription by 30 days from the later of now / the current
  period end, sets plan + ACTIVE, and writes a real
  SaasPayment row (method "sslcommerz", reference = tran_id).
- The API base for gateway callbacks comes from
  API_PUBLIC_URL (production: https://api.qosprey.com).

## Schema (90 models, migration 20261010360000_m36_sslcommerz)
- PlanCheckout {organizationId, plan, amountMinor, currency,
  tranId @unique, status initiated|success|failed|cancelled,
  valId, gatewayDetail Json, createdById, completedAt}.

## Flow + trust rules
- POST organizations/:id/billing/checkout (OWNER/ADMIN)
  {plan, phone}: refuses when the gateway is unconfigured
  (honest message pointing at the manual request flow), for
  FREE/unknown plans, and for unpriced plans. Creates the
  PlanCheckout row FIRST, then calls the gateway init API —
  a checkout counts only when SSLCommerz itself answers
  status SUCCESS with a GatewayPageURL; a refusal marks the
  row failed and surfaces the gateway's own failed_reason.
  Gateway calls carry timeouts (20s init / 15s validation).
- POST public/payments/sslcommerz/return (browser): redirects
  to the billing page with an informational flag ONLY. It
  never activates anything, and the billing page copy says
  exactly that.
- POST public/payments/sslcommerz/ipn (server-to-server) is
  the ONLY activation path and requires ALL of: (1) the
  documented IPN signature (md5(store password) + verify_key
  field values, md5 again, constant-time compare), (2) the
  gateway validation API confirming the val_id as
  VALID/VALIDATED, (3) the validated tran_id, amount (exact
  minor units) and currency matching the checkout row,
  (4) idempotency — a completed checkout replays as a no-op
  (no double payment row, no double extension). FAILED /
  CANCELLED IPNs are recorded without activating; unknown
  tran_ids are ignored.
- Web: billing page plan cards gain "💳 অনলাইনে কিনুন" (with
  a receipt phone field) next to the M34 request button, and
  honest return banners (received != activated).

## Verification
- API tests: 360 pass (56 suites; +6 in payments/m36.spec.ts
  covering init success/refusal/unconfigured/FREE, signature
  tampering, validation refusal, amount mismatch, FAILED
  recording, unknown tran, and replay idempotency with the
  period end unchanged).
- pnpm -r build green.
- LIVE against the real SSLCommerz sandbox (published demo
  store testbox, via env config): the API created a real
  checkout and returned a genuine EasyCheckOut GatewayPageURL
  (tran QC…, STARTER ৳1,500); a correctly-signed IPN carrying
  a FAKE val_id was refused by the REAL validation API
  ("gateway validation did not confirm this payment") and an
  unsigned IPN failed signature verification — the target
  subscription stayed FREE/PAST_DUE with zero payments.

## Honest limits
- A full successful sandbox payment (a person completing the
  gateway's card pages so a REAL val_id exists) has not been
  run end to end; the activation leg is unit-proven and its
  refusal legs are live-proven. It closes when the owner runs
  one sandbox payment on his deployment (checklist).
- Live mode needs the owner's own SSLCommerz merchant store
  id/password (merchant onboarding is his action) and the IPN
  URL registered in the gateway panel:
  https://api.qosprey.com/public/payments/sslcommerz/ipn
  (shown in the Admin Console card).
- bKash direct API / ShurjoPay remain future options, as
  planned; nothing here pretends they exist.
