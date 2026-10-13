-- CX10: Follow-up timing settings + broadcast exclusion.
-- Additive only, no backfill, no index changes:
--   CrmSetting.followUpDefaultsByStage — per-stage default follow-up
--     intervals in HOURS as JSON ({ "new": 24, "contacted": 72 }),
--     keyed by Lead stage. NULL (every existing row) = no automatic
--     follow-up stamping — behaviour exactly as before CX10.
--   Broadcast.excludePreviousRecipients — when true, sendBroadcast
--     drops audience members who already received a CONFIRMED
--     (status "sent") delivery from an earlier broadcast of the
--     same org. Existing rows read false = pre-CX10 behaviour.
ALTER TABLE "CrmSetting" ADD COLUMN "followUpDefaultsByStage" JSONB;
ALTER TABLE "Broadcast" ADD COLUMN "excludePreviousRecipients" BOOLEAN NOT NULL DEFAULT false;
