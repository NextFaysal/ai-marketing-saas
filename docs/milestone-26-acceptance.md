# Milestone 26 (Admin Console Phase B: Control) — Acceptance

Date: 2026-10-10. Plan: `docs/admin-console-plan.md`. Built under the
owner's standing autonomy grant.

## Delivered

- **Platform settings** (`SystemSetting` store, SUPER-only writes,
  audited): maintenanceMode, signupOpen, supportContact,
  killSwitches, planPrices. Read path is a defensive helper
  (`apps/api/src/common/platform-settings.ts`) — missing table/row
  always means "built-in default", so enforcement never breaks
  tenant traffic or older test fakes.
- **Public status endpoint** `GET /public/system-status` (no auth):
  maintenance flag, signup flag, support contact, and the current
  in-window announcement. Tenant web renders the maintenance notice
  + announcement banner in the dashboard shell and blocks the
  register page when signups are closed; the API also refuses
  registrations server-side while closed.
- **Announcements** CRUD from the admin console (create, activate/
  deactivate, delete — all audited).
- **Per-org limit overrides + plan tiers:** effective limit order is
  admin override → plan (FREE 20 AI/day · 200 broadcast · 2 seats;
  STARTER 50 · 500 · 5; GROWTH 200 · 1000 · 10; AGENCY 1000 · 5000 · 50) → env baseline.
  Enforced in the AI chat daily cap, the broadcast per-send cap,
  and the member invite seat check. Plan prices are
  operator-editable settings (defaults FREE 0 / STARTER ৳1,500 / GROWTH ৳3,000 /
  AGENCY ৳8,000 per month) — configuration, not market claims.
- **Kill switches:** broadcasts paused platform-wide (checked at
  send time with a clear error) and per-org AI disable list
  (checked in the chat service, 403).
- **Feature flags** per org (`OrgFeatureFlag` upsert; known keys:
  dayparting, portfolio, creative_library, order_bot,
  offline_conversions, agency_portfolio).
- **Platform Health board:** integration totals per provider +
  broken list with org names; failed sync jobs with retry (real
  syncProducts/syncOrders through IntegrationsService); scheduled
  jobs across orgs with run-now through AutomationService.runJobNow;
  automation error count (24h).
- **Usage board:** per-org 30-day AI calls + tokens, message
  deliveries, broadcasts, workflow runs, courier shipments, orders.
  AI cost is shown as tokens, never converted to invented money.
- **Support view (metadata-first):** recent orders + conversation
  metadata/counts without bodies; message bodies require a separate
  reason-bearing POST that writes `admin.support_content_access`
  into the audit trail before returning anything.
- **Admin UI:** /settings (platform state, plan prices, kill
  switches, announcements), /health (integrations, failed jobs,
  scheduled jobs with retry/run-now), /usage, and org detail
  additions (limits form, flag toggles, support view).

## Verification

- API tests **313 pass** (9 new Phase B tests: settings validation,
  announcement windowing, flag upsert, limit validation, support
  view body-leak assertion + audited content access, usage
  aggregation, effectiveLimits precedence, signup gate, chat kill
  switch + zero-cap enforcement, seat-limit invite refusal).
- Live: announcement published → visible on the public status
  endpoint without auth; AI daily cap override 0 → real chat send
  refused with HTTP 429 naming the effective limit; settings PATCH
  (after two real DTO/pipe bugs were found and fixed — see below)
  closed signups → live registration refused with 403 → reopened;
  usage + health endpoints returned the demo org's real rows
  (webchat integration connected, honest zeros elsewhere).
- Two live-found bugs fixed during this phase: (1) whitelisted
  ValidationPipe rejected the settings DTO's index signature —
  replaced with explicit validated fields; (2) transformed DTOs
  carry unset fields as `undefined`, which the settings service
  treated as a boolean type error — the service now skips
  `undefined` values.

## Limitations (honest)

- Feature flags are stored and administrable; individual tenant
  features read them where wired (kill switches + limits are
  enforced today) — per-feature flag checks inside every tenant
  page are not all wired yet.
- Health retry covers scheduled jobs and store sync jobs; other job
  kinds surface their errors but have no generic retry.
- The tenant banner is a notice, not a hard maintenance lockout
  (deliberate: the owner must never be locked out of support).
