-- MS7: post-send delivery lifecycle on MessageDelivery.
-- Additive only, no backfill:
--   deliveryStatus — null (no post-send signal yet) | delivered
--     | read | failed. DELIBERATELY separate from the send-outcome
--     `status` column (sent | failed | skipped): the MS1
--     final-status math reads `status` and must not change
--     meaning. Written only by real signals — WhatsApp status
--     webhooks (monotonic) and the signed email open pixel.
--   deliveredAt / readAt — when the WhatsApp webhook reported
--     the transition (server receive time; Meta statuses carry
--     no per-status timestamp the parser keeps).
--   openedAt — first hit of the signed open-tracking pixel in a
--     broadcast HTML email. Text-only email has no pixel and
--     honestly never gets an openedAt.
--   Index on (organizationId, providerMessageId): the webhook
--   path matches broadcast deliveries by Meta message id.
ALTER TABLE "MessageDelivery" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "MessageDelivery" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "MessageDelivery" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "MessageDelivery" ADD COLUMN "openedAt" TIMESTAMP(3);

CREATE INDEX "MessageDelivery_organizationId_providerMessageId_idx" ON "MessageDelivery"("organizationId", "providerMessageId");
