# Milestone 35 Acceptance — Phase N1 (2/3): Tenant MFA, Onboarding, Trial UX

Delivered 2026-10-10. Local commit only — the Phase N1 batch
push happens once, when the phase completes (owner's rule).

## Tenant-user MFA (TOTP enrolment for everyone)
- Since M28 the login challenge flow worked for ANY user, but
  only admins could enrol. AuthService now exposes the same
  lifecycle to every signed-in user, mirroring the admin
  implementation exactly (secret AES-GCM encrypted, returned
  ONCE at enrolment, OFF until a real code confirms):
  GET /auth/totp/status, POST /auth/totp/enroll,
  POST /auth/totp/confirm {code}, POST /auth/totp/disable
  {code} — audited as auth.totp_enroll_started /
  auth.totp_enabled / auth.totp_disabled.
- Recovery: POST organizations/:id/members/:userId/totp-reset
  (org OWNER only) clears a member's TOTP after lockout;
  audited (org.member_totp_reset); refuses non-members (404)
  and members without TOTP (400).
- Web: the Settings page (a Milestone-1 placeholder until
  now) carries the enrolment card (secret + otpauth URL as
  text — no QR dependency, same as Admin), and the Team page
  has a per-member "2FA রিসেট" button (server enforces
  OWNER).
- **Critical fix shipped with it:** the TENANT login page did
  not handle the `requiresTotp` response at all — a tenant
  user who enabled 2FA would have been locked out of the web
  app. The login page now has the inline code step
  (challenge -> POST /auth/totp/verify -> token). Live-proven
  end to end: enrol -> Python-computed code confirms ->
  login returns a challenge with NO access token -> wrong
  code 401 -> correct code issues the session.

## Onboarding wizard
- GET organizations/:id/onboarding computes a 7-step
  checklist from REAL rows only (profile has content / a
  store exists / products exist / an integration exists /
  an ad account exists / more than one active member / a
  campaign plan exists) with deep links per step.
- Web: a checklist card on the dashboard Overview, hidden
  automatically when all steps are done. Live check on a
  fresh org: 0/7 with every step false — no invented
  progress.

## Trial lifecycle UX
- Dashboard layout gains a SubscriptionBanner (OWNER/ADMIN
  see it; members simply see nothing): PAST_DUE -> red
  read-only notice; TRIALING with <= 7 days left -> amber
  days-left notice with a Billing link.
- The grace is ENFORCED, not just displayed: TenantGuard now
  refuses non-GET requests for organizations whose latest
  subscription is PAST_DUE (403 with a plain explanation),
  while reads and the billing plan-request route stay open.
  Super admins are exempt (support), the check is defensive
  (missing table/row never blocks), and background/system
  jobs are unaffected (they call services, not HTTP).

## Verification
- API tests: 354 pass (55 suites; +6 in auth/m35.spec.ts and
  organizations/n1-m35.spec.ts — enrol/confirm/disable with
  real TOTP codes, secret never stored in plaintext,
  onboarding from real rows, reset rules, the guard's
  block/read/billing matrix and ACTIVE/TRIALING pass-through).
- pnpm -r build green.
- Sandbox HTTP E2E as described above, including the
  PAST_DUE matrix: write -> 403, read -> 200, plan-request
  -> 201 (after flipping the test org's subscription in the
  database).

## Remaining in Phase N1
- M36: SSLCommerz subscription payments (design-first, IPN-
  validated activation; live mode needs the owner's merchant
  store id/password). Then ONE batched GitHub push.
