-- NF7 (FB3): Membership tiers + store credit.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style).
--
-- Tiers: TierDefinition (org-configured thresholds) +
-- CustomerTier (a DERIVED row: lifetime spend over sold orders
-- only — status completed | delivered — and the highest tier
-- whose threshold it reaches; rebuildable at any time).
--
-- Store credit: StoreCreditEntry is THE ledger and the sole
-- truth — a customer's balance is always Σ deltaMinor; there is
-- NO balance column anywhere. (organizationId, sourceRef)
-- unique is the exactly-once backstop for spend / reversal /
-- refund-to-credit entries.
--
-- PriceList extension (the ONLY change to an existing table
-- besides Store): groupId becomes nullable and a tierId binding
-- is added, so the EXISTING PriceList / PriceListItem machinery
-- can serve a tier without a fake CustomerGroup and without
-- forking pricing. A list is bound to a group XOR a tier.
--
-- Store.refundToCreditEnabled: the per-store refund-to-credit
-- opt-in, DEFAULT FALSE, beside refundPushEnabled (owner
-- decision 2026-10-13: refund features stay opt-in).

CREATE TABLE "TierDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSpendMinor" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerTier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tierId" TEXT,
    "lifetimeSpendMinor" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreCreditEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deltaMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "sourceRef" TEXT,
    "balanceAfter" BIGINT NOT NULL,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCreditEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TierDefinition_organizationId_name_key" ON "TierDefinition"("organizationId", "name");
CREATE INDEX "TierDefinition_organizationId_sortOrder_idx" ON "TierDefinition"("organizationId", "sortOrder");

CREATE UNIQUE INDEX "CustomerTier_customerId_key" ON "CustomerTier"("customerId");
CREATE INDEX "CustomerTier_organizationId_tierId_idx" ON "CustomerTier"("organizationId", "tierId");
CREATE INDEX "CustomerTier_organizationId_customerId_idx" ON "CustomerTier"("organizationId", "customerId");

CREATE UNIQUE INDEX "StoreCreditEntry_organizationId_sourceRef_key" ON "StoreCreditEntry"("organizationId", "sourceRef");
CREATE INDEX "StoreCreditEntry_organizationId_customerId_createdAt_idx" ON "StoreCreditEntry"("organizationId", "customerId", "createdAt");
CREATE INDEX "StoreCreditEntry_organizationId_orderId_idx" ON "StoreCreditEntry"("organizationId", "orderId");

ALTER TABLE "TierDefinition" ADD CONSTRAINT "TierDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTier" ADD CONSTRAINT "CustomerTier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTier" ADD CONSTRAINT "CustomerTier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTier" ADD CONSTRAINT "CustomerTier_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "TierDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StoreCreditEntry" ADD CONSTRAINT "StoreCreditEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCreditEntry" ADD CONSTRAINT "StoreCreditEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PriceList: group binding becomes optional; tier binding added.
ALTER TABLE "PriceList" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "PriceList" ADD COLUMN "tierId" TEXT;
CREATE UNIQUE INDEX "PriceList_tierId_key" ON "PriceList"("tierId");
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "TierDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Store: per-store refund-to-credit opt-in (default OFF).
ALTER TABLE "Store" ADD COLUMN "refundToCreditEnabled" BOOLEAN NOT NULL DEFAULT false;
