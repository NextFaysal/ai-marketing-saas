-- ON10 (Print & Document Center): bulk print jobs over
-- 1–100 orders (invoices / labels / packing slips / delivery
-- challans) with an honest per-job record, plus the per-org
-- print template customization row.
-- PrintJob is the job's record only — the generated PDF is
-- streamed to the caller and never stored. failedOrderIds
-- names the orders that could not be printed inside an
-- otherwise-done job (e.g. a label for an order with no
-- courier shipment); a generation failure lands as
-- status = 'failed' + the Bengali error instead.
-- PrintTemplateSetting is ONE row per org (unique
-- organizationId), lazy-upserted; no row = the pre-ON10
-- default documents.
-- All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderIds" JSONB NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "failedOrderIds" JSONB,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintTemplateSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "footerText" TEXT,
    "termsText" TEXT,
    "invoiceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintTemplateSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintJob_organizationId_createdAt_idx" ON "PrintJob"("organizationId", "createdAt");
CREATE UNIQUE INDEX "PrintTemplateSetting_organizationId_key" ON "PrintTemplateSetting"("organizationId");
