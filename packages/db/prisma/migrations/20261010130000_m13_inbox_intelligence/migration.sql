-- Milestone 13: Inbox intelligence (Phase B)
ALTER TABLE "ChannelMessage" ADD COLUMN "intent" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "intentConfidence" INTEGER;
ALTER TABLE "ChannelMessage" ADD COLUMN "autoReply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelMessage" ADD COLUMN "autoReplyEvidence" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "ChannelConversation" ADD COLUMN "sentimentFlag" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "codConfirmationStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "codConfirmationSentAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "codConversationId" TEXT;

CREATE TABLE "InboxSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "autoReplyMode" TEXT NOT NULL DEFAULT 'off',
    "confidenceThreshold" INTEGER NOT NULL DEFAULT 70,
    "perIntent" JSONB,
    "smartAssign" TEXT NOT NULL DEFAULT 'off',
    "lastAssignedUserId" TEXT,
    "slaFirstResponseMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InboxSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboxSetting_organizationId_key" ON "InboxSetting"("organizationId");
