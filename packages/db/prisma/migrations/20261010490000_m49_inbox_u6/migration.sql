-- Unified Inbox U6 (Milestone 48): media pipeline + retention.
ALTER TABLE "ChannelMessage" ADD COLUMN "mediaStorageKey" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "mediaContentType" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "mediaSizeBytes" INTEGER;
ALTER TABLE "InboxSetting" ADD COLUMN "retentionDays" INTEGER;
