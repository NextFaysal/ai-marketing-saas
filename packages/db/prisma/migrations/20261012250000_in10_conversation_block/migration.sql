-- IN10a: agent-applied customer block on a conversation (our
-- system-level block only — never a platform block). Additive
-- only: three nullable columns, no backfill. Existing rows have
-- blockedAt NULL = not blocked, exactly today's behaviour.
ALTER TABLE "ChannelConversation" ADD COLUMN "blockedAt" TIMESTAMP(3);
ALTER TABLE "ChannelConversation" ADD COLUMN "blockedByUserId" TEXT;
ALTER TABLE "ChannelConversation" ADD COLUMN "blockReason" TEXT;
