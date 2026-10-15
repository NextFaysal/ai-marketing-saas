-- CreateTable
CREATE TABLE "CourierNdrIncident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'customer_unreachable',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "customerFeedback" TEXT,
    "rescheduleDate" TIMESTAMP(3),
    "notes" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "actionTaken" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierNdrIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierNdrIncident_organizationId_status_idx" ON "CourierNdrIncident"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CourierNdrIncident_organizationId_shipmentId_idx" ON "CourierNdrIncident"("organizationId", "shipmentId");

-- CreateIndex
CREATE INDEX "CourierNdrIncident_organizationId_orderId_idx" ON "CourierNdrIncident"("organizationId", "orderId");
