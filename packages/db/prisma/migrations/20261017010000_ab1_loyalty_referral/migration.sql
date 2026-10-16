-- AB1 (AX1 Loyalty Points + AX2 Referral Rewards):
--  * LoyaltySetting / ReferralRewardSetting: per-org program
--    configuration, both shipping DISABLED (enabled DEFAULT
--    false) — a deploy changes no behaviour until a merchant
--    turns a program on.
--  * LoyaltyLedger: the points truth (earn | redeem | expire |
--    adjust | referral_reward). Positive lots carry
--    remainingPoints for FIFO consumption + expiry.
--  * Customer.loyaltyBalanceCache: the ledger's read cache,
--    maintained ONLY by LoyaltyService inside the same DB
--    transaction as the ledger write. May go negative after a
--    refund clawback (documented program rule).
--  * Order.referrerCustomerId: the resolved referrer behind the
--    presented referralCode, stamped by
--    PromotionsService.stampOrder from the evaluation.
--  * Exactly-once claims are PARTIAL unique indexes (Prisma
--    cannot express them in the schema): one earn per order,
--    one referral_reward points entry per order, one
--    referral_reward coupon per (org, sourceRef = order id).
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy. The loyalty_points_sweep job needs
-- per-org enablement after deploy.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "loyaltyBalanceCache" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "referrerCustomerId" TEXT;

-- CreateTable
CREATE TABLE "LoyaltySetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "earnPointsPer1000Minor" INTEGER NOT NULL DEFAULT 1,
    "redeemValueMinorPerPoint" INTEGER NOT NULL DEFAULT 100,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "maxRedeemSharePct" INTEGER,
    "pointsExpiryDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralRewardSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rewardType" TEXT NOT NULL DEFAULT 'points',
    "rewardPoints" INTEGER,
    "couponPercent" INTEGER,
    "rewardMinOrderMinor" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralRewardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deltaPoints" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "orderId" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "remainingPoints" INTEGER,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltySetting_organizationId_key" ON "LoyaltySetting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralRewardSetting_organizationId_key" ON "ReferralRewardSetting"("organizationId");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_organizationId_customerId_createdAt_idx" ON "LoyaltyLedger"("organizationId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_organizationId_orderId_idx" ON "LoyaltyLedger"("organizationId", "orderId");

-- AddForeignKey
ALTER TABLE "LoyaltySetting" ADD CONSTRAINT "LoyaltySetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralRewardSetting" ADD CONSTRAINT "ReferralRewardSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyLedger" ADD CONSTRAINT "LoyaltyLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AB1 exactly-once claims (partial unique indexes — raw SQL by
-- design; prisma migrate diff will report them as drift noise,
-- like the older hand-written indexes noted in GB8).
CREATE UNIQUE INDEX "LoyaltyLedger_earn_once_per_order" ON "LoyaltyLedger" ("orderId") WHERE "reason" = 'earn' AND "orderId" IS NOT NULL;
CREATE UNIQUE INDEX "LoyaltyLedger_referral_reward_once_per_order" ON "LoyaltyLedger" ("orderId") WHERE "reason" = 'referral_reward' AND "orderId" IS NOT NULL;
CREATE UNIQUE INDEX "StoreDiscount_referral_reward_once_per_order" ON "StoreDiscount" ("organizationId", "sourceRef") WHERE "origin" = 'referral_reward' AND "sourceRef" IS NOT NULL;
