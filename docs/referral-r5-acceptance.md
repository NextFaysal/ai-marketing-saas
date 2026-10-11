# Referral Advanced R5 — Acceptance (Admin Growth++)

Status: **DELIVERED** (2026-10-11); admin build green,
API suite **847 pass / 123 suites**. Plan:
`docs/referral-advanced-plan.md`. **The Referral
Advanced package (R1–R5) is complete with this
milestone.**

## What was built
The Admin Growth page's referral card grew into a
full-width program console:
- **Totals**: signups, rewarded, conversion %, total
  credit paid out, clawback count.
- **Config v2 form**: enable, mode (flat / percent /
  per-plan with per-tier taka inputs + the flat fallback
  field), welcome credit, minimum qualifying payment,
  credit expiry days, and a milestone editor (add/remove
  count + bonus rows) — all saved through the R1 merged
  config endpoint, so partial edits never wipe fields.
- **Top referrers** (from the R3 aggregates) and the
  **abuse watchlist** with its two rules printed on the
  card ("সংকেত মাত্র, প্রমাণ নয়"); recent referrals now
  label campaign rows and clawed-back rows.
- **Campaigns panel**: create (code, label, flat reward,
  welcome, max uses, expiry date) + list with live state,
  usage counts and an active toggle — wired to the R4
  endpoints. The page layout moved Changelog beside the
  email campaign card; Feedback/NPS is unchanged.

## Verification
- Admin `next build` green; API jest **847/847**
  (the M41 config round-trip spec was updated to the
  v2 shape — the flat pair it guards is unchanged).
- The endpoints the UI drives were live-proven in
  R1–R4 (config PATCH with TOTP admin, campaign create,
  board aggregates); the page itself is verified by
  build, per the standing no-pixel-QA note for admin
  design work.

## Package wrap-up (R1–R5, all local commits)
R1 smart engine `6158cd3` · R2 ledger + Referral Center
`91538dc` · R3 clawback + notifications `05f9e2f` ·
R4 campaigns + milestones `5c6159a` · R5 this milestone.
The program is now two-sided, plan-aware, qualified,
expiring, reversible on refund, campaign-capable and
milestone-driven — with every credit movement in the
ledger. Push waits for the owner's explicit word.
