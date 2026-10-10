# Admin Console Plan — SaaS Operator Dashboard (`apps/admin`)

Date: 2026-10-10. Status: DELIVERED — Phases A–D built as Milestones 25–28 under the owner's autonomy grant (see docs/milestone-25..28-acceptance.md). Decisions taken as recommended in §9: manual payments in v1, metadata-first support view with audited content access instead of full impersonation, tiers available from Phase A (SUPER-only use is an operator choice, not a system limit).
Goal from the owner: a third app next to `web` and `api`, named
**admin**, from which the SaaS operator (Qosprey) controls the
WHOLE product — users, organizations, subscriptions, usage,
integrations health, system settings — accessible ONLY to
platform admins, never to tenant users.

## 1. What it is (and is not)

- It is the **vendor/operator console** for the SaaS itself. The
  tenant dashboard (`apps/web`) is what customers use; the admin
  console is what WE use to run the business behind it.
- A separate Next.js app (`apps/admin`, port 3001) in the same
  monorepo, sharing `@repo/ui`, `@repo/contracts` and the same API
  process — but talking ONLY to a new `/admin/*` API surface.
- Recommended production shape: a separate subdomain
  (e.g. `admin.qosprey.com`), never linked from the tenant app,
  optionally IP-restricted at the proxy level.

## 2. Verified foundations (already in the codebase)

- `User.isSuperAdmin` EXISTS (default false) and is already
  carried in the JWT; `TenantGuard` and `RolesGuard` already
  honour it. Nobody has ever been granted it and no UI uses it.
- `Subscription` model EXISTS (plan enum, status TRIALING/...,
  currentPeriodEnd) and `UsageRecord` exists — both created in
  Milestone 1 and never wired to any feature. Billing control
  builds on these instead of new tables where possible.
- `AuditLog.organizationId` is nullable and the table has an
  `ipAddress` column — platform-level admin actions can be logged
  in the same append-only trail with `organizationId = null` and
  action names prefixed `admin.`.
- Monorepo already supports multiple apps (api/web/worker) with
  shared packages, CI and build scripts.

## 3. Access & security model (the heart of this system)

1. **Who is an admin:** a User with `isSuperAdmin = true`. There
   is NO self-service path and NO tenant-facing UI to grant it.
   The first admin is granted only from the server shell:
   `pnpm admin:grant <email>` (a small CLI in packages/db that
   flips the flag + writes an audit row). Later admins can be
   granted by an existing super admin from the console.
2. **Admin tiers** (stored as `User.adminTier`, nullable):
   `SUPER` (everything), `SUPPORT` (view + support actions, no
   billing, no grants, no deletes), `FINANCE` (subscriptions and
   payments only + read). Tier checks live in one guard.
3. **Login gate:** the admin app uses the normal auth API, then
   refuses the session unless the returned user has
   `isSuperAdmin = true` — a tenant credential gets a hard 403
   page, not a redirect loop. Separate storage key/cookie name so
   tenant and admin sessions never mix.
4. **API gate:** every `/admin/*` route sits behind a new
   `SuperAdminGuard` (checks the JWT claim) AND the service layer
   re-checks the LIVE database flag on sensitive actions (a
   revoked admin's old token must die fast — token version /
   flag re-check on mutations).
5. **Every mutation is audited:** admin id, action, target,
   before/after summary, IP, and a REQUIRED free-text `reason`
   for destructive or money-affecting actions (suspend, delete,
   plan change, grant). No reason = request rejected. The audit
   trail is append-only; the console can read but never edit it.
