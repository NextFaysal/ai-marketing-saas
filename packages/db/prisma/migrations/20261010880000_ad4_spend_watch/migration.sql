-- AD4: per-account spend watchdog settings (alerting only — no
-- enforcement; dailyCapMinor is an alert threshold in the account's own
-- currency minor units, anomalyPct is the % above the trailing complete-
-- day average at which an anomaly alert fires; null = that alert is off).
ALTER TABLE "AdAccount" ADD COLUMN "spendWatchEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdAccount" ADD COLUMN "dailyCapMinor" BIGINT;
ALTER TABLE "AdAccount" ADD COLUMN "anomalyPct" INTEGER;
