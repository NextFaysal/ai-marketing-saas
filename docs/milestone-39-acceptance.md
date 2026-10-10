# Milestone 39 — Admin Phase A3: Billing & Money++ (Acceptance)

Built 2026-10-10 from `docs/admin-master-plan.md` Phase A3.
Schema 92 models; migration `20261010390000_m39_billing_plus`
(PlanCheckout gateway/credit/discount/coupon fields,
Organization.creditMinor, SaasPayment refund fields, new
Coupon + CouponRedemption models).

## What was built

- **Checkout reconciliation** — `GET /admin/billing/checkouts`
  (org names, discount/credit breakdown, `stuck` = initiated
  > 1h) and `POST /admin/billing/checkouts/:id/reconcile`:
  SSLCommerz via the merchant transaction-query API then the
  SAME validation + amount/currency confirmation as the IPN
  path; bKash via payment-status query. A gateway record that
  does not confirm changes nothing and says why.
- **Refunds** — `POST /admin/payments/:id/refund` (SUPER/
  FINANCE, reason required): partial or full, never more than
  the un-refunded remainder; audited with totals. Access
  changes are explicit only: `revokeAccess: true` flips the
  subscription to PAST_DUE — a refund never silently rewrites
  period dates. Billing summary + analytics collections are
  NET of refunds everywhere.
- **Invoices** — printable HTML invoice from the payment row
  (print → PDF, no new dependency; refunds netted and shown),
  at `GET /admin/payments/:id/invoice` and the org-scoped
  tenant route; `POST /admin/payments/:id/invoice-email`
  emails OWNER/ADMIN members via the real EmailProvider.
- **Proration** — a mid-period plan change on an ACTIVE
  subscription credits unused days of the OLD plan price
  (30-day periods) to `Organization.creditMinor`, recorded in
  the audit metadata + an admin note. Checkout spends credit
  automatically (price − coupon − credit = charged).
- **Coupons** — admin CRUD (`/admin/coupons`, deactivation
  needs a reason), percent (1–90) or fixed, plan scope,
  expiry, redemption cap. Tenant preview endpoint shows
  discount + credit + due before paying. Redemptions are
  recorded ONLY at activation, with the full value on the
  SaasPayment row and the breakdown in the audit entry.
  A checkout fully covered by coupon/credit activates with
  NO gateway call and the payment note says exactly that.
- **Dunning** — scheduler job `dunning_reminders`
  (AutomationService.sendDunningReminder): PAST_DUE orgs get
  stage 1/3/7 emails to OWNER/ADMIN; each stage is sent once
  per past-due episode (audit log is the dedupe record).
  `GET /admin/billing/dunning` shows stages actually sent.
  Unconfigured email = the job fails honestly.
- **bKash gateway** — sixth dynamic platform-config area
  (Admin Console card; secrets sealed, env fallback). Token
  grant cached; checkout create (mode 0011); the browser
  callback activates ONLY after the server-to-server execute
  confirms `transactionStatus: Completed` with the exact
  amount. Tenant billing shows the gateway choice only when
  bKash is actually configured; credit balance is displayed.
- **Revenue export** — `GET /admin/billing/export.csv`
  (gross/refunded/net per payment, org names).

## Bugs the live run caught (fixed + regression-tested)
1. Coupon creation returned 500: the controller passes
   `req.adminUser` (`.id`) while the service expected
   `.userId` — `createdById` was undefined. Both actor shapes
   are now accepted; a spec pins it.
2. Adding `Organization.creditMinor` / `SaasPayment.refundedMinor`
   (BigInt) made every endpoint that spreads a raw org/payment
   row fail JSON serialization with a 500 — AFTER the write had
   succeeded in one case. All such returns (admin org list/
   detail/limits, payment record, tenant org create/list/get)
   now stringify the BigInt fields explicitly.

## Verification
- **API tests: 375 pass (58 suites)**, incl. 11 new M39 tests:
  coupon→credit→gateway charge math; full-cover activation
  with ZERO gateway calls + redemption bookkeeping; expired
  coupon refusal; bKash create + Completed-only activation +
  non-Completed refusal; SSL reconcile from the gateway's own
  record + honest no-record; refund caps + explicit revoke;
  proration credit math (15/30 days); dunning stage-once.
- Live on the sandbox: coupon created + preview (GROWTH
  300000 → discount 30000, due 270000); bKash checkout without
  merchant config → honest 400; manual payment → invoice
  (INV-…) → partial refund (net 200000) → CSV export row;
  proration live: GROWTH/ACTIVE +15d → change to AGENCY
  credited exactly 150000 and the tenant billing view shows
  the credit; bKash config PATCH shows source "admin" with no
  secret values, clear reverts to env/none.

## Not claimed / still open
- bKash has NOT been run against the real bKash sandbox —
  that needs the owner's merchant credentials (grant would be
  the first real call). The adapter is unit-verified against
  the documented request/response shapes and refuses honestly
  when unconfigured. (Checklist: bKash live sandbox session.)
- SSLCommerz full successful card payment remains the owner's
  M36/M30 live item; reconciliation covers the lost-IPN case
  once money actually moved.
