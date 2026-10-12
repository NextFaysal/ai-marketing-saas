-- CX Batch 4: Chase, Voice, Knowledge Ingestion, Broadcast Polish
-- CX7: To Chase
ALTER TABLE "InboxSetting" ADD COLUMN "chaseEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxSetting" ADD COLUMN "chaseIntervalMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "InboxSetting" ADD COLUMN "maxChaseAttempts" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "InboxSetting" ADD COLUMN "chaseMessage" TEXT;

ALTER TABLE "BotSession" ADD COLUMN "chaseCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BotSession" ADD COLUMN "lastChasedAt" TIMESTAMP(3);

-- CX9: Knowledge Document file upload & chunking tracking
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceFile" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "chunkIndex" INTEGER;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "totalChunks" INTEGER;

-- CX10: Broadcast exclusions and Opt-out flag
ALTER TABLE "Broadcast" ADD COLUMN "excludePastDays" INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN "excludeOptOut" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Customer" ADD COLUMN "unsubscribed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "unsubscribed" BOOLEAN NOT NULL DEFAULT false;
