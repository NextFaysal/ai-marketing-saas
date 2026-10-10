-- Milestone 39 (Admin Phase A3): Billing & Money++
-- PlanCheckout: gateway choice, applied credit/discount audit fields.
ALTER TABLE "PlanCheckout" ADD COLUMN "gateway" TEXT NOT NULL DEFAULT 'sslcommerz';
ALTER TABLE "PlanCheckout" ADD COLUMN "creditAppliedMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "PlanCheckout" ADD COLUMN "discountMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "PlanCheckout" ADD COLUMN "couponCode" TEXT;

-- Organization: proration/manual credit balance (minor units).
ALTER TABLE "Organization" ADD COLUMN "creditMinor" BIGINT NOT NULL DEFAULT 0;

-- SaasPayment: refund tracking (partial refunds allowed; access
-- changes stay explicit admin actions, never silent side effects).
ALTER TABLE "SaasPayment" ADD COLUMN "refundedMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "SaasPayment" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "SaasPayment" ADD COLUMN "refundReason" TEXT;

-- Coupons + redemptions.
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "planScope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkoutId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");
CREATE INDEX "CouponRedemption_organizationId_idx" ON "CouponRedemption"("organizationId");
