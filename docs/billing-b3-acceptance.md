# Billing Package B3 — Acceptance (Yearly Cycle)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11),
including a real SSLCommerz sandbox gateway session.
Plan: `docs/billing-package-plan.md`. Schema **108**
(migration `20261010790000_b3_yearly`).

## What was built
- **Yearly price book**: `planYearlyPrices` joins
  `planPrices` in platform settings — defaults are the
  monthly price × 10 ("২ মাস ফ্রি"), operator-overridable
  via the same Admin settings mechanism (new key +
  validation + an Admin Console yearly-price form).
- **Checkout**: `cycle: monthly | yearly` picks the price
  book; the PlanCheckout records its cycle. Renewal price
  correctness: the subscription remembers `billingCycle`,
  and getBilling prices the current plan from the right
  book.
- **Activation**: a yearly payment extends the period by
  **365 days** (monthly stays 30) via the shared
  `cycleDays()`; the subscription's billingCycle is set
  from the bought checkout.
- **Proration across cycles**: the unused value is priced
  in the CURRENT subscription's own book over its own
  period length — a yearly period prorates over 365 days.
- **Surfaces**: Billing page মাসিক/বার্ষিক toggle; each
  card shows the cycle price and the REAL saving
  (monthly × 12 − yearly, from the two operator prices);
  the hero shows the sub's own cycle; GET /public/pricing
  and the billing payload both carry `yearlyPriceMinor`.

## Verification
- API jest: full suite green (3 new B3: yearly price +
  cycle recorded; +365 activation + cycle remembered;
  yearly proration over 365 days capped at the target
  price, activating in full with a fresh monthly period).
- Full monorepo build green (API + web + admin).
- **Live proof** (T1 Shop, real sandbox gateway): yearly
  STARTER checkout returned a real GatewayPageURL with
  amountMinor **1500000** (৳15,000 = 1500 × 10) and the
  cycle recorded; /public/pricing and GET billing both
  list yearly prices for every tier.

## Notes
- Switching cycle for the SAME plan (e.g. monthly →
  yearly renewal) is a normal checkout: no proration
  (same rank), the new cycle's period extends from the
  current end, and billingCycle flips with the payment.
