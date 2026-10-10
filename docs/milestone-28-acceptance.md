# Milestone 28 (Admin Console Phase D: Hardening) — Acceptance

Date: 2026-10-10. Plan: `docs/admin-console-plan.md`. Built under the
owner's standing autonomy grant. **With this milestone the Admin
Console plan (Phases A–D, Milestones 25–28) is fully delivered.**

## Delivered

- **TOTP two-factor authentication** (`apps/api/src/common/totp.ts`):
  RFC 4226/6238 HMAC-SHA1 implemented on node:crypto (no new
  dependency), base32 secrets, ±1-step drift window, constant-time
  comparison. Secrets are stored AES-256-GCM encrypted
  (`User.totpSecretEncrypted`) and are returned exactly once — to
  their owner, at enrolment, for authenticator setup.
- **Login challenge flow:** when TOTP is on, a correct password
  returns `{ requiresTotp, challengeToken }` (5-minute signed
  token bound to the user's token version) and NO access token;
  `POST /auth/totp/verify` exchanges challenge + 6-digit code for
  the real session. Wrong codes, expired challenges, and version
  mismatches are all refused. Works for any user, not just admins.
- **SUPER mutation gate (in SuperAdminGuard):** a SUPER admin
  without TOTP can read everything and can use the enrolment
  endpoints, but every other mutation is refused with a clear
  message until two-factor is enabled. The gate reads the LIVE
  user row, so enrolment takes effect immediately.
- **Enrolment lifecycle:** enroll → confirm (code required) →
  disable (code required), each step audited (`admin.totp_*`).
- **Session revocation:** `POST /admin/security/revoke-my-sessions`
  and `POST /admin/users/:id/revoke-sessions` bump the target's
  token version; old tokens die at the SuperAdminGuard (admin
  surface) and reset/challenge flows re-check versions.
  (Tenant-surface tokens remain valid until natural expiry —
  stated honestly; tenant routes never accepted admin powers.)
- **Security overview** (`GET /admin/security` + /security page):
  every platform admin with tier, status, 2FA state and last
  login; IP allowlist state (`ADMIN_IP_ALLOWLIST`, exact-IP match
  in the guard, shipped in Phase A and surfaced here); the
  break-glass note.
- **Break-glass recovery:** the CLI grant now also RESETS TOTP —
  if every admin is locked out, server-shell access restores a
  known admin, and the action lands in the audit trail.
- **Admin UI:** /security page (enrolment flow with one-time
  secret display, disable, revoke-my-sessions, admin roster) and
  the /login/totp challenge page wired into the Phase A login
  (which already branched on a pending challenge); a
  revoke-sessions action on the user detail page.

## Verification

- API tests **323 pass** (5 new Phase D tests: RFC 6238 test
  vectors — HOTP counters 1 and 37037036 reproduce the published
  8-digit vectors truncated to 6 — drift window, malformed codes;
  challenge login flow end-to-end at the service level; enrol /
  confirm / disable lifecycle; the guard's SUPER-without-TOTP
  mutation gate incl. the enrolment exemption; session revocation
  killing old admin tokens at the guard).
- **Live, full lifecycle against the real API:** demo owner (SUPER,
  no TOTP) → settings mutation refused 403 with the two-factor
  message → enrolment issued a secret → confirmation with a code
  computed independently in Python (RFC algorithm) succeeded →
  the same mutation then succeeded → fresh login returned a
  challenge and NO access token → verification with a fresh code
  issued the token → a wrong code got 401.

## Limitations (honest)

- The enrolment UI shows the secret + otpauth URL as text for
  manual authenticator entry; no QR rendering (no dependency was
  added for it) — every mainstream authenticator accepts manual
  entry.
- IP allowlist matching is exact-IP only (no CIDR ranges).
- Session revocation is version-based on the admin surface;
  tenant JWTs are stateless until expiry (24h token lifetime),
  which is documented product behaviour, not an admin backdoor.
