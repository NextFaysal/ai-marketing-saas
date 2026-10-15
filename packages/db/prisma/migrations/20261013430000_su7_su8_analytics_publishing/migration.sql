-- SU7/SU8 (Social Posts Update Batch 4): follower snapshots +
-- YouTube metadata / cover / story fields on SocialPost.
-- All additive.

-- CreateTable
CREATE TABLE "SocialAccountFollowerSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "followers" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialAccountFollowerSnapshot_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "youtubeTitle" TEXT,
ADD COLUMN "youtubeTags" JSONB,
ADD COLUMN "youtubeCategoryId" TEXT,
ADD COLUMN "youtubeIsShort" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "coverAssetId" TEXT,
ADD COLUMN "isStory" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccountFollowerSnapshot_socialAccountId_day_key" ON "SocialAccountFollowerSnapshot"("socialAccountId", "day");

-- CreateIndex
CREATE INDEX "SocialAccountFollowerSnapshot_organizationId_idx" ON "SocialAccountFollowerSnapshot"("organizationId");

-- AddForeignKey
ALTER TABLE "SocialAccountFollowerSnapshot" ADD CONSTRAINT "SocialAccountFollowerSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccountFollowerSnapshot" ADD CONSTRAINT "SocialAccountFollowerSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
