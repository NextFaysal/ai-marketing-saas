# Milestone 38 — Admin Phase A2: Support++ (Acceptance)

Built 2026-10-10 from `docs/admin-master-plan.md` Phase A2.
Schema 94 models; migration `20261010380000_m38_support`
(SupportTicket + SupportTicketMessage).

## What was built

- **View-As (impersonation), defensively designed** —
  `POST /admin/orgs/:id/view-as` (SUPER/SUPPORT; reason
  mandatory, audited as `admin.view_as_started`). Issues a
  **30-minute** JWT for a REAL member of the org (OWNER
  preferred) with a signed `viewAs` claim {adminId, orgId,
  mode}; the token's `isSuperAdmin` is always false.
  TenantGuard enforces: org binding (any other org → 403) and
  **read-only mode** (any non-GET → 403 with an explanatory
  message). Write mode is a separate opt-in that additionally
  requires the SUPER tier server-side. Tenant web: `/view-as`
  landing (validates the claim + expiry client-side, cleans
  the URL) and a persistent amber banner in the dashboard
  naming the admin + mode, with an end-session button.
  Ending = discarding the token; there is no server-side
  revocation list (documented limitation — 30-minute expiry
  is the bound). Edge case, stated plainly: impersonating an
  org whose owner is themselves a platform admin still yields
  a tenant token (isSuperAdmin false), but that user's own
  admin credentials are a separate login.
- **Support tickets** — tenants open/reply/close/reopen from
  `/dashboard/support`; the platform queue lives at admin
  `/tickets` (status filters, assign to an admin from the
  security roster, priority, status). Admin replies notify
  OWNER/ADMIN members by email through the real EmailProvider
  and report `emailSent`/`emailError` honestly — a failed
  notification never fails the reply. Statuses:
  open → pending (on admin reply) → resolved/closed; a tenant
  reply to a resolved/closed ticket reopens it. Both sides are
  audit-logged (`admin.ticket_replied`, `admin.ticket_updated`).
- **Org 360 timeline** — `GET /admin/orgs/:id/timeline360`
  extends the A1 history with orders, conversations, sync
  jobs and tickets; the org detail page renders it with
  per-kind icons.
- **Proactive alerts** — `GET /admin/alerts` computed at read
  time from real rows: integrations in ERROR (with their own
  lastError), integrations with ≥2 failed syncs in 24h,
  PAST_DUE subscriptions, trials ending within 3 days.
  Admin `/alerts` page with one-click **nudge** emails
  (`POST /admin/alerts/nudge`): the text is composed
  server-side from the org's real state (including the exact
  missing onboarding steps); sends count only on provider
  confirmation; audited as `admin.alert_nudged`.
- **Onboarding funnel board** — `GET /admin/onboarding-board`
  per-org 7-step truth (same steps as the tenant checklist),
  rendered on the Analytics page with progress + the step each
  org is stuck on.

## Verification
- **API tests: 383 pass (59 suites)**, incl. 8 new M38 tests:
  full ticket lifecycle incl. cross-org refusal + honest email
  failure + reopen semantics; view-as token claims (30m, org
  bound, never super admin) + SUPER-only write + mandatory
  reason; TenantGuard view-as enforcement (GET passes, POST
  refused in read mode, other org refused, write mode passes);
  timeline merge; alerts from seeded ERROR integration +
  PAST_DUE subscription; onboarding per-step truth; nudge
  reaching the (unconfigured) mailer.
- Live on the sandbox: tenant created a ticket → admin queue
  showed it with the org name → admin reply saved with
  `emailSent: 0` + the real "Email is not configured" error →
  status pending with 2 messages. View-As live matrix: token
  issued for the OWNER → GET products **200**, POST product
  **403** with the read-only message, other org **403**;
  write mode issued for the SUPER admin. timeline360 returned
  audit/payment/subscription/ticket kinds from real rows;
  alerts [] (nothing broken — honest); onboarding board showed
  the demo org at 1/7 stuck on "স্টোর কানেক্ট". Admin
  /tickets + /alerts and tenant /view-as + /dashboard/support
  all serve 200.

## Not claimed / still open
- Ticket email notifications need a configured SMTP (M33) to
  actually deliver — until then they report the config error.
- View-As has no server-side session list/revocation (A4 can
  add one if the operator wants it); sessions expire in
  30 minutes by design.
