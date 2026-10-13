-- CX12a: Setup Guide + Practice Mode.
-- Additive only, no backfill, no index changes:
--   Organization.practiceMode — org-level Practice Mode switch
--     (OWNER/ADMIN toggled). Existing rows read false = practice
--     off, behaviour exactly as before CX12a.
--   ChannelConversation.isPractice — synthetic practice thread;
--     every outbound send on it is stored locally as a practice
--     message and never handed to a channel sender.
--   Order.isPractice — order created from a practice conversation;
--     excluded from order lists/stats/analytics by default and
--     refused by courier booking.
ALTER TABLE "Organization" ADD COLUMN "practiceMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelConversation" ADD COLUMN "isPractice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "isPractice" BOOLEAN NOT NULL DEFAULT false;
