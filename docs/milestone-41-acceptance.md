# Milestone 41 — Admin Phase A5: Growth Ops (Acceptance)

Built 2026-10-10 from `docs/admin-master-plan.md` Phase A5.
Schema 99 models; migration `20261010410000_m41_growth`
(Announcement.audience, User.referralCode, Referral, Feedback,
PlatformCampaign, ChangelogEntry). **This completes the Admin
Master Plan (A1 → A3 → A2 → A4 → A6 → A5).**

## What was built

- **Targeted announcements** — every announcement carries an
  audience: `all`, `trialing`, `past_due`, or `plan_<TIER>`.
  `GET /public/system-status?organizationId=` resolves the
  org's tags from its latest subscription; a targeted match
  beats the global announcement, and anonymous callers only
  ever see `all`. The tenant dashboard passes its org id.
- **Tenant email campaigns** — compose on Admin → Growth,
  audience = all ACTIVE orgs or a targeted tag (OWNER/ADMIN
  members, deduped, 500-recipient safety cap). Sent through the
  REAL EmailProvider: an unconfigured provider refuses the
  campaign up front (nothing recorded, nothing claimed);
  otherwise per-recipient sent/failed counts are recorded on
  the PlatformCampaign row and shown in history.
- **Changelog manager** — entries with version/title/body and a
  published flag; published entries appear at
  `GET /public/changelog` and on the tenant "আপডেটসমূহ" page.
- **Referral program** — per-user codes (`QOS-XXXXXX`, lazily
  allocated, unique). `/register?ref=CODE` records the referral
  at signup (a bad code never blocks registration). When the
  referred org makes its **first** real payment — online
  activation (SSLCommerz/bKash/credit) or an operator-recorded
  manual payment — the referrer's org receives the configured
  credit, exactly once. Program on/off + reward amount are
  operator settings; the tenant billing page shows the link,
  signups and earned credit.
- **Feedback / NPS** — tenants score 0–10 (+ optional comment)
  from the Support page; the admin board computes the real NPS
  (promoters − detractors), average and counts, with recent
  comments per org.
- **Public pricing** — `GET /public/pricing` renders the
  operator's own plan prices/limits/trial days; the web app
  gains a public `/pricing` page fed by it (prices are never
  hard-coded in the page).

## Verification
- **API tests: 414 pass (62 suites)**, incl. 13 new M41 tests:
  targeted-beats-global selection (trial org / other org /
  anonymous), audience validation, campaign refusal with an
  unconfigured provider (and zero rows recorded), empty-audience
  refusal, changelog publish visibility, referral config
  round-trip, the reward landing exactly once (credit 0 →
  50000 → still 50000), no reward while disabled, lazy stable
  codes, signup capture + bad-code tolerance, myReferral stats,
  NPS math (2 promoters / 1 passive / 1 detractor → 25), and
  pricing from defaults. Two cross-suite regressions from the
  payments hook (a missing `count` on older fakes, sync-vs-async
  JWT fake) were fixed with a defensive optional-call pattern.
- Live on the sandbox — the **full referral chain with real
  rows**: admin enabled the program (৳500) → referrer
  registered → code `QOS-J4LE4X` allocated → friend signed up
  WITH the code (signups: 1) → admin recorded the friend org's
  first manual payment → referrer stats { rewarded: 1,
  earnedMinor: 50000 }; a second payment changed nothing.
  Public pricing returned the operator prices (GROWTH 300000);
  changelog create → public list showed it; a tenant feedback
  (9, "ভালো লাগছে") put the NPS board at 100 for that sample;
  targeted `trialing` + global announcements were created and
  the per-org status resolution was verified for a no-
  subscription org (global shown). Admin /growth + /system and
  tenant /pricing + /dashboard/changelog + /register all 200.

## Not claimed / still open
- A campaign against a configured SMTP server has not been run
  (sandbox SMTP egress is blocked — the same standing limit as
  every email feature; the refusal path is proven, delivery
  awaits the owner's server, where Mailpit/SMTP is real).
- Referral credit is billing credit only — it is not cash, not
  withdrawable, and the Wallet remains postponed by policy.
- NPS is a simple all-time aggregate (no per-period cohorts).
