-- Campaign Builder Advanced CA27 (CB6): per-ad version
-- snapshots (before-image on content-changing edits;
-- restore appends, never rewrites).
CREATE TABLE "CampaignAdVersion" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'edit',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAdVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignAdVersion_adId_idx" ON "CampaignAdVersion"("adId");
CREATE INDEX "CampaignAdVersion_organizationId_idx" ON "CampaignAdVersion"("organizationId");
