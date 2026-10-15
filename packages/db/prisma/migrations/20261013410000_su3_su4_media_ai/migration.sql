-- SU3/SU4 (Social Posts Update Batch 2): media library folders +
-- tags on MediaAsset, and AI content plans. All additive.

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialContentPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "pillars" JSONB NOT NULL DEFAULT '[]',
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'generated',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialContentPlan_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "folderId" TEXT,
ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "MediaFolder_organizationId_idx" ON "MediaFolder"("organizationId");

-- CreateIndex
CREATE INDEX "SocialContentPlan_organizationId_month_idx" ON "SocialContentPlan"("organizationId", "month");

-- CreateIndex
CREATE INDEX "MediaAsset_organizationId_folderId_idx" ON "MediaAsset"("organizationId", "folderId");

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialContentPlan" ADD CONSTRAINT "SocialContentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
