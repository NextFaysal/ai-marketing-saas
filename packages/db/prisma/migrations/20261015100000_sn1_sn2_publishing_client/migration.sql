-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "socialRequireClientApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "youtubePlaylistId" TEXT;

-- CreateTable
CREATE TABLE "SocialPostShareLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT,
    "groupId" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostClientReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostClientReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostShareLink_token_key" ON "SocialPostShareLink"("token");

-- CreateIndex
CREATE INDEX "SocialPostShareLink_organizationId_idx" ON "SocialPostShareLink"("organizationId");

-- CreateIndex
CREATE INDEX "SocialPostShareLink_postId_idx" ON "SocialPostShareLink"("postId");

-- CreateIndex
CREATE INDEX "SocialPostShareLink_groupId_idx" ON "SocialPostShareLink"("groupId");

-- CreateIndex
CREATE INDEX "SocialPostClientReview_organizationId_postId_idx" ON "SocialPostClientReview"("organizationId", "postId");

-- CreateIndex
CREATE INDEX "SocialPostClientReview_shareLinkId_idx" ON "SocialPostClientReview"("shareLinkId");

-- AddForeignKey
ALTER TABLE "SocialPostShareLink" ADD CONSTRAINT "SocialPostShareLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostShareLink" ADD CONSTRAINT "SocialPostShareLink_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostShareLink" ADD CONSTRAINT "SocialPostShareLink_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialPostGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostClientReview" ADD CONSTRAINT "SocialPostClientReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostClientReview" ADD CONSTRAINT "SocialPostClientReview_postId_fkey" FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostClientReview" ADD CONSTRAINT "SocialPostClientReview_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "SocialPostShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
