# OB4 Acceptance — OU5 (Payments completion) + OU3 (Daraz channel)

**Batch:** One-Umbrella OB4 · **Date:** 2026-10-16 · **Worktree:** `~/workspace/ai-marketing-saas-ou` · **Branch:** `one-umbrella`
**Base HEAD:** `21503929` (OB3 code-complete, tree clean at start — verified by coordinator) · **Final HEAD:** recorded in the commit carrying this doc's final version (see `git log`; tree clean at delivery)
**Commits:** 13 worker commits over base (3 OU5 items 1–2, 5 OU5 item 3, 4 OU3, + per-item acceptance docs) + this consolidation. LOCAL COMMITS ONLY — no GitHub push.
**Migrations:** NONE claimed. The `20261022000000+` range remains entirely unused — every OB4 item fit existing models/bookkeeping. Fresh-Postgres run: N/A.
**Per-item docs:** `one-umbrella-ou5-acceptance.md` (Nagad + Refund Center), `one-umbrella-ou5-stripe-acceptance.md` + `one-umbrella-ou5-stripe-evidence.md` (Stripe, PayPal verdict, sandbox checklist), `one-umbrella-ou3-acceptance.md` + `one-umbrella-ou3-daraz-spike.md` (Daraz spike + build).

---

## Step-0 findings (OU5, file-cited)

- `connections/tenant-payments.service.ts`: Nagad saved only as "configured" — no credential check or checkout wiring (`TenantNagadCreds` referenced only in the gateway client); all initiation paths refused honestly. In-code comment: ShurjoPay/aamarPay document NO refund API — refunds for those are a manual provider-dashboard process.
- `connections/payment-refunds.service.ts` (CC24): API refunds = SSLCommerz + bKash only. The single money-state path is `applyVerifiedRefund` on `PaymentRefund` rows (schema L1341): cap-checked creation (Σ refunded + in-flight ≤ paid, one tx), completion in one tx (row→refunded + verifiedAt, `Order.refundedMinor` advanced capped at total, order-note evidence, full-refund status mapping, platform-source-only Wallet `refund_debit`), status re-check inside the tx = exactly-once. Audit via `AuditService.log` (`payment_refund.*`); role floor OWNER/ADMIN (`WRITE_ROLES`).
- `wallet.service.ts` (CC10 platform gateway) and `payments/payments.service.ts` (platform subscription billing, SSLCommerz IPN verify) read to confirm separation — wallet untouched; billing extended only by the Stripe item through its own existing gateway seam.

## OU5 — shipped audit

### Item 1 — Nagad checkout: ❌ NOT BUILT (verify-first verdict)
Official/primary documentation could NOT be evidenced: searches for Nagad merchant/developer docs returned only blogs and community repos; `site:nagad.com.bd` developer search returned nothing; https://developer.nagad.com.bd did not resolve. Missing: initiation endpoint/envelope, encryption/signature construction, callback parameters, server-side verification contract. Per the no-fake-integration rule, nothing was wired. Shipped instead (commit `080cdfd8`): the honest refusal kept, with a clearer Bengali merchant explanation (API refusal text + Connect Center Nagad card note: why no checkout, manual-number alternative, Refund Center for refunds) and `docs/one-umbrella-ou5-nagad-evidence.md` (evidence record + live-verification checklist). Also NOT BUILT: Nagad credential verify-before-save, Nagad refund API.

### Item 2 — Refund Center: ✅ BUILT (commit `8ab5b9d4`, NO migration)
Manual-mode refunds for API-less providers (ShurjoPay, aamarPay, Nagad + gateway-manual SSLCommerz/bKash) ride the SAME `PaymentRefund` rows: `gatewayStatusRaw.manual=true` (+ proofNote/recordedBy/completedBy), provider-dashboard reference in `gatewayRefundRef`. Flow: `createManualRefundRequest` (verified_paid, non-sandbox only) → `recordManualRefundAction` (provider reference REQUIRED) → `completeManualRefund` → runs the SAME `applyVerifiedRefund` bookkeeping (only the order-note label differs) — no second set of books. Shared cap-checked row creation across modes (CC24 API path behavior-identical, cc24 spec green). Duplicate completion returns as stored (idempotent). `refreshRefund`/`listRefunds` never gateway-refresh manual rows. Role floor OWNER/ADMIN, audited (`payment_refund.manual_requested/.manual_recorded/.verified`). Routes: `POST payment-transactions/:txnId/refunds/manual`, `POST refunds/:refundId/manual/record`, `POST refunds/:refundId/manual/complete`. Web: Refund Center section in the existing refunds panel with the honest label "provider dashboard-এ হাতে করা হয়েছে — প্ল্যাটফর্ম ট্র্যাক করছে". Spec: 8/8.

