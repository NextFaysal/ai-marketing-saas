-- MS1: Broadcast async send engine + scheduling.
-- Additive only, no backfill:
--   Broadcast.scheduledAt — when set and the broadcast's status is
--     "scheduled", the broadcast_send_sweep automation job prepares
--     and sends it once due. NULL (every existing row) = no schedule.
--   Broadcast.recipientSnapshot — the resolved recipient set,
--     materialized at prepare time so sends can pause / resume /
--     retry-failed across requests and a crashed "sending" row can
--     be recovered by the sweep. NULL = never prepared.
--   Broadcast.status stays a free String; the vocabulary extends
--     with scheduled | paused | cancelled (no enum migration needed).
ALTER TABLE "Broadcast" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Broadcast" ADD COLUMN "recipientSnapshot" JSONB;
