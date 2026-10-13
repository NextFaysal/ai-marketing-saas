-- EC30 (Delivery Pricing Engine v2): weight-slab shipping rate
-- rules, pickup points, and the order delivery stamps. All
-- additive. ShippingZone.freeAboveMinor already exists (EC8) —
-- this batch only starts STAMPING its effect on orders.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable: EC30 delivery stamps on orders
ALTER TABLE "Order" ADD COLUMN "deliveryMethod" TEXT NOT NULL DEFAULT 'home';
ALTER TABLE "Order" ADD COLUMN "pickupPointId" TEXT;
ALTER TABLE "Order" ADD COLUMN "freeShippingApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "freeShippingZoneId" TEXT;
ALTER TABLE "Order" ADD COLUMN "shippingRateRuleId" TEXT;

-- CreateTable
CREATE TABLE "ShippingRateRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shippingZoneId" TEXT,
    "minWeightGrams" INTEGER,
    "maxWeightGrams" INTEGER,
    "chargeMinor" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRateRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShippingRateRule_organizationId_active_priority_idx" ON "ShippingRateRule"("organizationId", "active", "priority");

-- CreateTable
CREATE TABLE "PickupPoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "phone" TEXT,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PickupPoint_organizationId_active_idx" ON "PickupPoint"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "ShippingRateRule" ADD CONSTRAINT "ShippingRateRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupPoint" ADD CONSTRAINT "PickupPoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
