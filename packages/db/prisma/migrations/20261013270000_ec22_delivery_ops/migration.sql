-- EC22 (Delivery Ops): CourierRule, Rider, DeliveryAssignment;
-- CourierShipment.courierRuleId (which rule auto-selected the
-- courier; null = explicit choice/no match); Integration
-- .trackingUrlTemplate (non-secret per-account tracking URL
-- template, outside the encrypted credential blob).
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy.

-- CreateTable
CREATE TABLE "CourierRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "courierAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "note" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierRule_organizationId_active_priority_idx" ON "CourierRule"("organizationId", "active", "priority");
CREATE INDEX "Rider_organizationId_active_idx" ON "Rider"("organizationId", "active");
CREATE INDEX "DeliveryAssignment_organizationId_riderId_status_idx" ON "DeliveryAssignment"("organizationId", "riderId", "status");
CREATE INDEX "DeliveryAssignment_organizationId_orderId_idx" ON "DeliveryAssignment"("organizationId", "orderId");
CREATE INDEX "DeliveryAssignment_organizationId_assignedAt_idx" ON "DeliveryAssignment"("organizationId", "assignedAt");

-- AddForeignKey
ALTER TABLE "CourierRule" ADD CONSTRAINT "CourierRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAssignment" ADD CONSTRAINT "DeliveryAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAssignment" ADD CONSTRAINT "DeliveryAssignment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CourierShipment" ADD COLUMN "courierRuleId" TEXT;
ALTER TABLE "Integration" ADD COLUMN "trackingUrlTemplate" TEXT;
