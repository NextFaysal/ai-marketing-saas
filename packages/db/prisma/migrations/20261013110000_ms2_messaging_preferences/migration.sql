-- MS2: Consent, opt-out & suppression.
-- Additive only:
--   MessagePreference — one row per (organizationId, channel,
--     address); status opted_out | opted_in, flipped in place by
--     unsubscribe links, inbound STOP/START keywords, manual adds
--     and imports. Address stored normalized (email trimmed +
--     lowercased; phone in gateway form when possible).
--   MessagingSetting — per-org single row (CrmSetting pattern):
--     frequencyCapPerDay (default 1, 0 = off; broadcasts only) and
--     whatsappOptInRequired (default false). A missing row reads as
--     the defaults, so existing orgs behave exactly as the column
--     defaults state.
--   MessageDelivery.status is a free String; its vocabulary extends
--     with "skipped" (recipient opted out; provider never called) —
--     no DDL needed for that.
CREATE TABLE "MessagePreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "recipientType" TEXT,
    "recipientId" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagePreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagePreference_organizationId_channel_address_key" ON "MessagePreference"("organizationId", "channel", "address");
CREATE INDEX "MessagePreference_organizationId_status_idx" ON "MessagePreference"("organizationId", "status");

CREATE TABLE "MessagingSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frequencyCapPerDay" INTEGER NOT NULL DEFAULT 1,
    "whatsappOptInRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagingSetting_organizationId_key" ON "MessagingSetting"("organizationId");
