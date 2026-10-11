# Referral Program — Advanced Plan (R1–R5)

Owner directive 2026-10-11: make the Referral Program
"আরো advance and powerful". Local commits only.

## Audit baseline (M41, verified in code)
Per-user code (QOS-XXXXXX); signup records a Referral
(pending); the FIRST payment (online activation or an
operator-recorded manual payment) pays a FLAT configured
credit (default ৳500) to the referrer's org, exactly once;
self-referral blocked; admin board (last 200) + config
(enabled, rewardMinor); tenant surface = GET /auth/referral
+ a billing-page card.
Gaps: flat reward regardless of plan or payment size; the
referee gets nothing; NO minimum-payment qualification (a
tiny manual payment can trigger the full reward); no
refund clawback; no credit ledger or expiry; no signup /
reward notifications; no campaign or influencer codes; no
milestones; no dedicated tenant referral page; admin has
no funnel, top-referrer, or abuse view.

## R1 — Smart Reward Engine
referralConfig v2 (backward compatible): mode
flat | percent (of the first payment) | per_plan amounts;
referee welcome credit on their first payment (two-sided);
minFirstPaymentMinor qualification; credit expiry days.
maybeRewardReferral v2 computes from the actual first
payment (amount + plan), pays referrer + referee, and
records everything. Admin config form + validation.

## R2 — Credit Ledger + Referral Center
New CreditLedger (org, delta, reason, referral link,
expiresAt): rewards, welcome, milestone bonuses, checkout
credit spends, clawbacks, expiries — org.creditMinor
stays the checkout's source of truth; the ledger explains
it. A daily step in the billing job debits
expired-unspent credit (FIFO over grants). Tenant
Referral Center page: share kit (WhatsApp/Facebook/
Telegram links), funnel (signups → paid → conversion),
referral list with the referee's org + plan, milestone
progress, credit history.

## R3 — Trust & Safety
Refund clawback: refunding the payment that triggered a
reward reverses it (debit the referrer's credit, floor 0,
shortfall audited; status → clawed_back; ledger entry;
referrer notified). Notifications: signup via your link
and reward-landed (in-app; email for rewards). Admin
abuse view: referrers with many signups and zero
conversions, spike list — honest aggregates only.

## R4 — Campaign Codes + Milestones
CampaignCode (label, custom reward terms, max uses,
expiry, active): signup accepts campaign codes alongside
user codes; the referral records its source and is paid
on the campaign's terms. Milestones: at configured paid-
referral counts (e.g. 5 / 10 / 25) the referrer earns a
bonus credit — awarded once per threshold, in
maybeRewardReferral, ledger + notification.

## R5 — Admin Growth++
Referrals board v2: program funnel + totals (credit
issued, conversion), top referrers, campaign CRUD,
config v2 form, abuse list. Tenant Referral Center
polish + nav entry.
