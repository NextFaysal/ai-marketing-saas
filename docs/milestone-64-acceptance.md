# Milestone 64 — Deploy Smoke & Backup-Restore Verification Kit (Acceptance)

Built 2026-10-11 from `docs/platform-hardening-plan.md`.
**No schema change; no app code change** — one script +
runbook sections.

## What was built
`scripts/deploy-smoke.mjs` (dependency-free Node): nine
checks against a deployment —
1. API `/health`
2. `GET /public/system-status` (signup/maintenance posture)
3. `GET /public/pricing` (operator-settings tiers)
4. Internal jobs/DLQ surface exists AND is guarded
   (403/503 without the secret; **404 = stale build**, called
   out by name)
5. Internal webhook surface, same rule
6. Tenant web app serves HTML
7. Admin console serves HTML
8. Throwaway auth flow: register → login → create org → the
   org is visible to its owner (skipped honestly when signup
   is operator-closed; leaves one clearly-named account,
   documented in the output)
9. Backup manifest comparison (with SMOKE_ADMIN_TOKEN): the
   M42 manifest counts vs current db-growth stats; fails on
   a >10% shortfall per core table (pg_stat slack), reports
   manifest age + who recorded it. The runbook gains the
   restore-drill procedure (restore → ANALYZE → throwaway
   api → smoke must pass).

## Verification (all against the running sandbox stack)
- **Full pass**: 8 PASS + 1 SKIP (no manifest recorded in
  this database — the honest state) + exit 0.
- The first run caught **two real shape mismatches** in my
  own script against the live API (pricing returns
  `{plans: [...]}`, login returns 201) — fixed, proving the
  kit tests reality, not assumptions.
- **Backup check proven both ways**: a planted manifest with
  inflated counts FAILED with the exact shortfall
  ("User: manifest 100024 vs current ≈24"); a truthful
  manifest PASSED. (The planted manifest was removed after.)
- **Dead-deploy proof**: pointed at a dead port the script
  reports 5 failures and exits 1.

## Notes
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
