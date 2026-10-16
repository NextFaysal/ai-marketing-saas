-- AB7 (AX15–AX20): growth & intelligence — AI review insights
-- (ProductReviewInsight), web push (ShopPushSetting with sealed
-- VAPID private key, WebPushSubscription, WebPushCampaign,
-- WebPushDelivery), social proof (SocialProofSetting), and
-- order-level attribution stamps on Order (AX19, nullable —
-- null = untracked). Additive only: new tables + nullable
-- columns + indexes.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "clickId" TEXT,
ADD COLUMN     "clickIdType" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateTable
CREATE TABLE "ProductReviewInsight" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "summaryText" TEXT NOT NULL,
    "sentimentJson" JSONB NOT NULL,
    "themesJson" JSONB NOT NULL,
    "reviewCountAtGeneration" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedById" TEXT,
    "modelLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReviewInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopPushSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vapidPublicKey" TEXT,
    "vapidPrivateKeySealed" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "promptDelaySec" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPushSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebPushSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "customerId" TEXT,
    "userAgent" TEXT,
    "isTestDevice" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebPushCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "goneCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebPushCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebPushDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebPushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialProofSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lookbackHours" INTEGER NOT NULL DEFAULT 24,
    "intervalSec" INTEGER NOT NULL DEFAULT 25,
    "displaySec" INTEGER NOT NULL DEFAULT 6,
    "maxPerSession" INTEGER NOT NULL DEFAULT 5,
    "minTotalMinor" BIGINT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialProofSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductReviewInsight_organizationId_idx" ON "ProductReviewInsight"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReviewInsight_organizationId_productId_key" ON "ProductReviewInsight"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopPushSetting_organizationId_key" ON "ShopPushSetting"("organizationId");

-- CreateIndex
CREATE INDEX "WebPushSubscription_organizationId_status_idx" ON "WebPushSubscription"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebPushSubscription_organizationId_endpoint_key" ON "WebPushSubscription"("organizationId", "endpoint");

-- CreateIndex
CREATE INDEX "WebPushCampaign_organizationId_status_idx" ON "WebPushCampaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WebPushCampaign_organizationId_createdAt_idx" ON "WebPushCampaign"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebPushDelivery_campaignId_status_idx" ON "WebPushDelivery"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebPushDelivery_campaignId_subscriptionId_key" ON "WebPushDelivery"("campaignId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialProofSetting_organizationId_key" ON "SocialProofSetting"("organizationId");

-- AddForeignKey
ALTER TABLE "ProductReviewInsight" ADD CONSTRAINT "ProductReviewInsight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPushSetting" ADD CONSTRAINT "ShopPushSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebPushSubscription" ADD CONSTRAINT "WebPushSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebPushCampaign" ADD CONSTRAINT "WebPushCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebPushDelivery" ADD CONSTRAINT "WebPushDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WebPushCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebPushDelivery" ADD CONSTRAINT "WebPushDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebPushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialProofSetting" ADD CONSTRAINT "SocialProofSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

