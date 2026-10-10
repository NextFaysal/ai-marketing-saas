# Milestone 42 — Admin Phase A6: Reliability Panel (Acceptance)

Built 2026-10-10 from `docs/admin-master-plan.md` Phase A6.
**No schema change** — the panel reads the tables and catalogs
that already record the platform's real state.

## What was built (`/admin/system/*` + the /system console page)

- **Version & deploy panel** — app version + git SHA from env
  (`APP_VERSION` / `GIT_SHA`, which the deploy platform can
  inject), Node version, boot time + uptime, DB reachability
  with a live latency probe, and migration state read from
  `_prisma_migrations` itself (applied count + latest + recent
  names) — never from a config claim.
- **Queue monitor** — the queues this system actually has:
  scheduled jobs (total / enabled / due now / recently failed
  with their own lastError), store syncs (running + failures),
  message deliveries (24h totals, failed, pending), workflow
  runs (running + latest errors).
- **Error summary** — 24h (configurable to 168h) failure counts
  with the latest examples across automation runs, sync jobs,
  webhook events (rows carrying an error), message deliveries
  and workflow runs.
- **Activity log viewer** — the audit trail with an action-text
  filter. The page states plainly that process stdout is not
  reachable from inside the app; the audit trail is the
  in-product log of record.
- **Database growth** — real Postgres catalog stats
  (`pg_stat_user_tables`: approx rows + exact on-disk bytes per
  table, top 40) with a delegate-count fallback that labels
  itself when the catalog is unavailable.
- **Backup status** — two honest halves: (a) an operator-
  recorded external-backup entry (when, where, note — the app
  cannot see Dokploy/infra backups and does not pretend to);
  (b) a one-click **integrity manifest**: live row counts
  across 15 core tables, stored with verifier + timestamp, so
  a restore can be checked against a known-good snapshot.

## Verification
- **API tests: 401 pass (61 suites)**, incl. 6 new M42 tests:
  version facts with an honest null migration block off-
  Postgres; queue aggregation incl. due-now + failed jobs;
  error counting across all five sources (webhooks included);
  log ordering + action filter; growth fallback labelling;
  manifest counts + persistence + panel read-back.
- Live on the sandbox (real Postgres): version endpoint
  reported **31 migrations applied, latest
  `20261010400000_m40_control`**, DB latency 2ms; db-growth
  came from `pg_stat_user_tables` (40 tables, byte sizes);
  backup-verify produced a manifest (13 rows / 15 tables on
  the fresh seed DB); the audit log's newest row was the
  backup verification itself; queues/errors returned honest
  zeros. Admin /system, /security and /settings all serve 200
  on the new build.

## Not claimed / still open
- Setting GIT_SHA / APP_VERSION in Dokploy is an operator
  step (the panel degrades gracefully without them).
- The manifest verifies presence/counts, not business-level
  consistency of a restored backup — a full restore drill
  remains an ops exercise (N3 territory).
- BullMQ worker processors remain placeholders (post-launch
  N3); this panel monitors the in-API scheduler, which is what
  actually runs jobs today.
