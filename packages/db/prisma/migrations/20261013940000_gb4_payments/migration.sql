-- GB4 (GC12 Payment Ops): merchant gateway fee columns on
-- TenantPaymentGateway (feeBps / feeFixedMinor — plain columns,
-- NOT part of the sealed credentials) and payment-attempt
-- bookkeeping columns on TenantPaymentTransaction
-- (failureReason / feeMinor / netMinor). TenantPaymentTransaction
-- already IS the first-class payment-attempt record — these
-- columns extend it in place; no parallel attempt table.
-- All additive and nullable: existing rows keep null fee fields
-- (no fee rate is ever invented for them).
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "TenantPaymentGateway" ADD COLUMN "feeBps" INTEGER,
ADD COLUMN "feeFixedMinor" BIGINT;

-- AlterTable
ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "failureReason" TEXT,
ADD COLUMN "feeMinor" BIGINT,
ADD COLUMN "netMinor" BIGINT;
