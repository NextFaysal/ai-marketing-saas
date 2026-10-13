-- EC23 (Tax & Accounting): TaxSetting (per-org VAT identity +
-- default rate in basis points), InvoiceCounter (fiscal invoice
-- sequence per BD fiscal year Jul–Jun), Product.taxRateBps
-- override, Order.invoiceNumber (+ per-org unique) and
-- Order.taxBreakdown (per-rate snapshot from checkout).
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy.

-- CreateTable
CREATE TABLE "TaxSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT,
    "tin" TEXT,
    "binVatNo" TEXT,
    "defaultVatBps" INTEGER,
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxSetting_organizationId_key" ON "TaxSetting"("organizationId");
CREATE UNIQUE INDEX "InvoiceCounter_organizationId_fiscalYear_key" ON "InvoiceCounter"("organizationId", "fiscalYear");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "taxRateBps" INTEGER;
ALTER TABLE "Order" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "taxBreakdown" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_invoiceNumber_key" ON "Order"("organizationId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "TaxSetting" ADD CONSTRAINT "TaxSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
