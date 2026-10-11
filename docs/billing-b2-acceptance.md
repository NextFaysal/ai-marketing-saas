# Billing Package B2 — Acceptance (Proration + Scheduled Plan Change)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11),
including a real SSLCommerz sandbox gateway session.
Plan: `docs/billing-package-plan.md`. Schema **107**
(migration `20261010780000_b2_proration`).

## What was built
- **Upgrade proration**: with a live period, buying a
  HIGHER plan credits the unused current-plan value —
  `floor(oldPrice × remainingMs / 30 days)`, capped at the
  new price — as a recorded `prorationMinor` line in the
  money order: price − coupon − proration − credit = due.
  The checkout response surfaces it; the Billing page shows
  it on the covered-in-full path.
- **Activation semantics**: a prorated upgrade starts a
  FRESH 30-day period at activation (the unused days were
  already paid back as proration — extending would pay
  them twice); a same-plan renewal still extends from the
  current period end. Any confirmed payment clears a
  scheduled change. SaasPayment records the FULL value
  (cash + credit + coupon + proration) and the audit
  carries the proration line.
- **Scheduled downgrade / cancel**: POST
  `billing/schedule-change` {plan} (lower plans + FREE
  only; FREE = cancellation) sets `pendingPlan` on the
  subscription; DELETE cancels it. The subscription sweep
  applies it at the period end: FREE lands ACTIVE with no
  period; a paid target becomes the plan owed and the
  period closes PAST_DUE at the lower price. The sweep's
  audit distinguishes a landed change
  (`subscription.plan_change_applied`) from a plain
  past-due. A direct checkout to a LOWER plan is refused
  with a pointer to scheduling.
- **Billing page**: pending-change banner with the
  effective date + cancel button; lower-plan cards (incl.
  FREE) offer "মেয়াদ শেষে কার্যকর করুন / বাতিল করুন"
  instead of buy/request while a period is live.

## Verification
- API jest: **741 pass** overall (4 new B2: exact-half
  proration at 15/30 days pinned by fake timers; downgrade
  refusal; activation fresh-vs-extend periods + full-value
  recording; schedule/cancel/sweep incl. the FREE landing).
- Full build green (web incl. the redesigned billing card
  states).
- **Live proof** (T1 Shop; SSLCommerz sandbox configured
  via the real Admin Console flow — grant-admin → TOTP
  enrol → PATCH platform-config with the public testbox
  store): STARTER with ~2.25 days left → GROWTH checkout
  returned a REAL sandbox GatewayPageURL with
  **prorationMinor 11232** (= 150000 × 2.246/30, exact) and
  amountMinor 288768. Schedule FREE → GET billing showed
  pendingPlan FREE → period forced closed → the real
  `subscription_sweep` job landed it: plan FREE, ACTIVE,
  no period end, pending cleared.
- Period model note: proration assumes the platform's
  30-day period quantum; B3's yearly cycle will carry its
  own period length via the subscription's cycle field.
