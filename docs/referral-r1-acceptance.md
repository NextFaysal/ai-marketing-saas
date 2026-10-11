# Referral Advanced R1 — Acceptance (Smart Reward Engine)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/referral-advanced-plan.md`.
Schema **111** (migration `20261010820000_r1_referral_engine`
— the timestamp prefix coincides with the CRM track's C5
migration; both applied cleanly).

## What was built
- **Config v2** (`referralConfig`, merged updates): mode
  flat | percent (of the first payment) | per_plan (flat
  is the documented fallback), referee welcome credit,
  minimum first-payment qualification, credit expiry days,
  milestone list (awarded in R4). M41 flat rows keep
  working unchanged (defaults: flat, ৳500).
- **Engine v2**: on the first payment the engine computes
  from the ACTUAL payment (activate passes its full
  value + plan; manual payments pass the recorded
  amount). Below the configured minimum → no reward, the
  referral stays pending, nothing is claimed. Both sides
  are credited; the referral row records rewardMinor,
  refereeBonusMinor and firstPaymentMinor.
- **CreditLedger** (new): referral_reward /
  referral_welcome grants land here with their expiry;
  checkout credit spends are recorded too.
  Organization.creditMinor remains the checkout's source
  of truth; the ledger explains it.

## Verification
- API jest: 6 new R1 (flat parity + ledger, percent math,
  per-plan + fallback, below-minimum stays pending with
  zero credit, two-sided welcome + 90-day expiry stamp,
  M41 config parsing).
- **Live proof** (real Admin API with TOTP login): config
  set to percent 20% + welcome ৳100 + 90-day expiry. A
  referee signed up with the owner's code, and a ৳3,000
  manual payment produced: referrer org 50,000 + **60,000**
  credit, referee org **+10,000** welcome, both ledger
  rows carrying expiries, and the referral row storing
  the full facts (60000 / 10000 / 300000).
