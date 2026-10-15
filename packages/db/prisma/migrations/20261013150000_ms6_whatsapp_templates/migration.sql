-- MS6: WhatsApp Template Hub.
-- Additive only, no backfill:
--   WhatsAppTemplate.metaTemplateId — Meta's message_template id,
--     populated by the template sync / submit flow. NULL (every
--     existing row) = local-only registry entry, never synced.
--   WhatsAppTemplate.status — Meta's approval status as returned
--     (APPROVED | PENDING | REJECTED | PAUSED | DISABLED | …), or
--     NOT_ON_META, set only by a COMPLETE (untruncated) sync that
--     did not return the template. NULL = never verified with Meta.
--   WhatsAppTemplate.qualityRating — quality_score.score as
--     returned by Meta (GREEN | YELLOW | RED | UNKNOWN).
--   WhatsAppTemplate.components — Meta's components array, as
--     returned by sync or as authored at submit time.
--   WhatsAppTemplate.lastSyncedAt — when sync/submit last touched
--     the row from Meta data. NULL = never.
--   Broadcast.templateComponents — rich send-time template
--     parameters for WhatsApp broadcasts ({ headerMediaUrl?,
--     headerTextParams?, buttonParams? }); NULL = legacy
--     body-params-only sends, exactly as before.
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "metaTemplateId" TEXT;
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "status" TEXT;
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "qualityRating" TEXT;
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "components" JSONB;
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

ALTER TABLE "Broadcast" ADD COLUMN "templateComponents" JSONB;
