-- OU12 (One-Umbrella): backup verification record on DataExport
-- (the "OrgBackup" is a DataExport row with kind = 'backup').
-- All additive + nullable; existing exports simply have no
-- verification on record. Verification is a read-only
-- restore-readiness check — NO restore is built, because the
-- export bundle does not round-trip by design (see
-- docs/one-umbrella-ou12-section.md).

ALTER TABLE "DataExport" ADD COLUMN "backupVerifiedAt" TIMESTAMP(3);
ALTER TABLE "DataExport" ADD COLUMN "backupVerification" JSONB;
