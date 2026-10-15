-- AlterTable
ALTER TABLE "SocialAutoDraftConfig" ADD COLUMN "rssEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SocialAutoDraftConfig" ADD COLUMN "rssFeedUrl" TEXT;
ALTER TABLE "SocialAutoDraftConfig" ADD COLUMN "youtubeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "captionTestId" TEXT;

-- CreateTable
CREATE TABLE "SocialSyndicationSeen" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSyndicationSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_organizationId_captionTestId_idx" ON "SocialPost"("organizationId", "captionTestId");

-- CreateIndex
CREATE INDEX "SocialSyndicationSeen_organizationId_source_idx" ON "SocialSyndicationSeen"("organizationId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSyndicationSeen_organizationId_source_externalId_key" ON "SocialSyndicationSeen"("organizationId", "source", "externalId");

-- AddForeignKey
ALTER TABLE "SocialSyndicationSeen" ADD CONSTRAINT "SocialSyndicationSeen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
