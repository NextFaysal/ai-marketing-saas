# Billing Package B1 — Acceptance (Reminders)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Plan: `docs/billing-package-plan.md`.

## What was built
- New scheduled job type **`billing_reminders`** (Automations
  page, org target), following the `dunning_reminders`
  pattern:
  - **Pre-expiry**: an ACTIVE/TRIALING subscription ending
    in 7/3/1 days triggers that stage's reminder ONCE per
    period — in-app notifications to OWNER/ADMIN members
    plus email to them and the profile's billing recipients
    (the B5 field, already honoured). The audit log
    (`billing.expiry_reminder_sent`, stage + periodEnd) is
    the dedupe record, exactly like dunning.
  - **Abandoned checkout**: a PlanCheckout left `initiated`
    for 1 hour – 3 days reminds its creator once
    (`billing.checkout_reminder_sent` per checkout).
  - **Honest email accounting**: the job reports
    emailsSent / emailStatus (attempted | no_provider |
    provider_error). In-app notifications are the reliable
    channel; a missing or failing mail provider never
    blocks them and is never reported as a send.

## Verification
- API jest: **737 pass** overall (2 new B1: stage fires
  once with the right recipients incl. the billing inbox,
  re-run is a no-op; no-provider run still notifies and
  reports no_provider).
- Full monorepo build green.
- **Live proof** (T1 Shop, real job via Automations API):
  a STARTER subscription ending in ~2 days and a checkout
  left initiated 2h produced BOTH notifications
  ("⏳ সাবস্ক্রিপশনের মেয়াদ … বাকি", "💳 অসম্পূর্ণ
  পেমেন্ট") and BOTH audit rows; a second run added
  nothing (dedupe verified in the DB).
- Fixture note (not an app bug): a hand-inserted checkout
  row carried a wall-clock timestamp from psql; Prisma
  reads the column as UTC, so the row looked "from the
  future" until the fixture was written with
  `timezone('UTC', now())`. Real checkouts are written by
  Prisma and are unaffected.
