-- SU5/SU6 (Social Posts Update Batch 3): commerce auto-draft
-- config + link-click tracking. All additive.

-- CreateTable
CREATE TABLE "SocialAutoDraftConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "newProductEnabled" BOOLEAN NOT NULL DEFAULT false,
    "saleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backInStockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reviewMilestoneEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxDraftsPerDay" INTEGER NOT NULL DEFAULT 3,
    "socialAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAutoDraftConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialLinkClick" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" VARCHAR(300),

    CONSTRAINT "SocialLinkClick_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "socialLinkWindowDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "autoDraftKind" TEXT,
ADD COLUMN "autoDraftRef" TEXT,
ADD COLUMN "linkToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SocialAutoDraftConfig_organizationId_key" ON "SocialAutoDraftConfig"("organizationId");

-- CreateIndex
CREATE INDEX "SocialAutoDraftConfig_organizationId_idx" ON "SocialAutoDraftConfig"("organizationId");

-- CreateIndex
CREATE INDEX "SocialLinkClick_socialPostId_clickedAt_idx" ON "SocialLinkClick"("socialPostId", "clickedAt");

-- CreateIndex
CREATE INDEX "SocialLinkClick_organizationId_idx" ON "SocialLinkClick"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_linkToken_key" ON "SocialPost"("linkToken");

-- AddForeignKey
ALTER TABLE "SocialAutoDraftConfig" ADD CONSTRAINT "SocialAutoDraftConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAutoDraftConfig" ADD CONSTRAINT "SocialAutoDraftConfig_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialLinkClick" ADD CONSTRAINT "SocialLinkClick_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialLinkClick" ADD CONSTRAINT "SocialLinkClick_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
