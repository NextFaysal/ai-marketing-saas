-- Unified Inbox U5 (Milestone 47): pipeline stage + close outcome.
ALTER TABLE "ChannelConversation" ADD COLUMN "pipelineStage" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "ChannelConversation" ADD COLUMN "outcome" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "outcomeReason" TEXT;
