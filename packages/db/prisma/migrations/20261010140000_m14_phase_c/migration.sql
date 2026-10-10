-- Milestone 14: Phase C (broadcasts, chat orders, merge, CSAT, spam, summaries)
ALTER TABLE "ChannelConversation" ADD COLUMN "spamFlag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelConversation" ADD COLUMN "spamReason" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "csatSentAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "csatRating" INTEGER;
ALTER TABLE "ChannelConversation" ADD COLUMN "csatRatedAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "summaryText" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "summaryProvider" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "summaryAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "storeSyncStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "storeSyncError" TEXT;
ALTER TABLE "Lead" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "whatsappTemplateId" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "templateParams" JSONB;
