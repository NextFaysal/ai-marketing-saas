-- AD5: per-account sync switch. When true, every platform-data sync
-- path for the account (manual insights/breakdown/status sync + the
-- scheduled insights jobs) refuses/skips. Publishing is unaffected.
ALTER TABLE "AdAccount" ADD COLUMN "syncDisabled" BOOLEAN NOT NULL DEFAULT false;
