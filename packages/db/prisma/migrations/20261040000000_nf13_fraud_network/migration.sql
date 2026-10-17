-- NF13 (FB5): Platform Fraud Network — privacy is the product.
-- Opt-in is per-org (FraudNetworkSetting, OWNER-only in the
-- service). The shared aggregate FraudNetworkPhoneStat is keyed
-- ONLY by an HMAC-SHA256 phone hash and carries NO org id and
-- NO raw phone — no other fields exist by design.
-- FraudNetworkContribution is the org-side ledger (hash only
-- too): unique per (organizationId, orderId) for exactly-once
-- contribution, indexed on (organizationId, phoneHash) so
-- contributingOrgCount can count DISTINCT orgs per phone.
-- Hand-written to match schema.prisma exactly.

CREATE TABLE "FraudNetworkSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "enabledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudNetworkSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FraudNetworkPhoneStat" (
    "phoneHash" TEXT NOT NULL,
    "contributingOrgCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "returnedFailedCount" INTEGER NOT NULL DEFAULT 0,
    "codRefusalCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudNetworkPhoneStat_pkey" PRIMARY KEY ("phoneHash")
);

CREATE TABLE "FraudNetworkContribution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudNetworkContribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FraudNetworkSetting_organizationId_key" ON "FraudNetworkSetting"("organizationId");

CREATE UNIQUE INDEX "FraudNetworkContribution_organizationId_orderId_key" ON "FraudNetworkContribution"("organizationId", "orderId");
CREATE INDEX "FraudNetworkContribution_organizationId_phoneHash_idx" ON "FraudNetworkContribution"("organizationId", "phoneHash");

ALTER TABLE "FraudNetworkSetting" ADD CONSTRAINT "FraudNetworkSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FraudNetworkContribution" ADD CONSTRAINT "FraudNetworkContribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
