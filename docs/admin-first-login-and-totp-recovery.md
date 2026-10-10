# Admin First Login & TOTP Recovery — Operator Card

Prepared 2026-10-10, after Milestones 25–28 (Admin Console fully delivered).

## The trap to know about

During the M28 live verification, TOTP was ENROLLED on the demo owner
account (`owner@demo.local`, SUPER tier). That means a normal login
with that account now stops at the TOTP challenge: password alone no
longer produces a session. The enrolment secret was issued once,
during the live test — if it was not saved into an authenticator app
at that moment, it cannot be shown again (secrets are stored
AES-256-GCM encrypted and returned exactly once, at enrolment).

This is expected behaviour, not a bug — but it will look like a
lockout the first time you try the demo login.

## Path A — you saved the secret in an authenticator

1. Log in at the admin app (port 3001) or tenant web (port 3000)
   with the demo owner credentials.
2. At the challenge step, enter the current 6-digit code.
3. Done — no reset needed.

## Path B — break-glass reset (secret lost / never saved)

Server-shell access only; there is deliberately no web path for this.

```bash
cd packages/db
DATABASE_URL=<your database url> node scripts/grant-admin.mjs owner@demo.local
```

Run the script with `node` directly — do NOT route it through pnpm
(pnpm passes a literal `--` through and breaks the arguments).

What this does (verified in `packages/db/scripts/grant-admin.mjs`):
- Sets `isSuperAdmin=true`, tier `SUPER`, status `ACTIVE`
- Resets TOTP: `totpEnabled=false`, `totpSecretEncrypted=null`
- Writes an `admin.granted_cli` audit log entry

## Immediately after a reset — re-enrol properly

1. Log in to the admin app (port 3001) with the demo owner account —
   no TOTP challenge now.
2. Open the **Security** page and enrol TOTP again; save the new
   secret into your authenticator app this time. The secret is shown
   exactly once.
3. Until enrolment is confirmed, a SUPER admin can READ everything
   but every mutation is refused (403, two-factor message) — this is
   the M28 mutation gate, working as designed.

## Then finish the one remaining Admin Console check

From `docs/live-verification-checklist.md` §21, the only unchecked
Admin item: verify in a browser — admin login → overview / users /
orgs / billing / security pages with the granted account.

## Notes

- Never paste the TOTP secret or DATABASE_URL into chat.
- The CLI grant is also the documented recovery if ALL admins are
  ever locked out; it is covered in
  `docs/deployment-vps-runbook.md` (Admin Console section).
