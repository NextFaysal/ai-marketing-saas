-- GB7 (GC17 Promotions Completion + GC18 Tracking Tags):
--  * StoreDiscount (the coupon model): first/repeat-customer
--    conditions (firstOrderOnly / repeatCustomerOnly), a
--    per-customer usage cap counted from GB3 couponCode order
--    stamps (perCustomerLimit), a maximum order value
--    (maxOrderMinor), product/category exclusion lists (ANY
--    excluded line refuses the coupon in v1) and a provenance
--    link (sourceRef) for system-issued coupons.
--  * Order.appliedDiscounts: the evaluator's applied-discount
--    list stamped at placement by PromotionsService.stampOrder
--    ([{promotionId?, couponCode?, kind, name, discountMinor}])
--    — the promotions performance report reads ONLY this.
--  * AbandonedCouponSetting: per-org recovery-coupon template
--    (default OFF — recovery sends unchanged while off). When
--    on, a staff recovery send issues a REAL StoreDiscount row
--    with origin "abandoned_recovery" and sourceRef = the
--    abandoned checkout / native cart id.
--  * StorefrontSetting: the merchant's OWN tracking ids
--    (ga4MeasurementId, gtmContainerId, googleAdsId,
--    googleAdsConversionLabel, searchConsoleVerification) —
--    nullable; null renders nothing on the shop.
-- All additive: existing rows keep the new columns NULL / default.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "StoreDiscount" ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreDiscount" ADD COLUMN "repeatCustomerOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreDiscount" ADD COLUMN "perCustomerLimit" INTEGER;
ALTER TABLE "StoreDiscount" ADD COLUMN "maxOrderMinor" BIGINT;
ALTER TABLE "StoreDiscount" ADD COLUMN "excludedProductIds" JSONB;
ALTER TABLE "StoreDiscount" ADD COLUMN "excludedCategoryIds" JSONB;
ALTER TABLE "StoreDiscount" ADD COLUMN "sourceRef" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "appliedDiscounts" JSONB;

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "ga4MeasurementId" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "gtmContainerId" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "googleAdsId" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "googleAdsConversionLabel" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "searchConsoleVerification" TEXT;

-- CreateTable
CREATE TABLE "AbandonedCouponSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'percent',
    "value" INTEGER NOT NULL DEFAULT 0,
    "expiryHours" INTEGER NOT NULL DEFAULT 72,
    "minOrderMinor" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedCouponSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedCouponSetting_organizationId_key" ON "AbandonedCouponSetting"("organizationId");

-- AddForeignKey
ALTER TABLE "AbandonedCouponSetting" ADD CONSTRAINT "AbandonedCouponSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
