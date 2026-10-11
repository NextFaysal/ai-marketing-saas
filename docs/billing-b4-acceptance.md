# Billing Package B4 — Acceptance (bKash Auto-Renew)

Status: **DELIVERED** (2026-10-11). Live-proven to the
bKash auth boundary; the agreement round-trip itself is
**NOT live-proven** — no real bKash merchant exists in the
sandbox (see Verification). Plan:
`docs/billing-package-plan.md`. Schema **109**
(migration `20261010800000_b4_autorenew`).

## What was built
- **Consent flow**: POST `billing/auto-renew/start` calls
  bKash's tokenized **agreement/create** and returns the
  bKash URL. The browser returns to
  `public/payments/bkash/agreement/callback`, which trusts
  NOTHING from the redirect: the agreement is **executed
  server-to-server** and the agreement id is stored
  **sealed (AES-256-GCM)** only on bKash's confirmation.
  No API ever returns the id — getBilling exposes status,
  payer number, last charge, last error only.
- **Charges**: the new `auto_renew` scheduled job (daily)
  charges when the period ends within 24h: cycle price −
  account credit through the normal PlanCheckout +
  activate() path, checkout/create carrying the
  agreementID (tokenized mode), and activation ONLY on
  execute returning statusCode 0000 + transactionStatus
  Completed. A fully credit-covered renewal activates
  without a gateway call, like checkout.
- **Failures**: recorded on the checkout (failed), on the
  agreement (lastError) and in the audit
  (`billing.autorenew_charge_failed`); the subscription
  then follows the existing sweep → PAST_DUE → dunning
  path. Nothing is silently retried or claimed.
- **Cancel**: POST `billing/auto-renew/cancel` calls
  bKash's agreement/cancel (result reported), wipes the
  sealed id, and audits.
- **Billing page**: an Auto-Renew card (shown only when
  the platform has bKash configured) with status, consent
  start (reusing the payment phone field), cancel, and
  ?autorenew= return banners.

## Verification
- API jest: full suite green (4 new B4 with a stubbed
  bKash: consent stores the id sealed and the public view
  never contains it; a due charge creates + executes and
  activates with the period extended; a Failed execute
  leaves the subscription untouched and records the
  error; not-due makes NO charge call; cancel calls
  bKash and wipes the seal).
- Full build green; the API boots with the new
  AutomationModule → PaymentsModule wiring.
- **Live (sandbox)**: with dummy bKash credentials saved
  through the real Admin Console, auto-renew/start reached
  bKash's REAL token endpoint — a direct probe returned
  bKash's own `9999 "Invalid or unrecognized access
  credentials"`; through the app the same attempt surfaced
  as a clean 400 (first attempt hit the 20s gateway
  timeout — sandbox latency; second returned the refusal)
  and **zero agreement rows were stored**. The auto_renew
  job ran via the real job runner and reported
  no_active_agreement as a successful, honest run.

## NOT proven / required before production
- The agreement create/execute/cancel round-trip and an
  agreement-backed charge against a REAL bKash merchant
  (sandbox or production). The request shapes follow
  bKash's documented tokenized agreement API and the same
  base/auth as the M39-verified checkout calls, but the
  mode/agreement semantics must be confirmed with the
  platform's merchant credentials — this is the B4 item
  on the live-verification checklist.
