-- Milestone 23: Phase K (A/B tests, dayparting, product sets)
ALTER TABLE "CampaignPlan" ADD COLUMN "abGroupId" TEXT;
ALTER TABLE "CampaignPlan" ADD COLUMN "abVariant" TEXT;
ALTER TABLE "CampaignPlan" ADD COLUMN "abMetric" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "daypart" JSONB;
ALTER TABLE "CampaignAdSet" ADD COLUMN "daypartTz" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "daypartState" TEXT;
CREATE TABLE "ProductSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogRecordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "maxPriceMinor" BIGINT,
    "inStockOnly" BOOLEAN NOT NULL DEFAULT true,
    "externalSetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'local',
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductSet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductSet_organizationId_idx" ON "ProductSet"("organizationId");
CREATE INDEX "ProductSet_catalogRecordId_idx" ON "ProductSet"("catalogRecordId");
