-- EC9 (Fulfillment, Returns & RMA): Fulfillment + ReturnRequest
-- tables. All additive: two new tables only.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "courierShipmentId" TEXT,
    "courierProvider" TEXT,
    "trackingCode" TEXT,
    "items" JSONB NOT NULL,
    "createdById" TEXT,
    "storePushEnqueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "items" JSONB,
    "resolution" TEXT,
    "refundAmountMinor" BIGINT,
    "restockDecision" TEXT NOT NULL DEFAULT 'pending',
    "staffNote" TEXT,
    "token" TEXT NOT NULL,
    "returnShipmentId" TEXT,
    "exchangeOrderId" TEXT,
    "restockAppliedAt" TIMESTAMP(3),
    "notificationStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fulfillment_organizationId_orderId_idx" ON "Fulfillment"("organizationId", "orderId");
CREATE INDEX "Fulfillment_organizationId_status_createdAt_idx" ON "Fulfillment"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "ReturnRequest_token_key" ON "ReturnRequest"("token");
CREATE INDEX "ReturnRequest_organizationId_orderId_idx" ON "ReturnRequest"("organizationId", "orderId");
CREATE INDEX "ReturnRequest_organizationId_status_createdAt_idx" ON "ReturnRequest"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
