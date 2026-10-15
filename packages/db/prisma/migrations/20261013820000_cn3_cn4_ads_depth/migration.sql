-- Campaign Builder Next NB2: CN3 conversion & catalog depth
-- (per-ad-set conversionEvent + catalogRecordId/productSetId
-- on CampaignAdSet) and CN4 Lead Ads (the LeadForm table +
-- CampaignAdSet.leadFormId). All changes are additive and
-- nullable/defaulted, so existing plans keep their exact
-- pre-NB2 behaviour (null conversionEvent = the legacy
-- PURCHASE default; null catalog/lead-form ids = a normal
-- link/lead ad set as before).
-- NOT run on any real DB from the build sandbox; the full
-- sequence is verified on a fresh Postgres only.

-- AlterTable
ALTER TABLE "CampaignAdSet" ADD COLUMN "conversionEvent" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "catalogRecordId" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "productSetId" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "leadFormId" TEXT;

-- CreateTable
CREATE TABLE "LeadForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'EN_US',
    "introHeadline" TEXT,
    "introDescription" TEXT,
    "questions" JSONB NOT NULL,
    "privacyPolicyUrl" TEXT NOT NULL,
    "privacyLinkText" TEXT,
    "thankYouTitle" TEXT,
    "thankYouBody" TEXT,
    "thankYouButtonText" TEXT,
    "followUpActionUrl" TEXT,
    "higherIntent" BOOLEAN NOT NULL DEFAULT false,
    "fieldMapping" JSONB,
    "externalFormId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'local',
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadForm_organizationId_idx" ON "LeadForm"("organizationId");

-- CreateIndex
CREATE INDEX "LeadForm_organizationId_externalFormId_idx" ON "LeadForm"("organizationId", "externalFormId");

-- AddForeignKey
ALTER TABLE "LeadForm" ADD CONSTRAINT "LeadForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
