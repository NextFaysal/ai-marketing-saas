-- GB5 (GC14 Courier Ops): booking-time charge on CourierShipment
-- (chargeMinor — the charge the provider itself returned at
-- booking; null whenever it returned none, never estimated) and
-- the CourierShipmentEvent history table (status transitions with
-- the provider's verbatim rawStatus, provider errors, staff
-- manual updates/notes). The event log starts at GC14 — there is
-- NO backfill of historical statuses.
-- All additive: existing rows keep chargeMinor = null.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "CourierShipment" ADD COLUMN "chargeMinor" BIGINT;

-- CreateTable
CREATE TABLE "CourierShipmentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT,
    "rawStatus" TEXT,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierShipmentEvent_organizationId_shipmentId_createdAt_idx" ON "CourierShipmentEvent"("organizationId", "shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierShipmentEvent_shipmentId_kind_createdAt_idx" ON "CourierShipmentEvent"("shipmentId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "CourierShipmentEvent" ADD CONSTRAINT "CourierShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "CourierShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
