# Referral Advanced R3 — Acceptance (Trust & Safety)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/referral-advanced-plan.md`.
No schema change.

## What was built
- **Refund clawback** (`maybeClawbackReferral`, called
  from the admin refund path): a FULL refund of the
  org's FIRST payment — the one that caused a reward —
  debits the referrer's reward and the referee's welcome
  credit, each floored at zero with any shortfall
  recorded in the audit (`referral.clawed_back`). The
  referral becomes `clawed_back` (terminal — it never
  re-pays), both movements land in the ledger as
  `referral_clawback`, and the referrer is notified.
  Partial refunds and non-first payments never claw back.
- **Notifications**: signup via your link (to the
  referrer), reward landed (referrer), welcome credit
  (referee), clawback (referrer) — in-app via
  AgentNotification. The engine sends no email (it has
  no provider); the ledger + audit are the money record.
- **Admin abuse watchlist data**: referralsBoard gains
  per-referrer aggregates (top 20 by signups, with
  conversion), program totals incl. clawedBack count,
  and a `flagged` list by two printed rules —
  ≥10 signups with 0 conversions (`no_conversion`) and
  ≥5 signups in 24h (`signup_spike`). Rendered in R5.

## Verification
- API jest: 3 new R3 (reward notifies both sides;
  clawback reverses both credits + terminal; spent
  credit floors at zero with the shortfall audited;
  non-first payment never claws back).
- **Live proof**: a new signup produced the referrer's
  "🎉 নতুন রেফারেল সাইন আপ" notification. Refunding the
  R1 referee's ৳3,000 payment in full returned
  `referralClawback {clawedBack: true, debitedMinor:
  70000, shortfallMinor: 0}` — T1 Shop ৳1,100 → ৳500
  (the ৳600 reward), Referee Shop ৳100 → ৳0 (the ৳100
  welcome), referral status `clawed_back`, and the
  clawback notification arrived.
- Live-caught fix: the first notification attempt used
  a `link` field AgentNotification does not have —
  Prisma threw inside the defensive catch and only the
  live check exposed it; the field was removed from all
  four notification creates and the proof re-ran green.
