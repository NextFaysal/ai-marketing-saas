-- Milestone 17: Phase F (channels, customers 360, RFM/AB, team)
ALTER TABLE "Customer" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "audienceSegment" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "abVariant" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "abGroupId" TEXT;
CREATE INDEX "Broadcast_abGroupId_idx" ON "Broadcast"("abGroupId");

CREATE TABLE "WidgetSite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "widgetKey" TEXT NOT NULL,
    "greeting" TEXT,
    "color" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WidgetSite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WidgetSite_widgetKey_key" ON "WidgetSite"("widgetKey");
CREATE INDEX "WidgetSite_organizationId_idx" ON "WidgetSite"("organizationId");

CREATE TABLE "LiveChatSession" (
    "id" TEXT NOT NULL,
    "widgetSiteId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "visitorTokenHash" TEXT NOT NULL,
    "visitorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveChatSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LiveChatSession_conversationId_key" ON "LiveChatSession"("conversationId");
CREATE INDEX "LiveChatSession_widgetSiteId_visitorId_idx" ON "LiveChatSession"("widgetSiteId", "visitorId");

CREATE TABLE "AgentPresence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typing" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentPresence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentPresence_conversationId_userId_key" ON "AgentPresence"("conversationId", "userId");
CREATE INDEX "AgentPresence_organizationId_conversationId_idx" ON "AgentPresence"("organizationId", "conversationId");

CREATE TABLE "AgentNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "conversationId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentNotification_organizationId_userId_readAt_idx" ON "AgentNotification"("organizationId", "userId", "readAt");
