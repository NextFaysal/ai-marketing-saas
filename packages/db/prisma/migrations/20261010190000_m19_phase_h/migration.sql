-- Milestone 19: Phase H (creative library, audiences, catalog, formats)
ALTER TABLE "CampaignPlan" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CampaignAd" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'link';
ALTER TABLE "CampaignAd" ADD COLUMN "imageAssetId" TEXT;
ALTER TABLE "CampaignAd" ADD COLUMN "videoAssetId" TEXT;
ALTER TABLE "CampaignAd" ADD COLUMN "carouselCards" JSONB;

CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "adAccountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL, "name" TEXT NOT NULL, "sourceUrl" TEXT NOT NULL,
    "externalHash" TEXT, "externalVideoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending', "error" TEXT,
    "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreativeAsset_organizationId_adAccountId_idx" ON "CreativeAsset"("organizationId","adAccountId");

CREATE TABLE "AudienceRecord" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "adAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL, "kind" TEXT NOT NULL, "source" TEXT NOT NULL, "sourceDetail" TEXT,
    "externalAudienceId" TEXT, "approximateCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'building', "error" TEXT, "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AudienceRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AudienceRecord_organizationId_adAccountId_idx" ON "AudienceRecord"("organizationId","adAccountId");

CREATE TABLE "SavedAudience" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "targeting" JSONB NOT NULL, "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedAudience_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SavedAudience_organizationId_idx" ON "SavedAudience"("organizationId");

CREATE TABLE "CatalogRecord" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "externalCatalogId" TEXT NOT NULL, "businessId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected', "lastSyncAt" TIMESTAMP(3), "lastSyncSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CatalogRecord_organizationId_idx" ON "CatalogRecord"("organizationId");
