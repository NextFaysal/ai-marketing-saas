-- Milestone 45 (AI Assistant Core v2): conversation pinning.
ALTER TABLE "AIConversation" ADD COLUMN "pinnedAt" TIMESTAMP(3);
