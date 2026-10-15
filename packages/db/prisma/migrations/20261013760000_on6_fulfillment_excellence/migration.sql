-- ON6 (Fulfillment Excellence): per-org fulfilment SLA settings,
-- pick waves (+ their order rows), recorded delivery attempts,
-- and stuck-parcel escalation stamps on CourierShipment.
-- All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "CourierShipment" ADD COLUMN "escalatedAt" TIMESTAMP(3);
ALTER TABLE "CourierShipment" ADD COLUMN "escalatedForStatus" TEXT;

-- CreateTable
CREATE TABLE "FulfillmentSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "confirmToPackHours" INTEGER NOT NULL DEFAULT 24,
    "packToHandoverHours" INTEGER NOT NULL DEFAULT 24,
    "stuckDays" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickWave" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PickWave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickWaveOrder" (
    "id" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pickedAt" TIMESTAMP(3),
    "pickedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickWaveOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "rescheduleDate" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentSetting_organizationId_key" ON "FulfillmentSetting"("organizationId");
CREATE INDEX "PickWave_organizationId_status_createdAt_idx" ON "PickWave"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "PickWaveOrder_waveId_orderId_key" ON "PickWaveOrder"("waveId", "orderId");
CREATE INDEX "PickWaveOrder_waveId_idx" ON "PickWaveOrder"("waveId");
CREATE INDEX "PickWaveOrder_orderId_idx" ON "PickWaveOrder"("orderId");
CREATE INDEX "DeliveryAttempt_organizationId_orderId_idx" ON "DeliveryAttempt"("organizationId", "orderId");
CREATE INDEX "DeliveryAttempt_organizationId_shipmentId_idx" ON "DeliveryAttempt"("organizationId", "shipmentId");

-- AddForeignKey
ALTER TABLE "FulfillmentSetting" ADD CONSTRAINT "FulfillmentSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickWave" ADD CONSTRAINT "PickWave_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickWaveOrder" ADD CONSTRAINT "PickWaveOrder_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "PickWave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickWaveOrder" ADD CONSTRAINT "PickWaveOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "CourierShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
