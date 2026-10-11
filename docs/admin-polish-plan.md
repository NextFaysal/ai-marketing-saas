# Admin Polish Package — Plan (AP1–AP4)

Written 2026-10-11 after a code audit. Four documented
residuals from the Admin Master Plan, closed one by
one with build + tests + live proof and local commits.
(The GitHub push rule is unchanged.)

## Audit findings (verified in code)
- TOTP: `common/totp.ts` is hand-rolled RFC 6238 with
  an `otpauthUrl()` helper; `AuthService.totpEnroll`
  returns {secret, otpauthUrl, note} ONCE — used by
  BOTH the admin console (apps/admin security page)
  and the tenant settings page. No QR anywhere; no
  qrcode library in the repo.
- View-as: a plain 30-minute JWT with a `viewAs`
  claim; the admin service itself documents "Ending
  = discarding the token client-side" as a known
  limitation. TenantGuard already special-cases
  viewAs requests and has Prisma access.
- API keys: `AdminApiKey` stores SHA-256 only;
  `JwtAuthGuard`'s x-admin-api-key branch (admin
  routes only) authenticates as the creator with
  FULL rights — no scopes column, no route check.
- Invoice email: `EmailProvider.send` takes text
  only (nodemailer underneath — html is native);
  the B5 invoice email is text while
  `invoiceHtmlForOrgPayment` already renders a full
  HTML invoice from the same data.

## AP1 — TOTP QR enrolment
- Add the `qrcode` package (apps/api); `totpEnroll`
  also returns `qrDataUrl` (PNG data URL of the
  otpauth URL). The secret is still returned once,
  as today; failure to render a QR never blocks
  enrolment (field absent, manual entry still works).
- Admin security page + tenant settings page render
  the QR image when present, secret stays as the
  manual fallback.

## AP2 — View-as server-side revocation
- New `ViewAsSession` model (migration): adminId,
  targetUserId, organizationId, mode, reason,
  expiresAt, revokedAt. `startViewAs` creates the
  row and embeds its id in the token claim.
- TenantGuard: a view-as request additionally
  requires the session row to exist, be unrevoked
  and unexpired — one indexed read, view-as
  requests only; normal tokens untouched.
- Admin endpoints: list sessions (mine; SUPER sees
  all, with an active flag), revoke by id (mine, or
  any for SUPER) — audited. Admin console: a
  sessions card on the org page / security page
  with a Revoke button.
- Tokens minted before this change carry no session
  id → they stop working at deploy (30-min lifetime;
  stated plainly in the acceptance doc).

## AP3 — Scoped admin API keys
- `AdminApiKey.scopes String[]` (migration). Catalog
  areas mapped from admin route prefixes:
  orgs→tenants, billing+payments→billing,
  referrals→growth, users+security+totp→admins,
  platform-config+system+health+settings+changelog
  +analytics→system. Grants: `area:read`,
  `area:write`, `area:*`, or `*`.
- JwtAuthGuard's api-key branch enforces: read
  methods need :read, mutations need :write; denial
  is a 403 naming the required grant. Keys with an
  empty scope list keep today's full access
  (documented legacy default); new keys choose
  scopes at creation (validated against the
  catalog), listed back in the console.
- The TOTP gate exemption for API keys is unchanged
  (keys never had interactive TOTP).

## AP4 — HTML invoice email
- `EmailProvider.send` gains an optional `html`
  (nodemailer passes it through; text stays as the
  fallback part).
- The B5 invoice email sends the invoice rendered
  as email-safe HTML built from the SAME data
  assembly as the downloadable invoice (one data
  path, two renderings — no divergent numbers),
  with the text version retained. Sends still count
  only on provider confirmation (messageId), as
  everywhere in this codebase.

## Exclusions
No change to TOTP verification, view-as modes or
the 30-minute lifetime, key hashing, or the
invoice's money math. No new auth surface.
