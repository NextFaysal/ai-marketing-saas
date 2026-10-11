-- Social Media Post Scheduler SP3 (AI Copy): tenant-saved hashtag
-- sets for social captions. No generic tenant key-value store
-- exists, so sets get this one small table; tags is a JSON array
-- of strings (without the leading "#"), normalized in the service.

-- CreateTable
CREATE TABLE "SocialHashtagSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialHashtagSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialHashtagSet_organizationId_idx" ON "SocialHashtagSet"("organizationId");
