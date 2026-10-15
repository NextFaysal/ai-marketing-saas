-- SU1/SU2 (Social Posts Update Batch 1): post groups + first
-- comment, recurring series + evergreen fields on SocialPost,
-- and per-account posting slots. All additive.

-- CreateTable
CREATE TABLE "SocialPostGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPostGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostingSlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPostingSlot_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "postGroupId" TEXT,
ADD COLUMN "firstCommentText" TEXT,
ADD COLUMN "firstCommentStatus" TEXT,
ADD COLUMN "firstCommentError" TEXT,
ADD COLUMN "firstCommentId" TEXT,
ADD COLUMN "seriesId" TEXT,
ADD COLUMN "recurrenceFrequency" TEXT,
ADD COLUMN "recurrenceInterval" INTEGER,
ADD COLUMN "isEvergreen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "evergreenMinGapDays" INTEGER,
ADD COLUMN "evergreenMaxCycles" INTEGER,
ADD COLUMN "evergreenCyclesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "evergreenLastRecycledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SocialPostGroup_organizationId_idx" ON "SocialPostGroup"("organizationId");

-- CreateIndex
CREATE INDEX "SocialPostingSlot_organizationId_socialAccountId_idx" ON "SocialPostingSlot"("organizationId", "socialAccountId");

-- CreateIndex
CREATE INDEX "SocialPost_organizationId_seriesId_idx" ON "SocialPost"("organizationId", "seriesId");

-- AddForeignKey
ALTER TABLE "SocialPostGroup" ADD CONSTRAINT "SocialPostGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostingSlot" ADD CONSTRAINT "SocialPostingSlot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostingSlot" ADD CONSTRAINT "SocialPostingSlot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_postGroupId_fkey" FOREIGN KEY ("postGroupId") REFERENCES "SocialPostGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
