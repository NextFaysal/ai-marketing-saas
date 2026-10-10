# Milestone 34 Acceptance — Phase N1 (1/3): Tenant Billing Page + Email Invitations

Delivered 2026-10-10 under the owner's Phase N1 direction and
the same day's batching rule: local commits only — the GitHub
push happens ONCE when Phase N1 is complete, so the live
Dokploy site does not rebuild per fix.

## Schema (89 models, migration 20261010340000_m34_n1_billing_invites)
- New model **MemberInvitation** {organizationId, email, role,
  tokenHash @unique (SHA-256 of the raw token — the raw token
  exists only in the emailed/copied link), status
  pending|accepted|revoked, invitedById, expiresAt (7 days),
  acceptedAt, acceptedUserId, emailSent}.

## Tenant billing (API + page)
- GET organizations/:id/billing (OWNER/ADMIN): latest
  subscription (plan, status, period end, operator-set price),
  effective limits (override -> plan -> env baseline), usage
  from real counts (active seats, AI calls today, broadcasts
  30d), the full plan catalogue with prices + limits, and the
  org's SaasPayment history (amounts as strings).
- POST organizations/:id/billing/plan-request (OWNER/ADMIN):
  validates the tier against PLAN_TIERS, refuses requesting the
  current plan, and records the request as an AdminNote on the
  organization + an `org.plan_change_requested` audit entry —
  the operator applies it in the Admin Console. (Self-serve
  payment arrives in M36/SSLCommerz; nothing here pretends a
  payment happened.)
- Web: /dashboard/billing replaces the never-ready "Wallet &
  Billing" nav placeholder (labelled সাবস্ক্রিপশন ও বিলিং —
  subscription billing, NOT the postponed tenant wallet).

## Email invitations (API + pages)
- POST organizations/:id/members/email-invite (OWNER/ADMIN):
  invitable roles only; conflict when already a member or a
  live pending invitation exists; seat guard counts ACTIVE
  memberships + live pending invitations; the invitation email
  is sent through the real EmailProvider (dynamic SMTP) and
  emailSent is set ONLY when the provider returns a message
  id; the response returns the shareable link ONCE to the
  inviting admin for manual sharing when email is unavailable.
- GET/DELETE/POST .../members/invitations[/:id[/resend]]:
  list with computed status (expired derived from expiresAt),
  revoke, and resend (rotates the token — the old link dies —
  and extends 7 days).
- Acceptance (InvitationsController, JWT-authenticated, NO
  TenantGuard — the invitee is not a member yet):
  GET /invitations/:token shows org/role/status and whether
  the signed-in email matches; POST /invitations/accept binds
  strictly to the invited email (403 otherwise), refuses
  revoked/expired/used tokens, re-checks seats, creates the
  ACTIVE membership, and closes the invitation. An
  already-member accept closes the invitation cleanly.
- Web: /dashboard/team is now a real page (it was a Milestone-1
  placeholder): members table, direct invite (existing
  accounts, unchanged M1 behaviour), email-invite form with
  the returned link + honest emailSent messaging, and the
  invitations table with resend/revoke. /accept-invite handles
  signed-out (login/register first, then reopen the link),
  wrong-account, expired and happy paths.

## Live-found bug, fixed + regression-tested
The first sandbox E2E caught what the unit tests missed: on
the 2-seat FREE plan, accepting an invitation ALWAYS failed —
the accept-time seat guard counted the very invitation being
accepted as occupying a seat. The guard now excludes the
accepting invitation (it converts into the membership). A
spec named "REGRESSION (live-found)" locks the behaviour, and
the same E2E re-run proves the accept succeeds end to end.

## Verification
- API tests: 348 pass (53 suites; +8 in
  organizations/n1.spec.ts — billing assembly, plan-request
  note/audit/refusals, token-hash-only storage, duplicate and
  member conflicts, seat counting, email-bound accept,
  expiry/revoke/resend rotation, the FREE-plan regression).
- pnpm -r build green (a nav `phase` type error from removing
  the last not-ready nav item was fixed in the dashboard
  layout with a safe fallback).
- Sandbox E2E over HTTP: register -> create org -> billing
  (FREE, price 0, 4 plans, 0 payments) -> plan-request FREE
  refused 400 / GROWTH recorded -> email invite (emailSent
  false, SMTP unconfigured — honest) -> duplicate 409 ->
  invitee registers -> view (email matches) -> accept 201 ->
  members list shows the new SUPPORT_AGENT -> invitations
  list shows "accepted". /accept-invite serves 200.

## Remaining in Phase N1
- M35: tenant-user MFA enrolment UI + onboarding wizard +
  trial lifecycle UX.
- M36: SSLCommerz subscription payments (design + sandbox;
  live needs the owner's merchant account).
Then ONE batched GitHub push for the whole phase.
