-- MS8: recurring broadcasts.
-- Additive only, no backfill:
--   Broadcast.recurrence — { freq: "daily"|"weekly",
--     interval: int >= 1, weekdays?: int[] (0-6, Asia/Dhaka
--     calendar days), endsAt?: ISO string }. Lives on the ONE
--     pending instance of a recurrence chain: when an instance
--     finalizes (sent | partial | failed) the engine creates
--     the next instance as a fresh "scheduled" broadcast
--     holding the recurrence, and clears it on the finalized
--     row — exactly one pending instance per group, ever.
--     A paused or cancelled instance ends the chain (the
--     sweep only ever finalizes scheduled/sending rows).
--   Broadcast.recurrenceGroupId — ties every instance of one
--     chain together; A/B variants share one group id (the
--     abGroupId precedent). NULL = one-off broadcast.
ALTER TABLE "Broadcast" ADD COLUMN "recurrence" JSONB;
ALTER TABLE "Broadcast" ADD COLUMN "recurrenceGroupId" TEXT;

CREATE INDEX "Broadcast_organizationId_recurrenceGroupId_idx" ON "Broadcast"("organizationId", "recurrenceGroupId");
