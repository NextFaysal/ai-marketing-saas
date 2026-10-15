-- SU9/SU10 (Social Posts Update Batch 5): collaboration tables
-- (internal notes + content versions), post assignment, the
-- two-step approval org switch, and SocialAccount.healthCheckedAt
-- for SU10's health center. All additive.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "socialApprovalTwoStep" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "healthCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "assignedUserId" TEXT;

-- CreateTable
CREATE TABLE "SocialPostNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPostNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPostNote_organizationId_socialPostId_idx" ON "SocialPostNote"("organizationId", "socialPostId");

-- CreateIndex
CREATE INDEX "SocialPostVersion_organizationId_socialPostId_idx" ON "SocialPostVersion"("organizationId", "socialPostId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostVersion_socialPostId_versionNo_key" ON "SocialPostVersion"("socialPostId", "versionNo");

-- AddForeignKey
ALTER TABLE "SocialPostNote" ADD CONSTRAINT "SocialPostNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostNote" ADD CONSTRAINT "SocialPostNote_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostVersion" ADD CONSTRAINT "SocialPostVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostVersion" ADD CONSTRAINT "SocialPostVersion_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
