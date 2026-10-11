-- Milestone 75 (Business Command Center): operational profile layer.
ALTER TABLE "BusinessProfile" ADD COLUMN "address" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "city" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "businessHours" JSONB;
ALTER TABLE "BusinessProfile" ADD COLUMN "deliveryChargeInsideMinor" BIGINT;
ALTER TABLE "BusinessProfile" ADD COLUMN "deliveryChargeOutsideMinor" BIGINT;
ALTER TABLE "BusinessProfile" ADD COLUMN "freeDeliveryAboveMinor" BIGINT;
ALTER TABLE "BusinessProfile" ADD COLUMN "deliveryDaysInside" INTEGER;
ALTER TABLE "BusinessProfile" ADD COLUMN "deliveryDaysOutside" INTEGER;
ALTER TABLE "BusinessProfile" ADD COLUMN "codAvailable" BOOLEAN;
ALTER TABLE "BusinessProfile" ADD COLUMN "minOrderMinor" BIGINT;
ALTER TABLE "BusinessProfile" ADD COLUMN "bkashNumber" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "nagadNumber" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "paymentNote" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "advancePaymentPercent" INTEGER;
ALTER TABLE "BusinessProfile" ADD COLUMN "returnWindowDays" INTEGER;
