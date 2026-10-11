-- Advertising Accounts AD3: platform-reported account status + timezone.
-- All nullable: accounts whose platform reports no status keep NULL
-- (the UI says the platform did not report one) — never backfilled
-- with a guessed value.
ALTER TABLE "AdAccount" ADD COLUMN "platformStatusRaw" TEXT;
ALTER TABLE "AdAccount" ADD COLUMN "platformStatusBucket" TEXT;
ALTER TABLE "AdAccount" ADD COLUMN "timezone" TEXT;
ALTER TABLE "AdAccount" ADD COLUMN "platformStatusCheckedAt" TIMESTAMP(3);
