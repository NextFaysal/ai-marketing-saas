-- CC2 (Connect Center, multi-account hardening): tenant-picked
-- default connection flag on Integration. Additive only — every
-- existing row defaults to false, so no connection silently
-- becomes "the default" at deploy.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013200000_ec15_reviews).

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
