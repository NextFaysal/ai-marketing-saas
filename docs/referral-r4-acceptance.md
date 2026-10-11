# Referral Advanced R4 — Acceptance (Campaign Codes + Milestones)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/referral-advanced-plan.md`.
Schema **113** (migration
`20261010830000_r4_campaigns_milestones`).

## What was built
- **ReferralCampaign**: operator codes (label, optional
  mode/reward/percent/welcome/minimum overrides, maxUses,
  expiry, active). Codes starting `QOS-` are refused —
  that space belongs to user codes. Signup checks
  campaigns FIRST: a live campaign records a referral
  with `referrerUserId: null`, `sourceKind: "campaign"`
  and its terms **locked into a snapshot** on the
  referral, so later edits never rewrite a deal; the use
  counter increments at signup and the cap is enforced
  there (a full/expired/inactive code falls through to
  the user-code path, and signup never breaks).
- **Campaign payouts**: there is no human referrer, so on
  the first payment the JOINING org receives the
  campaign's credit (reward + welcome per the snapshot).
- **Milestones**: config thresholds (e.g. 2 paid
  referrals → ৳300) are checked after each reward; the
  `ReferralMilestoneAward` unique (referrer, threshold)
  row is the exactly-once guarantee; the bonus lands as
  credit + a `milestone_bonus` ledger entry + an audit +
  a 🏆 notification.

## Verification
- API jest: 2 new R4 (campaign snapshot pays the joiner
  20000 + 5000 while the program config says otherwise;
  milestone pays once at the threshold and never again).
- **Live proof**: campaign `EIDBOI` (flat ৳200 + ৳50
  welcome, cap 5) created via the real Admin API; config
  gained milestone {2 → ৳300}. A campaign signup +
  ৳1,500 payment credited the joining org; two user-code
  referrals paid → the milestone award row + 🏆
  notification appeared exactly once.
- Live-caught semantics fix: a campaign naming a flat
  amount but no mode initially inherited the program's
  percent mode (paying ৳300 instead of ৳200). A named
  flat amount now MEANS flat — in the snapshot and
  defensively in the engine — and the re-run credited
  exactly ৳250 (200 + 50), usedCount 2.
