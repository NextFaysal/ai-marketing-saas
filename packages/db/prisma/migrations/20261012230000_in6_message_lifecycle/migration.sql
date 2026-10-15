-- IN6: Message lifecycle — delivery/read status, quote, reactions, pin.
-- Additive only: new nullable columns on ChannelMessage, no changes
-- to existing columns, no backfill. Existing rows read exactly as
-- before: deliveryStatus NULL means "no platform confirmation was
-- ever received" (the UI shows nothing), reactions NULL means no
-- reaction was ever recorded, pinnedAt NULL means not pinned.
ALTER TABLE "ChannelMessage" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "ChannelMessage" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "ChannelMessage" ADD COLUMN "replyToMessageId" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "reactions" JSONB;
ALTER TABLE "ChannelMessage" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ChannelMessage" ADD COLUMN "pinnedBy" TEXT;
