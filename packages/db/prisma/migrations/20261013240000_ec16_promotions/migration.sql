-- EC16 (Promotions v2): Promotion table; Order promotion/referral
-- split columns (discountMinor stays the TOTAL merchandise
-- discount so existing totals/due math is unchanged); Customer
-- referralCode (tenant referral program); StorefrontSetting
-- referral discount config. All additive.
-- NOT run on any real DB from the build sandbox; required at
-- deploy.

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_organizationId_active_priority_idx" ON "Promotion"("organizationId", "active", "priority");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "promotionDiscountMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "promotionsApplied" JSONB;
ALTER TABLE "Order" ADD COLUMN "referralDiscountMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "referralCode" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_referralCode_key" ON "Customer"("organizationId", "referralCode");

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "referralDiscountPercent" INTEGER;
ALTER TABLE "StorefrontSetting" ADD COLUMN "referralMinSubtotalMinor" BIGINT;
