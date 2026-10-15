-- EC26 (courier COD reconciliation): CourierShipment gains the
-- collected-COD truth (amount + when + which import recorded
-- it) — set ONLY by a reconciliation import or a staff
-- accept_sheet resolution, never by a delivered status alone.
-- Plus the import/line/profile tables: the merchant's own
-- settlement sheet is the only source; no courier API is
-- claimed. All additive.
-- NOT run on any real DB from the build sandbox; required at
-- deploy.

-- AlterTable
ALTER TABLE "CourierShipment" ADD COLUMN "codCollectedMinor" BIGINT;
ALTER TABLE "CourierShipment" ADD COLUMN "codCollectedAt" TIMESTAMP(3);
ALTER TABLE "CourierShipment" ADD COLUMN "codCollectionSource" TEXT;

-- CreateTable
CREATE TABLE "ReconciliationImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courierIntegrationId" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "notFoundCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationImport_organizationId_courierIntegrationId_createdAt_idx" ON "ReconciliationImport"("organizationId", "courierIntegrationId", "createdAt");
CREATE INDEX "ReconciliationImport_organizationId_fileHash_idx" ON "ReconciliationImport"("organizationId", "fileHash");

-- CreateTable
CREATE TABLE "ReconciliationLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawTrackingId" TEXT,
    "rawOrderRef" TEXT,
    "sheetAmountMinor" BIGINT,
    "sheetChargeMinor" BIGINT,
    "sheetStatus" TEXT,
    "matchedOrderId" TEXT,
    "matchedShipmentId" TEXT,
    "expectedMinor" BIGINT,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationLine_importId_outcome_idx" ON "ReconciliationLine"("importId", "outcome");
CREATE INDEX "ReconciliationLine_organizationId_matchedShipmentId_idx" ON "ReconciliationLine"("organizationId", "matchedShipmentId");

-- CreateTable
CREATE TABLE "ReconciliationProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courierIntegrationId" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationProfile_organizationId_courierIntegrationId_key" ON "ReconciliationProfile"("organizationId", "courierIntegrationId");
