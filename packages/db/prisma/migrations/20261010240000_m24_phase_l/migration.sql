-- Milestone 24: Phase L (offline conversions)
CREATE TABLE "OfflineConversionSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "conversionAction" TEXT,
    "pixelCode" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'cod_confirmed',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfflineConversionSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfflineConversionSetting_organizationId_platform_key" ON "OfflineConversionSetting"("organizationId", "platform");
CREATE INDEX "OfflineConversionSetting_organizationId_idx" ON "OfflineConversionSetting"("organizationId");
CREATE TABLE "OfflineConversionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfflineConversionLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfflineConversionLog_organizationId_platform_eventId_key" ON "OfflineConversionLog"("organizationId", "platform", "eventId");
CREATE INDEX "OfflineConversionLog_organizationId_platform_idx" ON "OfflineConversionLog"("organizationId", "platform");
