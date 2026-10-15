-- IN8: comment queue assignment + comment->DM conversation link.
-- Additive only: two nullable columns on SocialComment, no
-- backfill. Existing rows have both NULL = unassigned / no DM
-- conversation, exactly today's behaviour. Status stays a plain
-- string column, so the new DELETED status needs no migration.
ALTER TABLE "SocialComment" ADD COLUMN "assignedUserId" TEXT;
ALTER TABLE "SocialComment" ADD COLUMN "dmConversationId" TEXT;
