-- MX1: Recipient Table & Scale Engine v2.
-- Additive only, no backfill:
--   BroadcastRecipient — the primary recipient store for NEW
--     broadcasts. prepareBroadcast writes the resolved audience
--     here in chunks (streaming resolver, dedupe by the unique
--     (broadcastId, dedupeKey) constraint) instead of one Json
--     snapshot; processBroadcast reads pending rows in chunks
--     and derives the broadcast's progress counters from these
--     rows, so a send resumes exactly where it stopped and a
--     confirmed-sent recipient is never sent twice. Existing
--     broadcasts have no rows here and keep the MS1 snapshot
--     path byte-for-byte (Broadcast.recipientSnapshot is NOT
--     touched and stays readable for them).
--   Broadcast.skippedCount — the recipient-table path's skipped
--     counter, derived from BroadcastRecipient rows per chunk
--     (the snapshot path derives skipped from the snapshot and
--     never writes this column; pre-MX1 rows read the default 0
--     exactly as the old counter fallback did).
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "vars" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "providerMessageId" TEXT,
    "sortIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_dedupeKey_key" ON "BroadcastRecipient"("broadcastId", "dedupeKey");
CREATE INDEX "BroadcastRecipient_broadcastId_status_sortIndex_idx" ON "BroadcastRecipient"("broadcastId", "status", "sortIndex");
CREATE INDEX "BroadcastRecipient_broadcastId_sortIndex_idx" ON "BroadcastRecipient"("broadcastId", "sortIndex");
CREATE INDEX "BroadcastRecipient_organizationId_broadcastId_idx" ON "BroadcastRecipient"("organizationId", "broadcastId");

ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Broadcast" ADD COLUMN "skippedCount" INTEGER NOT NULL DEFAULT 0;