### Item 3 — International card rail (Stripe): ✅ BUILT (a)+(b); PayPal ❌ NOT BUILT
Evidence from Stripe's official docs (fetched 2026-10-16, full record in the evidence doc): fulfillment ONLY after webhook confirmation (docs.stripe.com/checkout/fulfillment); manual webhook signature verification over the raw body — HMAC-SHA256 of `${timestamp}.${raw JSON}` with the endpoint's `whsec_` secret, 5-min tolerance (docs.stripe.com/webhooks); Checkout Sessions create with minor-unit amounts + `GET /v1/balance` as the credential check (docs.stripe.com/api).
- Foundation (`06177737`): ONE shared `StripeClient` (session create/retrieve, balance check, documented signature verification); platform-config gains a sealed `stripe` area (both secrets required to resolve).
- (a) Tenant gateway (`5ebeb37c`): per-org Stripe provider on the existing sealed config; verify-before-save = real `GET /v1/balance` + livemode cross-check + mode coherence (live set ↔ sk_live_, sandbox set ↔ sk_test_) — failure saves nothing. Initiation creates a Checkout Session on the existing `TenantPaymentTransaction` bookkeeping; paid ONLY via the signature-verified webhook (forgeries recorded as CC23 `signature_invalid` events) requiring `payment_status=paid` + exact amount/currency → shared `markVerifiedPaid`; duplicates idempotent; browser return marks nothing; own-gateway only, never platform. Web: Connect Center Stripe card (honest test/live labels + webhook instructions), shop checkout, Collect-Payment. Spec 15/15.
- (b) Platform billing (`b1eeadfc`, web fix `681a41d3`): Admin Console Stripe area (SUPER-only, both secrets sealed, verify-before-save via real balance call; failure audited and NOT saved). `PaymentsService` gateway "stripe" alongside SSLCommerz/bKash — same PlanCheckout + `activate()` bookkeeping (Stripe subscription objects deliberately unused); activation ONLY from the signature-verified webhook; browser return is a pure redirect; reconcile re-reads the session. Billing page "Stripe (আন্তর্জাতিক কার্ড)" shown only when configured. Specs 7/7 (billing) + 8/8 (platform config).
- **PayPal: NOT BUILT** — Orders v2 (create → buyer approval → server-side CAPTURE, own OAuth2 token lifecycle + capture-event verification) is a different capture-orchestration architecture, not a row in this codebase's initiate + verified-confirmation pattern. No second architecture built; nothing faked.
- Also NOT BUILT: Stripe refunds API (refused honestly; dashboard refunds untracked — Refund Center untouched by this item), Stripe as CC10 platform gateway for shop orders (tenant Stripe is own-only; platform Stripe is billing-only), Stripe subscription objects/Connect/embedded checkout, currency conversion (sessions use the order's recorded currency; BDT chargability is an owner checklist item). No live charge made or claimed.

## OU3 — Daraz: spike verdict + shipped audit

Spike (`be701d99`, `one-umbrella-ou3-daraz-spike.md`): From official sources — Daraz runs its own Open Platform portal (open.daraz.com, no contract rendered there); the shared Alibaba stack's signature contract (HMAC-SHA256 over sorted params prefixed with API path) and seller-authorization/app-gating model ARE evidenced from Lazada Open Platform official docs (clearly marked as shared-stack evidence). NOT evidenced: any Daraz (BD) production base URL (the official endpoint list covers only the 6 Lazada ventures), Daraz product/order payload contracts, Daraz Seller Center order-export CSV columns, current bulk-upload template columns. A BD seller needs: verified Seller Center account → developer app on open.daraz.com with partner approval → per-store OAuth authorization.
- Adapter: ✅ BUILT in labelled refusing state (`a23f13cf`) — evidenced `signDarazRequest` (vector-tested), `DarazDevAdapterClient` (developmentAdapter, refuses every operation, never calls fetch — Paperfly precedent, spec-proven), per-org sealed config over existing Integration/IntegrationCredential with verify-before-save honestly failing → `configured_not_verified`, status forced DISCONNECTED, EC1 registry adapter with ALL capabilities false. Spec 11/11.
- Feed export: ✅ BUILT (`c63d896b`) — `serializeDarazCsv` over EC14 `buildFeedItems` from the REAL catalog (quantity blank when unknown — never invented), `daraz` channel in FeedsService (CSV-only, XML refused, preview carries the unverified-template warning), web feeds page with honest Bengali labels. Feeds spec 18/18.
- CSV order import: ❌ NOT BUILT — column contract not evidenced; columns were NOT guessed. Also NOT BUILT: any live Daraz call, OAuth flow UI, `StorePlatform.DARAZ` (deferred), any template-conformance claim.

## Gates (serial, exactly as run by workers; coordinator spot-check at the end)

- OU5 items 1–2: API jest ou5-refund-center + cc24 + cc9 = 3 suites 31/31; connections full = 28 suites 362/363 (sole failure cc26 — base-proven pre-existing); API tsc 0; web vitest 110 files/900; web tsc 0; web build green.
- OU5 item 3: connections = 29 suites 377/378 (sole cc26); payments+admin+orgs+public-docs = 44 suites 393/396 (gb9-public-docs 2 — spec/storefront files byte-identical to base, pre-existing on this line; adx3-nav-counts 1 — base-proven); payments alone 42/42; API tsc 0; web vitest 110/901, tsc 0, build green; admin vitest 9/9, tsc 0, build green.
- OU3: ou3-daraz 11/11; feeds 18/18; adjacent registry suites 22/22; API tsc 0 (first attempts OOM-killed by parallel sweeps on the 7 GB VM — passed solo with capped heap, per the never-conclude-from-OOM rule); web vitest 110/901, tsc 0, build green (solo rerun after a memory-pressure abort).
- **Coordinator independent spot-check (2026-10-16, after all workers): API jest ou5-refund-center + ou5-stripe (tenant/billing/platform-config) + ou3-daraz + feeds + cc24 = 7 suites, 76/76 passed.**
- Fresh-PG: N/A — no migration in OB4.

## Explicit NOT BUILT list (OB4 total)

1. Nagad checkout + credential verify + refund API (official contract not evidenced).
2. PayPal (any part) — different capture architecture; no second architecture built.
3. Stripe refunds API; Stripe as CC10 platform gateway; Stripe subscription objects/Connect/embedded checkout; currency conversion.
4. Daraz live API calls (product/order sync), Daraz OAuth UI, Daraz order CSV import (column contract not evidenced), Daraz template-conformance claim.
5. Any live proof of any OB4 item (no real gateway/Stripe/Daraz account was used) — M30 owed for all of it.

## M30-style live checklist (ALL UNCHECKED)

Nagad:
- [ ] Obtain official Nagad API documentation + sandbox credentials through Nagad merchant onboarding
- [ ] Evidence the signature + server-side verification contract from that documentation
- [ ] Only then: wire initiation + verified completion; sandbox proof; one low-value live payment proof

Refund Center:
- [ ] One real manual refund (ShurjoPay or aamarPay) performed in the provider dashboard and tracked end-to-end in the Refund Center; order refund state + note verified against the dashboard record

Stripe (owner sandbox checklist, full text in `one-umbrella-ou5-stripe-acceptance.md`):
- [ ] Tenant: save TEST keys in the Connect Center Stripe card (verified-save must pass); register the tenant webhook endpoint and copy its whsec_
- [ ] Tenant: labelled test payment + one real test order with card 4242 4242 4242 4242 — paid only after webhook, exactly once
- [ ] Platform: save platform TEST Secret + Webhook Secret in Admin Settings → Stripe; register the platform webhook endpoint
- [ ] Platform: buy a plan with a test card — activation only after webhook; resend does not double-activate
- [ ] Negative proof: unsigned/wrong-secret webhook POST → HTTP 400, no state change
- [ ] Before LIVE keys: confirm the Stripe account can charge BDT (plan prices are BDT)

Daraz:
- [ ] Create developer app on open.daraz.com + obtain partner approval
- [ ] Real BD seller OAuth authorization against a real store
- [ ] Evidence the BD production endpoint + product/order payload contracts from official docs
- [ ] First real order pull reconciled against Seller Center
- [ ] Verify the exported feed CSV against a real current Seller Center bulk-upload template
- [ ] Obtain a real Seller Center order-export sample — only then build CSV import
