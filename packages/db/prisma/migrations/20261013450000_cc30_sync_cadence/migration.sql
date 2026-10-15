-- CC30 (Connect Center Next, B13): per-connection sync cadence.
--
-- Integration gains `syncIntervalMinutes` (nullable): the
-- minimum minutes between two SCHEDULED syncs of the same kind
-- for this connection (the CC18 leftover — CC18 shipped pause
-- only because the job system is per-org). Null = no cadence,
-- i.e. today's behaviour for every pre-CC30 row. Manual sync
-- triggers ignore the value; syncPaused still wins over it.
-- The gate lives in the scheduled dispatch only
-- (integrations/sync-cadence.ts) and never creates a SyncJob
-- row for a skipped cycle — the skip is the automation job's
-- run result.
--
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked in the full fresh-Postgres run,
-- after 20261013440000_su9_su11_collab_health).

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "syncIntervalMinutes" INTEGER;
