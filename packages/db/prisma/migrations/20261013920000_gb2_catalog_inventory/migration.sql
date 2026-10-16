-- GB2 (G2 Catalog & Inventory Completion, GC6 + GC7): Brand
-- registry + Product.brandId / free-shipping flag, InventorySetting
-- backorder + reservation window, StockReservation, and the
-- out-of-stock alert stamps on Product / ProductVariant.
-- All additive: new columns carry defaults or are nullable; the
-- two new tables are fresh.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "brandId" TEXT,
ADD COLUMN "freeShipping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastOosNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "lastOosNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InventorySetting" ADD COLUMN "allowBackorder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reserveMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionRef" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_slug_key" ON "Brand"("organizationId", "slug");
CREATE INDEX "Brand_organizationId_idx" ON "Brand"("organizationId");
CREATE INDEX "StockReservation_organizationId_sessionRef_state_idx" ON "StockReservation"("organizationId", "sessionRef", "state");
CREATE INDEX "StockReservation_organizationId_productId_variantId_state_expiresAt_idx" ON "StockReservation"("organizationId", "productId", "variantId", "state", "expiresAt");
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
