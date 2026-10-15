-- Campaign Builder Next CN9: manageable cross-platform drafts.
-- Additive only: one new table, no changes to existing tables.
CREATE TABLE "CrossPlatformDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "targetAdAccountId" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'mapped',
    "unmapped" JSONB,
    "publicationId" TEXT,
    "externalCampaignId" TEXT,
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrossPlatformDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrossPlatformDraft_organizationId_planId_idx" ON "CrossPlatformDraft"("organizationId", "planId");
