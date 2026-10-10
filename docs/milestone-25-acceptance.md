# Milestone 25 (Admin Console Phase A: Foundation & Visibility) — Acceptance

Date: 2026-10-10. Plan: `docs/admin-console-plan.md`. Built under the
owner's standing autonomy grant ("no permission needed — build the
full system basic to advanced").

## Delivered

- **Schema (83 → 88 models)**, migration `20261010250000_m25_admin`
  (one migration carries all four phases' tables):
  `User.status/adminTier/lastLoginAt/tokenVersion/totpSecretEncrypted/totpEnabled`,
  `Organization.status/aiDailyLimitOverride/broadcastCapOverride/seatLimit`,
  new `AdminNote`, `SystemSetting`, `OrgFeatureFlag`, `Announcement`,
  `SaasPayment` models.
- **SuperAdminGuard** (`apps/api/src/common/super-admin.guard.ts`):
  /admin/* requires the LIVE user row to be an active super admin —
  the JWT claim alone is not trusted, so a revoked/suspended admin's
  existing token dies immediately; token version must match (admin
  session revocation); optional `ADMIN_IP_ALLOWLIST` env; tier checks
  via `@AdminTier(...)` (SUPER passes everything).
- **AdminModule** (`apps/api/src/admin/`): overview (real cross-org
  counts: orgs, users, 30-day signups, month orders/revenue excluding
  cancelled/refunded, campaign-level-only tracked ad spend, AI calls
  + tokens, failed jobs 24h, recent admin actions), health (DB ping),
  users list/detail, user status changes (ACTIVE/SUSPENDED/DELETED),
  grant/revoke admin (SUPER-only routes, last-SUPER protection
  counting only genuine SUPER-tier admins, revoke bumps token
  version), force password reset (signed one-time token, 60 min,
  bound to token version — using it revokes all sessions), orgs
  list/detail (members, integration STATUS only, subscription,
  counts), org status changes, global search (users/orgs/orders),
  admin notes, audit trail explorer endpoint.
- **Discipline enforced server-side:** every destructive action
  requires a `reason` (400 without one), self-suspension refused,
  changing another admin's status requires SUPER, every action
  writes `admin.*` entries into the append-only AuditLog with
  before/after + IP.
- **Auth hardening:** suspended users cannot log in (clear message);
  deleted users are indistinguishable from unknown accounts;
  `lastLoginAt` recorded; JWT now carries `tv` (token version);
  admin logins logged as `admin.login`. TenantGuard now refuses
  members of SUSPENDED/DELETED organizations (super admins exempt
  for recovery).
- **CLI grant:** `packages/db/scripts/grant-admin.mjs`
  (`node scripts/grant-admin.mjs <email> [--tier=] [--revoke]`) —
  the only path to the FIRST admin; refuses to revoke the last one.
- **`apps/admin`** (Next.js, port 3001): separate app with its own
  dark operator theme and a SEPARATE token key; login refuses
  non-admin accounts outright. Pages: login (+ TOTP challenge hook
  for Phase D), Command Center overview, Users list + detail
  (status actions, grant/revoke, reset link, notes, audit),
  Organizations list + detail (status actions, counts, members,
  integration status), Audit Trail, Global Search. Later-phase nav
  entries are labeled with their phase.
- **Tenant web:** `/reset-password` page consuming admin-issued
  reset tokens.

## Verification

- Builds: api + web + admin all pass. Tests: **API 304 pass** (12 new
  in `admin.spec.ts`: guard 403s incl. revoked-token and stale-tv,
  tier enforcement, reason requirement, self/last-SUPER protection,
  audit before/after, overview aggregation honesty — ad-level rows
  excluded from spend, cancelled excluded from revenue — one-time
  reset token, suspended-login refusal).
- **A unit test caught a real bug before release:** last-admin
  protection originally counted SUPPORT/FINANCE admins as super
  admins, so the final SUPER could have been revoked; fixed to
  count only genuine SUPER-tier admins.
- Live (sandbox Postgres/API): CLI granted SUPER to the demo owner;
  admin token → overview 200 with honest zeros; tenant token →
  403; suspend without reason → 400; suspend with reason → probe
  user's login refused with the suspension message; probe cleaned
  up via soft-delete; admin app serves /login with HTTP 200.

## Limitations (honest)

- Admin app visual check was HTTP-level (page serves, login gate is
  client-side against the live API verified above); no browser
  screenshot pass on the sandbox tunnel.
- `force-reset` returns a path the admin must prefix with the tenant
  domain — by design, since the API does not know the public web
  origin.
- IP allowlist matches exact IPs (no CIDR ranges) in v1.
