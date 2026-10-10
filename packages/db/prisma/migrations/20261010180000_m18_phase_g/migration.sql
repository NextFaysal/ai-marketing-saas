-- Milestone 18: Phase G (CAPI, ad-level insights, breakdowns, attribution window)
ALTER TABLE "Organization" ADD COLUMN "attributionWindowDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "DailyAdMetric" ADD COLUMN "adSetExternalId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DailyAdMetric" ADD COLUMN "adSetName" TEXT;
ALTER TABLE "DailyAdMetric" ADD COLUMN "adExternalId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DailyAdMetric" ADD COLUMN "adName" TEXT;
ALTER TABLE "DailyAdMetric" ADD COLUMN "reach" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyAdMetric" ADD COLUMN "videoViews" INTEGER NOT NULL DEFAULT 0;
DROP INDEX "DailyAdMetric_organizationId_adAccountId_campaignExternalId_date_source_key";
CREATE UNIQUE INDEX "DailyAdMetric_organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source_key" ON "DailyAdMetric"("organizationId","adAccountId","campaignExternalId","adSetExternalId","adExternalId","date","source");

CREATE TABLE "DailyAdBreakdown" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'meta',
    "source" TEXT NOT NULL DEFAULT 'api',
    "date" TIMESTAMP(3) NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "campaignExternalId" TEXT NOT NULL DEFAULT '',
    "spendMinor" BIGINT NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "platformConversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyAdBreakdown_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyAdBreakdown_organizationId_adAccountId_date_dimension_key_campaignExternalId_source_key" ON "DailyAdBreakdown"("organizationId","adAccountId","date","dimension","key","campaignExternalId","source");
CREATE INDEX "DailyAdBreakdown_organizationId_dimension_date_idx" ON "DailyAdBreakdown"("organizationId","dimension","date");

CREATE TABLE "ConversionApiSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "testEventCode" TEXT,
    "purchaseTrigger" TEXT NOT NULL DEFAULT 'placed',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sendLeadEvents" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConversionApiSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConversionApiSetting_organizationId_key" ON "ConversionApiSetting"("organizationId");

CREATE TABLE "ConversionEventLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "eventsReceived" INTEGER,
    "fbtraceId" TEXT,
    "error" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversionEventLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConversionEventLog_organizationId_eventId_key" ON "ConversionEventLog"("organizationId","eventId");
CREATE INDEX "ConversionEventLog_organizationId_createdAt_idx" ON "ConversionEventLog"("organizationId","createdAt");
