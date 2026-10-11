# Admin Polish AP2 — Acceptance (View-As Revocation)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/admin-polish-plan.md`.

## What was built
- `ViewAsSession` registry (migration
  `20261010970000_ap2_view_as_sessions`): every
  startViewAs creates a row first and embeds its
  id in the token's viewAs claim.
- TenantGuard: a view-as request now requires the
  session row to exist, be unrevoked, unexpired and
  bound to the same org — one indexed read, view-as
  requests only; normal tokens untouched.
- Endpoints: GET /admin/view-as/sessions (mine;
  SUPER sees all, computed `active` flag) and POST
  /admin/view-as/sessions/:id/revoke (owner admin
  or SUPER; audited as view_as_revoked). Admin
  security page lists sessions with a Revoke
  button.

## Compatibility note (stated plainly)
Tokens minted before AP2 carry no sessionId and
are rejected by the guard. Their lifetime was 30
minutes, so the deploy cost is at most one
interrupted half-hour session per admin.

## Verification
- 8 new specs: guard passes a live session and
  refuses revoked / expired / legacy tokens;
  service list flags, owner revoke, foreign-admin
  refusal, SUPER override. Existing guard + admin
  suites green (43/43 in the touched set).
- **Live proof**: SUPER admin (TOTP enrolled via
  the AP1 QR path) started a read view-as →
  the token worked on an org route (200) → revoke
  via the new endpoint → the SAME token immediately
  returned 403 "revoked or has expired", well
  inside its 30 minutes.
- API + admin builds green.