6. **Destructive-action discipline:** two-step confirm in the UI
   (type the target's name/email) + server-side soft-delete with
   a 30-day grace window for organizations and users; hard delete
   is a separate, SUPER-only action after grace.
7. **Impersonation policy (recommended):** "View as" = READ-ONLY
   support view of a tenant org, time-boxed (30 min), banner
   always visible, entered/exited events audited, and tenant
   credentials/integrations are NEVER visible in this mode (they
   are AES-encrypted and never returned by any API today — the
   admin console keeps that invariant: it shows connection
   STATUS and masked identifiers only).
8. **Hardening (Phase D):** TOTP 2FA mandatory for SUPER tier,
   optional IP allowlist via env, admin session list + revoke,
   login-attempt alerts for admin accounts.

## 4. Console modules (what the admin can actually do)

### A. Command Center (home)
Platform KPIs from real tables: total/active organizations, total
users, new signups (7/30d), orders volume across tenants, tracked
ad spend (campaign-level), messages sent, AI usage + estimated
provider cost (from AIUsageRecord), courier bookings. Health
cards: API up, DB up, scheduler last tick, failed jobs 24h,
webhook failures 24h. Recent admin actions feed.

### B. Users
Search/list (email, name, org, status, last login), detail page
(memberships + roles, sessions, audit trail of the user).
Actions: suspend/activate account (suspended = login refused,
data untouched), force password reset (issues a reset flow, never
shows a password), grant/revoke super admin (SUPER only; cannot
revoke the LAST super admin; cannot demote yourself), soft-delete
+ restore within grace, export the user's data summary.

### C. Organizations (tenants)
Search/list with plan, status, member count, usage, created date.
Detail: members, integrations (status only), subscription,
limits, recent audit. Actions: suspend/reactivate the whole org
(members' logins refused, data preserved), change plan, extend
trial, set per-org limits (AI daily cap, broadcast cap, seats —
stored as overrides the tenant API already knows how to read or
gains in this phase), soft-delete + restore, data export
(products/orders/customers JSON/CSV for support/churn).

### D. Subscriptions & SaaS Billing (vendor-side)
Plans built on the existing Subscription model: FREE / PRO /
AGENCY tiers with limits; per-org plan assignment, trial
management, period extension. Manual payment records (bKash /
bank / cash — the BD reality) in a new `SaasPayment` table:
amount, method, reference, recorded-by; MRR + collected revenue
dashboard; overdue list (period ended, no payment) with
suspend-suggestion (never auto-suspend without an admin click in
v1). Online gateway (SSLCommerz) is explicitly a LATER option,
not part of this plan's v1.

### E. Usage & Cost Control
Per-org usage board: AI messages + token cost, SMS/email volume,
broadcasts, workflow runs, courier bookings, storage-ish counts
(products/orders/conversations). Global LLM provider status
(configured or not — never the key), per-org quota overrides,
kill-switches: pause AI for an org, pause broadcasts globally
(incident mode).

### F. Platform Health & Operations
Integration status board across orgs (connected/broken per
provider), sync job failures (SyncJob), webhook failures
(WebhookEvent), scheduler jobs across orgs (ScheduledJob +
AutomationRun errors) with retry buttons that call the EXISTING
services, Meta status-sync backlog, offline-conversion failure
log view. Nothing here re-implements tenant logic — it surfaces
and triggers what exists.

### G. System Settings & Feature Flags
New `SystemSetting` (key/value, audited): signup open/closed,
maintenance mode (tenant app shows a notice; admin app still
works), default AI daily limit, default broadcast cap, support
contact shown in tenant app. New `OrgFeatureFlag`: per-org
on/off for beta modules (e.g. dayparting, portfolio) so features
can roll out per client. Announcement composer: a banner message
shown in every tenant dashboard until a date (stored setting,
rendered by apps/web).

### H. Support Tools
Global search across users/orgs/orders/conversations by id,
phone, email, order number (metadata-first results). Audit
explorer: filter the full AuditLog by org/user/action/date —
including the admin trail. System email to all org OWNERs via
the real SMTP provider (release notes, incident notices) with
per-send recipient counts recorded.

### I. Admin & Security (console self-management)
Admin list + tiers, admin action history, active admin sessions,
security settings status (2FA enrolment per admin, allowlist),
break-glass note: if all admins are locked out, the CLI grant
command is the documented recovery path.

## 5. API surface (new, all under /admin)

- Guard: `SuperAdminGuard` (+ tier guard) on the whole module.
- `GET /admin/overview`, `GET /admin/health`
- `GET /admin/users`, `GET /admin/users/:id`,
  `POST /admin/users/:id/suspend|activate|soft-delete|restore`,
  `POST /admin/users/:id/grant-admin|revoke-admin` (SUPER),
  `POST /admin/users/:id/force-reset`
- `GET /admin/orgs`, `GET /admin/orgs/:id`,
  `POST /admin/orgs/:id/suspend|reactivate|soft-delete|restore`,
  `PATCH /admin/orgs/:id/limits`, `GET /admin/orgs/:id/export`
- `GET/PATCH /admin/orgs/:id/subscription`,
  `GET/POST /admin/payments`, `GET /admin/billing/summary`
- `GET /admin/usage`, `GET /admin/health/integrations`,
  `GET /admin/health/jobs`, `POST /admin/health/jobs/:id/retry`
- `GET/PATCH /admin/settings`, `GET/PATCH /admin/orgs/:id/flags`,
  `POST /admin/announcements`, `POST /admin/broadcast-email`
- `GET /admin/audit`, `GET /admin/search?q=`,
  `POST /admin/orgs/:id/view-as` (read-only token, 30 min)
- Every POST/PATCH above accepts and (for destructive ones)
  REQUIRES `reason`. Pagination: `?page=&take=` everywhere;
  responses never include secrets, hashes, or raw credentials.

## 6. Data model changes (minimal, phased)

- Phase A: `User.status` (ACTIVE|SUSPENDED|DELETED),
  `User.adminTier` (SUPER|SUPPORT|FINANCE, nullable),
  `User.lastLoginAt`, `Organization.status`
  (ACTIVE|SUSPENDED|DELETED), `AdminNote` (internal notes on a
  user/org). Audit via existing AuditLog (`admin.` prefix).
- Phase B: `SystemSetting`, `OrgFeatureFlag`, per-org limit
  override columns on Organization (aiDailyLimitOverride,
  broadcastCapOverride, seatLimit), `Announcement`.
- Phase C: `SaasPayment` (org, amountMinor, method, reference,
  periodStart/End, recordedById, note) + plan tier definitions
  in code (FREE/PRO/AGENCY limits) on the existing Subscription.
- Phase D: `User.totpSecretEncrypted` (AES-GCM like other
  secrets), `AdminSession` if session revocation needs it
  (otherwise JWT denylist by token version on User).

## 7. Delivery phases (each = one milestone, same discipline as before)

- **Phase A (M25) — Foundation & Visibility:** SuperAdminGuard +
  admin audit helper + CLI grant command; `apps/admin` shell
  (login gate, layout, dark ops theme); Command Center; Users
  and Organizations list/detail (read) + suspend/activate with
  reason + audit; global search. Acceptance: a tenant login is
  refused by the admin app; a granted admin sees cross-org data;
  every action lands in the audit trail; tests for the guard
  (tenant 403, revoked admin token rejected on mutations).
- **Phase B (M26) — Control:** user/org lifecycle completion
  (soft-delete/restore, force reset), limits + feature flags +
  system settings + maintenance mode + announcements (tenant app
  renders them), Platform Health board with retry actions,
  Usage board + kill-switches, view-as read-only support mode.
- **Phase C (M27) — SaaS Billing:** plan tiers + limits
  enforcement in the tenant API (e.g. FREE org hits AI cap),
  subscription management, manual payments + MRR dashboard,
  overdue workflow, trial automation via the existing scheduler.
- **Phase D (M28) — Hardening:** TOTP 2FA for admins, IP
  allowlist, admin sessions + revoke, security alerts, export
  tooling polish, load/permission test pass.

## 8. Non-goals & invariants (explicit)

- The admin console NEVER displays tenant integration secrets,
  passwords, or message content by default; support views are
  metadata-first, content access is a separate audited action.
- No silent money movement: plan/payment changes always show
  before/after and require a reason.
- Suspending is reversible and non-destructive; deletion is
  soft-first with grace.
- The tenant app gains NO new permissions from this work; the
  admin surface is additive and separately guarded.
- Consistent with the product's standing rule: the console shows
  only real data from real tables — empty states, never invented
  metrics.

## 9. Decisions needed from the owner

1. Billing in v1: manual payments only (recommended) or must
   SSLCommerz online payment be in Phase C from the start?
2. Impersonation: read-only "view as" (recommended) or full
   login-as for support? (Full login-as is riskier; can be added
   in Phase D with stronger audit.)
3. Admin tiers at launch: SUPER only (simplest, recommended for
   a solo operator) with tiers arriving in Phase B, or all three
   tiers from Phase A?
4. Admin app domain: separate subdomain at deployment time
   (recommended) — no decision needed until deployment.
