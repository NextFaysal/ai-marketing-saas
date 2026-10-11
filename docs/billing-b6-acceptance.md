# Billing Package B6 — Acceptance (Usage Alerts + Next-Bill Preview)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Plan: `docs/billing-package-plan.md`. No schema change.
**The Billing Package (B1–B6) is complete with this milestone.**

## What was built
- **Next-invoice preview** in GET billing: the plan the
  renewal will actually bill (a B2 scheduled change
  retargets it, FREE included), the cycle price from the
  correct book, the account credit that will be applied,
  the resulting due, and the due date — computed from the
  exact inputs checkout uses. The Billing page renders it
  as a "পরের বিল" card, labelled a preview (coupons /
  proration at checkout can change the final number).
- **Usage alerts** in the B1 `billing_reminders` job:
  seats and daily-AI usage are compared with the org's
  effective plan limits; at **80%** and **100%** the
  OWNER/ADMIN members get an in-app notification + email
  (owner + billing recipients), audit-deduped per metric +
  threshold per Asia/Dhaka day
  (`billing.usage_alert_sent`). A usage-check failure is
  reported in the job result (`usageAlertsError`) and
  never fails the reminder run.

## Verification
- API jest: **817 pass** overall (4 new B6: preview math
  with credit; FREE retarget + yearly book; no period →
  null preview; seats 100% + AI 80% alert exactly once,
  re-run silent).
- Full build green.
- **Live proof** (T1 Shop): GET billing returned
  nextInvoice {STARTER, monthly, 150000 − 50000 credit =
  **100000 due**, due in 20 days} exactly. With seats
  filled to 5/5 the real reminders job produced the
  "🚫 টিম সিট এর সীমা শেষ (5/5)" notification + audit;
  a second run added nothing.

## Package wrap-up (B1–B6, all local commits)
B1 reminders `8fab081` · B2 proration + scheduled change
`6323ed5` · B3 yearly `da11fec` · B4 bKash auto-renew
`404deb0` · B5 contacts + invoice email `bede412` · B6
this milestone. Remaining owner-side items: a real
bKash merchant to prove the B4 agreement round-trip
end-to-end, and platform SMTP for production email
delivery (all email paths report honestly without it).
Push waits for the owner's explicit word, as always.
