# Milestone 27 (Admin Console Phase C: SaaS Billing) — Acceptance

Date: 2026-10-10. Plan: `docs/admin-console-plan.md`. Built under the
owner's standing autonomy grant.

## Delivered

- **Tier alignment fix (caught before building):** the Prisma
  `SubscriptionPlan` enum is FREE / STARTER / GROWTH / AGENCY — the
  Phase B settings had used a nonexistent "PRO" tier. Plan tiers,
  default prices (FREE 0, STARTER ৳1,500, GROWTH ৳3,000, AGENCY
  ৳8,000 / month — operator-editable settings, not market claims)
  and default limits (FREE 20·200·2, STARTER 50·500·5, GROWTH
  200·1000·10, AGENCY 1000·5000·50) now mirror the schema enum, and
  the Phase B spec + acceptance doc were corrected.
- **Subscription management** (`PATCH /admin/orgs/:id/subscription`,
  SUPER/FINANCE): plan/status/period-end changes with a mandatory
  reason; creates the row when none exists, updates the latest one
  in place otherwise; before/after written to the audit trail. Plan
  changes take effect immediately because the Phase B limit
  resolution reads the live subscription.
- **Manual payments** (`SaasPayment`): record (bKash / bank / cash /
  card / other, reference, optional covered period, note), list with
  org names and string-safe BigInt amounts, delete (SUPER only,
  reason required, full snapshot preserved in the audit entry —
  financial records are never silently erased). Validation: unknown
  org 404, bad method 400, non-positive amount 400.
- **Billing summary** (`GET /admin/billing/summary`): MRR = sum of
  plan prices over ACTIVE subscriptions only (trials excluded),
  per-plan org counts, trialing count, overdue list (PAST_DUE or
  period ended while ACTIVE/TRIALING, with real days-overdue),
  collected this month + all time from actual payment rows.
- **Subscription sweep job** (`subscription_sweep`, runnable per org
  from the tenant automations page or the admin health board): an
  ended TRIALING/ACTIVE subscription becomes PAST_DUE with an audit
  entry. Nothing is ever auto-suspended — suspension remains a
  human admin decision, per the plan.
- **Admin UI:** /billing page (MRR/collection/trial cards, per-plan
  counts, overdue list, manual payment form, payment history with
  audited delete) and a subscription editor on the org detail page.

## Verification

- API tests **318 pass** (5 new Phase C tests: subscription
  validation + in-place update + audit before/after, payment
  validation + listing, audited payment deletion with snapshot,
  billing summary math — MRR ACTIVE-only, overdue days, collections —
  and sweep transitions incl. idempotence).
- Live: subscription set to GROWTH/ACTIVE with period end; a
  ৳3,000 bKash payment recorded; summary showed MRR 300000 and
  collected-this-month 300000 from the real rows; an invalid plan
  ("PRO") was refused with 400, proving the tier validation against
  the real enum.
- One live-found bug fixed: the payment DTO's undecorated
  `amountMinor` field was rejected by the whitelist validation
  pipe; it now carries an explicit validator.

## Limitations (honest)

- Payments are manual records (the BD reality for v1, per plan);
  no online gateway (SSLCommerz) is integrated — a payment row is
  an operator's attestation, and the audit trail shows who recorded
  it. The system never claims a gateway confirmed anything.
- MRR is a simple sum of current plan prices over ACTIVE subs; it
  does not prorate mid-period plan changes.
- The sweep runs per organization (job target = org), matching the
  existing scheduler model; the billing page computes overdue
  platform-wide regardless of whether the sweep has run.
