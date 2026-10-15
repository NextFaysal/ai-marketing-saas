-- CreateTable
CREATE TABLE "CourierDisbursementBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalCollectedMinor" BIGINT NOT NULL DEFAULT 0,
    "totalFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "netDisbursedMinor" BIGINT NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "discrepancyCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierDisbursementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierDisbursementItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "orderId" TEXT,
    "consignmentId" TEXT,
    "systemCodMinor" BIGINT NOT NULL DEFAULT 0,
    "courierCollectedMinor" BIGINT NOT NULL DEFAULT 0,
    "courierFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "netPaidMinor" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "discrepancyMinor" BIGINT NOT NULL DEFAULT 0,
    "disputeStatus" TEXT NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierDisbursementItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierDisbursementBatch_organizationId_createdAt_idx" ON "CourierDisbursementBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierDisbursementBatch_organizationId_provider_idx" ON "CourierDisbursementBatch"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "CourierDisbursementItem_batchId_idx" ON "CourierDisbursementItem"("batchId");

-- CreateIndex
CREATE INDEX "CourierDisbursementItem_organizationId_trackingCode_idx" ON "CourierDisbursementItem"("organizationId", "trackingCode");

-- CreateIndex
CREATE INDEX "CourierDisbursementItem_organizationId_status_idx" ON "CourierDisbursementItem"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "CourierDisbursementItem" ADD CONSTRAINT "CourierDisbursementItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CourierDisbursementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
