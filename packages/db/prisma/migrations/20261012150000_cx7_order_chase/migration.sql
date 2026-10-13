-- CX7: "To Chase" — follow-up nudges for stalled order-bot sessions.
--   OrderChase: one chain per bot session (sessionId UNIQUE is the
--     dedupe guard). Created lazily by the order_chase_sweep on
--     first consideration; attempts counts CONFIRMED sends only
--     (a failed send stamps lastFailedAt, never attempts).
--   InboxSetting.chase*: opt-in (default OFF — this messages
--     customers) + first-delay / interval / max-attempts bounds
--     validated at the settings boundary, + quiet-hours window in
--     the organization's timezone.
CREATE TABLE "OrderChase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastChasedAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "lastEvent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderChase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderChase_sessionId_key" ON "OrderChase"("sessionId");
CREATE INDEX "OrderChase_organizationId_stoppedReason_idx" ON "OrderChase"("organizationId", "stoppedReason");

-- HOTFIX (2026-10-13, live deploy failure): "chaseEnabled" and
-- "chaseIntervalMinutes" are already added by
-- 20261012140000_cx_batch4_features (the owner's parallel CX Batch 4,
-- integrated alongside this one). Re-adding them here made
-- `prisma migrate deploy` fail with 42701 (column already exists) on
-- every real database, which stopped the API container from starting
-- (compose command is `migrate deploy && node main.js`).
-- This migration never successfully applied anywhere in sequence, so
-- removing the two duplicate ADD COLUMN lines is safe. The interval
-- column's DB default is aligned to this package's 240 below.
ALTER TABLE "InboxSetting" ADD COLUMN "chaseFirstDelayMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "InboxSetting" ALTER COLUMN "chaseIntervalMinutes" SET DEFAULT 240;
ALTER TABLE "InboxSetting" ADD COLUMN "chaseMaxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "InboxSetting" ADD COLUMN "chaseQuietHoursRespect" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InboxSetting" ADD COLUMN "chaseQuietStartHour" INTEGER NOT NULL DEFAULT 22;
ALTER TABLE "InboxSetting" ADD COLUMN "chaseQuietEndHour" INTEGER NOT NULL DEFAULT 8;
