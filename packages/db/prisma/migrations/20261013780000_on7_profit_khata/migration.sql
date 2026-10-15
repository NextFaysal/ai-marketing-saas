-- ON7 (Profit Khata): staff-set per-customer credit limit
-- (minor units; NULL = no credit limit configured). Additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "creditLimitMinor" BIGINT;
