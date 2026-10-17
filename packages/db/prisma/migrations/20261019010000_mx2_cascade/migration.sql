-- MX2: Smart Channel Routing & Fallback Cascade.
-- Additive only, no backfill:
--   Broadcast.cascadeConfig — the org's cascade for this
--     broadcast ({enabled, channels (org order), smartRouting,
--     ordering, per-channel cascade content}), validated by
--     messaging/cascade.ts. Null on every pre-MX2 row = the
--     single-channel behaviour, unchanged.
--   Broadcast.cascadeReport — per-run cascade facts not
--     derivable from delivery rows (SMS circuit-breaker
--     events, broadcast-level skipped channels with reasons,
--     missing-rate notes for cheapest-first).
--   MessageDelivery.cascadeGroupId / recipientRowId /
--     attemptIndex — the attempt linking: every delivery row
--     of one recipient's cascade chain shares the group id
--     (the BroadcastRecipient row id), and each attempt knows
--     its recipient row + 0-based position in the chain.
--     Null on every pre-MX2 / non-cascade delivery.
--   MessagingSenderConfig.smsPriority — failover priority of
--     the org's primary SMS config (lower sends first).
--   MessagingSmsGatewayConfig — additional tenant SMS
--     gateways (before MX2 exactly one tenant SMS config
--     could exist, on the @unique MessagingSenderConfig row).
--     Same sealed-secret discipline; never returned by APIs.
ALTER TABLE "Broadcast" ADD COLUMN "cascadeConfig" JSONB;
ALTER TABLE "Broadcast" ADD COLUMN "cascadeReport" JSONB;

ALTER TABLE "MessageDelivery" ADD COLUMN "cascadeGroupId" TEXT;
ALTER TABLE "MessageDelivery" ADD COLUMN "recipientRowId" TEXT;
ALTER TABLE "MessageDelivery" ADD COLUMN "attemptIndex" INTEGER;

CREATE INDEX "MessageDelivery_broadcastId_recipientRowId_idx" ON "MessageDelivery"("broadcastId", "recipientRowId");

ALTER TABLE "MessagingSenderConfig" ADD COLUMN "smsPriority" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "MessagingSmsGatewayConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "smsGateway" TEXT NOT NULL,
    "smsApiKeyEncrypted" TEXT NOT NULL,
    "smsSenderId" TEXT NOT NULL,
    "smsApiUrl" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingSmsGatewayConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessagingSmsGatewayConfig_organizationId_priority_idx" ON "MessagingSmsGatewayConfig"("organizationId", "priority");
