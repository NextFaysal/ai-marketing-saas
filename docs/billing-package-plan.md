# Billing Package — Plan (B1–B6)

Approved in full by the owner 2026-10-11 ("বিলিং প্যাকেজ
পুরোটাই একে একে করো (B1→B6)"), after the Subscription &
Billing audit of the same day. Local commits only.

## Audit baseline (verified in code)
Already built: plan hero + real usage/limits, SSLCommerz +
bKash checkout (activation only on gateway-confirmed
success), coupons with preview, referral credit in the
money order (price − coupon − credit = due; due 0 activates
without a gateway), payment history (20) + per-payment
invoice download, activation extends from the current
period end (early payment loses no days), subscription
sweep → PAST_DUE + read-only gate, staged dunning emails,
plan-change requests, referral card.
Missing: pre-expiry warnings, abandoned-checkout follow-up,
upgrade proration, self-serve downgrade/cancel, yearly
cycle, auto-renewal, billing recipients + invoice email,
usage alerts + next-bill preview.

## B1 — Reminders (expiry + abandoned checkout)
New scheduled job type `billing_reminders` (same pattern as
`dunning_reminders`): for ACTIVE/TRIALING subscriptions
ending in 7/3/1 days, notify OWNER/ADMIN in-app AND by
email (email only when a provider is configured — reported
honestly as skipped, never faked); audit-deduped per stage
per period. Abandoned checkouts (initiated > 1h, < 3d) get
one reminder to their creator, audit-deduped per checkout.

## B2 — Proration + scheduled plan change
Upgrade checkout credits the unused part of the current
plan (price × remaining/period, 30-day periods) as a
recorded `prorationMinor` line in the money order. A new
`pendingPlan` on the subscription schedules a downgrade —
or FREE (= cancel) — for the period end: POST/DELETE
billing/schedule-change; the sweep applies it when the
period closes (FREE activates immediately; a paid target
becomes the plan owed at renewal). Direct checkout to a
LOWER plan is refused with a pointer to scheduling.

## B3 — Yearly cycle
Yearly prices join plan prices (defaults = monthly × 10,
operator-overridable like monthly). Checkout takes
`cycle`; PlanCheckout records it; activation extends
+365 days; the subscription remembers its cycle so the
renewal price is right. Billing page gets a মাসিক/বার্ষিক
toggle with the real saving computed from the two prices.

## B4 — bKash auto-renew
Tokenized agreement flow: tenant consents once (agreement
create → redirect → execute), the agreement id is stored
sealed; an `auto_renew` job charges the agreement within
24h of period end and activates only on bKash's Completed
confirmation; failure falls into dunning as today. Cancel
anytime. Built to the documented tokenized API like M39;
live proof needs the platform's real bKash merchant and is
NOT claimed from the sandbox.

## B5 — Billing contacts + invoice delivery
BusinessProfile gains billingEmails (up to 3), billing
address and BIN — edited on the Billing page. Invoices
gain the buyer block; on activation the invoice is emailed
to the owner + billing recipients (audit-recorded; skipped
honestly when no email provider). B1 reminders use the
same recipients.

## B6 — Usage alerts + next-bill preview
getBilling returns a next-invoice preview (plan + cycle
price, credit applied, due date, amount due). The B1 job
also checks seat + AI usage against limits: at 80% and
100% an in-app alert (+ email) goes to OWNER/ADMIN,
deduped per metric/threshold/day.
