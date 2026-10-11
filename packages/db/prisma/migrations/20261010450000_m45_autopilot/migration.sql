-- Unified Inbox U3 (Milestone 45): autopilot tiers + bot v2.
ALTER TABLE "Order" ADD COLUMN "address" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "autoReplyPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxSetting" ADD COLUMN "perChannelModes" JSONB;
ALTER TABLE "InboxSetting" ADD COLUMN "escalationThresholdMinor" INTEGER;
