-- EC32 (Affiliate Program): staff-managed affiliate partners,
-- per-order commission entries, and payout BOOKKEEPING records
-- (money moves outside the system; a payout row only documents
-- that the merchant paid the partner by hand). Plus the Order
-- attribution stamps and the StorefrontSetting program config.
-- All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable: order attribution (separate from EC16 referral)
ALTER TABLE "Order" ADD COLUMN "affiliatePartnerId" TEXT;
ALTER TABLE "Order" ADD COLUMN "affiliateCode" TEXT;

-- CreateIndex
CREATE INDEX "Order_organizationId_affiliatePartnerId_idx" ON "Order"("organizationId", "affiliatePartnerId");

-- AlterTable: program config on the storefront settings row
ALTER TABLE "StorefrontSetting" ADD COLUMN "affiliateEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorefrontSetting" ADD COLUMN "affiliateDefaultPercent" INTEGER;
ALTER TABLE "StorefrontSetting" ADD COLUMN "affiliateAttributionDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "AffiliatePartner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "code" TEXT NOT NULL,
    "commissionPercent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliatePartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliatePartner_organizationId_status_idx" ON "AffiliatePartner"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliatePartner_organizationId_code_key" ON "AffiliatePartner"("organizationId", "code");

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "baseMinor" BIGINT NOT NULL,
    "percentSnapshot" INTEGER NOT NULL,
    "commissionMinor" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionEntry_organizationId_partnerId_status_idx" ON "CommissionEntry"("organizationId", "partnerId", "status");

-- CreateIndex
CREATE INDEX "CommissionEntry_organizationId_status_idx" ON "CommissionEntry"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_orderId_key" ON "CommissionEntry"("orderId");

-- CreateTable
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliatePayout_organizationId_partnerId_createdAt_idx" ON "AffiliatePayout"("organizationId", "partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_affiliatePartnerId_fkey" FOREIGN KEY ("affiliatePartnerId") REFERENCES "AffiliatePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePartner" ADD CONSTRAINT "AffiliatePartner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
