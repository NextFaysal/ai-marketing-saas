-- MX14: On-site Notification Channel.
-- Additive only, no backfill:
--   Broadcast.onsiteUrl — the shop-relative click-through URL
--     of an onsite broadcast (same shop-relative rule as
--     MX12's pushUrl). NULL = every pre-MX14 row and every
--     non-onsite broadcast; opening the notification then
--     only marks it read.
--   OnsiteNotification — the customer notification center
--     store: one row per (broadcast, customer), written by
--     the messaging engine's onsite send (the create IS the
--     delivery — no external provider). deliveryId is unique
--     (one notification per MessageDelivery) and the
--     (broadcastId, customerId) unique makes a resumed send
--     incapable of duplicating a notification. readAt is
--     stamped by the customer's real open action in the shop
--     account area, which also stamps the linked delivery's
--     readAt / deliveryStatus.
-- The channel columns (Broadcast.channel, MessageDelivery
-- .channel, MessagePreference.channel) are plain Strings and
-- gain the value "onsite" with no DDL.
ALTER TABLE "Broadcast" ADD COLUMN "onsiteUrl" TEXT;

CREATE TABLE "OnsiteNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "broadcastId" TEXT,
    "deliveryId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnsiteNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnsiteNotification_deliveryId_key" ON "OnsiteNotification"("deliveryId");
CREATE UNIQUE INDEX "OnsiteNotification_broadcastId_customerId_key" ON "OnsiteNotification"("broadcastId", "customerId");
CREATE INDEX "OnsiteNotification_organizationId_customerId_createdAt_idx" ON "OnsiteNotification"("organizationId", "customerId", "createdAt");
CREATE INDEX "OnsiteNotification_organizationId_broadcastId_idx" ON "OnsiteNotification"("organizationId", "broadcastId");
