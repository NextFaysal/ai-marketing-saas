# Milestone 40 — Admin Phase A4: Control & Safety++ (Acceptance)

Built 2026-10-10 from `docs/admin-master-plan.md` Phase A4.
Schema 95 models; migration `20261010400000_m40_control`
(AdminApiKey — SHA-256 hash only, never the key).

## What was built

- **Feature flags enforced end-to-end** (`common/feature-flags.ts`,
  opt-out semantics: no row = ON). Consumers: dayparting jobs
  skip with a recorded reason; the order bot never engages;
  creative uploads refuse with a named message; offline
  conversions skip; the agency portfolio excludes flagged orgs
  (either `agency_portfolio` or the legacy `portfolio` key).
  **Bug found & fixed:** `FlagDto.enabled` had no validation
  decorator, so with `forbidNonWhitelisted` the flag endpoint
  had returned 400 on every call since M26 — flags could be
  read but never set over HTTP. Now covered live (below).
- **Scheduled maintenance windows + hard lockout** — platform
  setting `maintenanceWindow` {startsAt, endsAt, message,
  hardLockout}; `GET /public/system-status` reports active/
  upcoming windows and the tenant banner shows both. With
  hardLockout on, TenantGuard refuses tenant WRITES with 503
  (the window's own message) while reads continue; admin
  routes are unaffected. Guard reads are cached 30s.
- **CIDR admin allowlist** — exact IPs and IPv4 CIDR ranges
  (`common/ip-allowlist.ts`), from env AND the console-managed
  SystemSetting list; the Settings page carries the
  don't-lock-yourself-out warning + the env/CLI recovery note.
- **Admin API keys** — `qosa_…` keys for automation/monitoring:
  created on the Security page, shown ONCE, stored as SHA-256
  only. Sent as `x-admin-api-key`, they authenticate /admin/*
  through JwtAuthGuard → the full SuperAdminGuard chain still
  applies (live user, tier, revocation, allowlist). The key's
  power is its creator's CURRENT tier/status; revoked keys die
  immediately; the TOTP session gate does not apply to keys
  (documented). lastUsedAt is stamped (throttled).
- **Bulk org status** — SUPER-only, ≤50 orgs, per-org results
  with individual errors; orgs list checkboxes + action bar.
- **Login anomaly alerts** — failed logins are audit-logged
  (email only, never the password; same error either way — no
  oracle). Security page lists emails with ≥5 failures in 24h.
- **Tenant data export** — `GET /admin/orgs/:id/export`: the
  org's core data as JSON (BigInt-safe), credential tables
  excluded by construction, integrations as metadata only;
  audited with row counts.
- **Verified permanent deletion** — requires DELETED status +
  the org's exact typed name + a reason. Deletes children by
  parent ids first (messages, items, sync jobs, …), then every
  org-keyed table, then membership/profile/org, and returns a
  **certificate** of exactly what was removed; the certificate
  also lands in a platform-level audit row that survives.
- **Audit retention job** — `audit_retention`: deletes audit
  rows older than `auditRetentionDays` (default 365, min 30)
  EXCEPT `admin.*` actions, kept indefinitely.
- **Regression fix (found while building):** JwtAuthGuard
  dropped the JWT `tv` claim, so SuperAdminGuard compared
  `0` against the live tokenVersion — any admin whose version
  had ever been bumped (revoke/force-reset) would have been
  locked out of /admin permanently after re-login. The claim
  now passes through, with guard-level tests both ways.

## Verification
- **API tests: 395 pass (60 suites)**, incl. 12 new M40 tests:
  CIDR math; flag semantics; the tv regression (matching tv
  passes after a bump, stale tv refused); API-key lifecycle
  (hash-only storage, one-time display, authenticate, revoke
  → dead); window validation + active public status; bulk
  per-org results; anomaly threshold; export credential
  exclusion; deletion gates + certificate + org-scoped audit
  removal; retention preserving admin.* rows.
- Live on the sandbox: API key created → used with no Bearer
  (**200**) → revoked → **401**. Five failed logins →
  anomaly board listed the email (5). Flag disable →
  portfolio orgs 1 → **0** → re-enable → **1**. Maintenance
  hard window: pure-tenant POST → **503** with the window's
  message, GET → 200, after clearing → 201. CIDR: allowlist
  `203.0.113.0/24` → admin from 127.0.0.1 → **403** (cleared
  via DB + restart). Export → permanent deletion of a scratch
  org: wrong name refused; exact name → certificate
  {subscription 1, auditLog 1, membership 1, organization 1};
  org afterwards **404**.
- Sandbox incident #4 hit mid-verification (VM replacement
  wiped /tmp + the Postgres cluster): recovered via the known
  recipe (role/db recreated, migrate deploy, seed, CLI grant,
  TOTP re-enrol). All deliverables live in git; nothing was
  lost but sandbox demo state.

## Not claimed / still open
- IPv6 allowlist entries match exactly only (no IPv6 CIDR).
- The guard allowlist/window caches mean changes take up to
  ~30s to bite — deliberate, and stated in the UI.
- Permanent deletion's child coverage follows the current
  schema; models added later must join the deletion pass
  (the certificate makes omissions visible, not silent).
