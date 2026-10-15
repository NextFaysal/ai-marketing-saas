-- CC19 (Connect Center Advanced): gateway environments.
-- TenantPaymentGateway gains an `environment` column ("live" |
-- "sandbox") so a tenant can keep a SECOND, sandbox credential
-- set for SSLCommerz/bKash next to the live one; the unique key
-- widens from (organizationId, provider) to
-- (organizationId, provider, environment). Every pre-CC19 row
-- becomes "live" — production resolution selects environment =
-- "live" explicitly from CC19 on.
--
-- TenantPaymentTransaction gains the same column so a sandbox
-- test transaction is identifiable forever; the
-- verified-confirmation paths refuse order transitions and
-- wallet credits for sandbox transactions.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after
-- 20261013330000_cc17_labels_groups_access).

-- AlterTable
ALTER TABLE "TenantPaymentGateway" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'live';

-- DropIndex
DROP INDEX "TenantPaymentGateway_organizationId_provider_key";

-- CreateIndex
CREATE UNIQUE INDEX "TenantPaymentGateway_organizationId_provider_environment_key" ON "TenantPaymentGateway"("organizationId", "provider", "environment");

-- AlterTable
ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'live';
