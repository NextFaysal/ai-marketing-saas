# OU5 (OB4, parts 1–2) — acceptance (2026-10-16, branch `one-umbrella`, base 21503929)

Local commits only. No migration claimed (range from
20261022000000 untouched — no migration was needed).

## Item 1 — Nagad checkout: NOT BUILT (verify-first)

Nagad's official merchant checkout API documentation could not
be evidenced from a primary source: `site:nagad.com.bd` search
returned nothing, general search returned only blogs (LinkedIn /
freelearning365) and community GitHub repos, and the developer
portal fetch failed (not resolvable). The exact signature /
encryption contract and the server-side verification contract
are therefore NOT evidenced, so no checkout was wired and the
honest refusal stays. Shipped instead: clearer merchant-facing
explanation in the API refusal + the Connect Center Nagad card,
and the evidence record + live-verification checklist in
`docs/one-umbrella-ou5-nagad-evidence.md`.

## Item 2 — Refund Center: BUILT

Manual tracking for API-less refunds (ShurjoPay, aamarPay,
Nagad) and gateway-manual cases (sslcommerz/bkash by staff
choice), on the SAME `PaymentRefund` rows — manual marker in
`gatewayStatusRaw.manual`, provider-dashboard reference in
`gatewayRefundRef`, proof note / recorded-by / timestamps in
the same JSON. Flow: create request (initiated; shared cap) →
record dashboard action (provider reference REQUIRED →
processing) → complete, which runs CC24's `applyVerifiedRefund`
unchanged apart from a manual order-note label — identical
order `refundedMinor`/status mapping and platform wallet
`refund_debit`, exactly once; duplicate completion returns as
stored. `refreshRefund`/`listRefunds` never gateway-refresh a
manual row (its ref is not a gateway id). Gateway API path
untouched (row creation extracted into one shared
cap-checked helper used by both modes). Role floor OWNER/ADMIN
(same as CC24 actions), all steps audited
(`payment_refund.manual_requested|manual_recorded|verified`).
Web: Refund Center section inside the existing
`payment-refunds-panel` with the honest label
"provider dashboard-এ হাতে করা হয়েছে — প্ল্যাটফর্ম ট্র্যাক করছে".

Endpoints (ConnectionsController, all `@Roles(OWNER, ADMIN)`):
- `POST payment-transactions/:txnId/refunds/manual`
- `POST refunds/:refundId/manual/record`
- `POST refunds/:refundId/manual/complete`

## Gates (serial)

- API jest touched suites: ou5 (8) + cc24 + cc9 — 3 suites,
  31/31 passed. Full `src/connections` run: 28 suites, 362/363
  — sole failure `cc26-payout-automation` (known base-proven
  pre-existing, unrelated to this change).
- API `tsc --noEmit`: 0 errors.
- Web vitest: 110 files / 900 passed. Web tsc: 0. Web
  `next build`: green.
- Fresh-Postgres migration run: N/A — no migration added.

## NOT BUILT

- Nagad checkout + Nagad credential verify + Nagad refund API
  (contract not evidenced — see evidence doc + checklist).
- Stripe/PayPal international rail (OU5 parts 3–4 — separate
  worker scope, untouched here).
- Any live proof: no real provider dashboard refund was
  performed; the manual flow is spec-proven only (M30 owed).
