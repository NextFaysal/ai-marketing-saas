-- Milestone 20: Phase I (rules v2, CTWA referral, platform publications, report shares)
ALTER TABLE "AutomationRule" ADD COLUMN "actionConfig" JSONB;
ALTER TABLE "ChannelMessage" ADD COLUMN "referral" JSONB;
ALTER TABLE "ChannelConversation" ADD COLUMN "ctwaSourceId" TEXT;

CREATE TABLE "PlatformPublication" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "platform" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL, "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
    "externalCampaignId" TEXT, "detail" JSONB, "error" TEXT,
    "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformPublication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformPublication_organizationId_platform_idx" ON "PlatformPublication"("organizationId","platform");

CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "token" TEXT NOT NULL,
    "title" TEXT NOT NULL, "days" INTEGER NOT NULL DEFAULT 30, "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportShare_token_key" ON "ReportShare"("token");
CREATE INDEX "ReportShare_organizationId_idx" ON "ReportShare"("organizationId");
