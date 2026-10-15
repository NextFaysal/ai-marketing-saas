-- EC18 (Branded Tracking + Delivery Slots + Checkout Trust):
-- DeliverySlot table, Order delivery slot/date columns, and the
-- StorefrontSetting tracking/trust fields. All additive.
-- NOT run on any real DB from the build sandbox; required at
-- deploy.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "deliverySlotId" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryDate" TEXT;

-- CreateIndex
CREATE INDEX "Order_organizationId_deliverySlotId_deliveryDate_idx" ON "Order"("organizationId", "deliverySlotId", "deliveryDate");

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "trackingPageEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontSetting" ADD COLUMN "returnPolicyText" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "deliveryPromiseText" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "supportPhone" TEXT;

-- CreateTable
CREATE TABLE "DeliverySlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "districtScope" JSONB,
    "capacityPerDay" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliverySlot_organizationId_active_idx" ON "DeliverySlot"("organizationId", "active");
