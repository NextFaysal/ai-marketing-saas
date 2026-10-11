# Admin Polish AP1 — Acceptance (TOTP QR Enrolment)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/admin-polish-plan.md`.

## What was built
- `qrDataUrlFor()` in common/totp.ts renders an
  otpauth URL as a PNG QR data URL (qrcode package,
  added to apps/api with types). Rendering failure
  returns undefined — enrolment never depends on it.
- BOTH enrolment paths return `qrDataUrl` alongside
  the one-time secret and otpauth URL: the tenant
  AuthService.totpEnroll and the admin console's
  AdminService.totpEnroll. The QR encodes the SAME
  otpauth URL (same secret) — it is a rendering, not
  a second credential.
- Admin security page and tenant settings page show
  the QR image when present; the secret + URL stay
  as the manual fallback.

## Verification
- New spec (2 tests): a real PNG data URL is
  produced, and the secret inside the QR's URL is
  the same secret the hand-rolled TOTP verifies.
  Existing auth/admin suites stay green (35/35 in
  the touched set).
- **Live proof**: POST /auth/totp/enroll returned
  the secret, the otpauth URL containing it, and a
  4,542-char `data:image/png;base64` QR. (The first
  attempt 500'd on a sandbox env defect — a short
  ENCRYPTION_KEY in the recreated /tmp env — fixed
  in the env, not the code.)
- API + web + admin builds green.
