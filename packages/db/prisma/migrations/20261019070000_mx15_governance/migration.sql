-- MX15: Deliverability, Reputation & Governance.
-- Additive only, no backfill:
--   MessagingSetting.approvalEnabled — send-approval workflow
--     switch (owner decision D2), default FALSE = pre-MX15
--     behaviour for every existing org.
--   MessagingSetting.broadcastCostCapMinor / monthlySpendCapMinor
--     — spend caps (minor units) from org-entered rates only;
--     NULL = no cap. There is no messaging balance figure, so
--     no balance column is added anywhere.
--   Broadcast.approvalStatus / approvalNote / approvedById /
--     approvedAt — the approval decision record; NULL on every
--     pre-MX15 row (= not_required).
--   Broadcast.budgetCapMinor — per-broadcast cap override.
--   MessagingSeedRecipient — the org's internal seed/test list.
ALTER TABLE "MessagingSetting" ADD COLUMN "approvalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessagingSetting" ADD COLUMN "broadcastCostCapMinor" INTEGER;
ALTER TABLE "MessagingSetting" ADD COLUMN "monthlySpendCapMinor" INTEGER;

ALTER TABLE "Broadcast" ADD COLUMN "approvalStatus" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "approvalNote" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Broadcast" ADD COLUMN "budgetCapMinor" INTEGER;

CREATE TABLE "MessagingSeedRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingSeedRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessagingSeedRecipient_organizationId_channel_address_key" ON "MessagingSeedRecipient"("organizationId", "channel", "address");
CREATE INDEX "MessagingSeedRecipient_organizationId_channel_idx" ON "MessagingSeedRecipient"("organizationId", "channel");
