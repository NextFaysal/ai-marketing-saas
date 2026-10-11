# Referral Advanced R2 — Acceptance (Ledger Enforcement + Referral Center)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/referral-advanced-plan.md`.
No schema change (the CreditLedger landed in R1).

## What was built
- **Credit expiry enforcement**: the daily billing job
  now computes expired-unspent credit FIFO over the
  ledger (`computeExpiredUnspent` — spends and earlier
  expiry debits consume the oldest grants first) and
  debits it with a `credit_expired` ledger row, an audit
  (`billing.credit_expired`) and an owner notification.
  Only ledger-tracked credit can expire; pre-R1 balances
  are untracked by design (the balance stays
  authoritative).
- **GET billing/credit-ledger**: the org's last 100
  credit movements + live balance.
- **myReferral v2**: each referral now carries the
  referee's business name + current plan + source kind;
  stats add pending + a real conversion percent; the
  full program terms ship in `config`.
- **Tenant Referral Center** (`/dashboard/referral`,
  nav entry added): hero with code + link + copy buttons
  + WhatsApp/Facebook/Telegram share links, five stat
  cards, milestone progress bars (from the operator's
  config), the referral table (business, plan, status,
  reward), and this workspace's credit-history card with
  Bengali reason labels + expiry dates.

## Verification
- API jest: 4 new R2 (FIFO untouched-expired, spend
  ordering, no double-charge after an expiry debit,
  unexpired safe; job-level: debit + ledger + audit,
  second run debits 0) + B1 specs still green.
- Web build green.
- **Live proof**: GET /auth/referral showed the referee
  as "Referee Shop · FREE · conversion 100% · mode
  percent"; the ledger endpoint returned T1's ৳600
  reward against its ৳1,100 balance. On the referee org,
  an expired ৳100 grant was debited by the real job run
  (balance ৳200 → ৳100) with a `credit_expired` row —
  the unexpired welcome credit was untouched, exactly
  the FIFO order.
