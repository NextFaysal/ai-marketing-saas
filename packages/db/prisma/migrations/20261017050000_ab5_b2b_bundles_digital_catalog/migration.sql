-- AB5 (AX7–AX10): B2B customer groups + price lists + quotes +
-- net-terms stamps, mix-and-match bundle slots + cart picks,
-- digital depth (per-item access counters, license-key pools,
-- signed-download config), Meta catalog sync lifecycle
-- (autoSync flag, Page/IG linkage fields, sync queue).
-- Additive only: new tables + nullable/defaulted columns.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "digitalDeliveryType" TEXT NOT NULL DEFAULT 'file',
ADD COLUMN     "digitalLinkExpiryHours" INTEGER;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "creditTermsDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "groupId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "creditDueDate" TIMESTAMP(3),
ADD COLUMN     "priceListBreakdown" JSONB;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "digitalAccessCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "digitalLastAccessedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CatalogRecord" ADD COLUMN     "autoSync" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagramId" TEXT,
ADD COLUMN     "instagramName" TEXT,
ADD COLUMN     "pageId" TEXT,
ADD COLUMN     "pageName" TEXT;

-- AlterTable
ALTER TABLE "StoreCartBundle" ADD COLUMN     "picks" JSONB;

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "priceMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "walkinName" TEXT,
    "walkinPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "expiresAt" TIMESTAMP(3),
    "lines" JSONB NOT NULL,
    "deliveryChargeMinor" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "convertedOrderId" TEXT,
    "publicTokenHash" TEXT,
    "sentVia" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keySealed" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "assignedOrderId" TEXT,
    "assignedItemId" TEXT,
    "unitIndex" INTEGER,
    "assignedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "importBatch" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSyncRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "retailerId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleSlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "chooseQty" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL,
    "sourceRef" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerGroup_organizationId_idx" ON "CustomerGroup"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_organizationId_name_key" ON "CustomerGroup"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_groupId_key" ON "PriceList"("groupId");

-- CreateIndex
CREATE INDEX "PriceList_organizationId_idx" ON "PriceList"("organizationId");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_idx" ON "PriceListItem"("priceListId");

-- CreateIndex
CREATE INDEX "PriceListItem_productId_idx" ON "PriceListItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_variantId_key" ON "PriceListItem"("priceListId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_publicTokenHash_key" ON "Quote"("publicTokenHash");

-- CreateIndex
CREATE INDEX "Quote_organizationId_status_createdAt_idx" ON "Quote"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_organizationId_customerId_idx" ON "Quote"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_number_key" ON "Quote"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteCounter_organizationId_key" ON "QuoteCounter"("organizationId");

-- CreateIndex
CREATE INDEX "LicenseKey_organizationId_productId_status_idx" ON "LicenseKey"("organizationId", "productId", "status");

-- CreateIndex
CREATE INDEX "LicenseKey_organizationId_assignedOrderId_idx" ON "LicenseKey"("organizationId", "assignedOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_organizationId_productId_keyHash_key" ON "LicenseKey"("organizationId", "productId", "keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_assignedItemId_unitIndex_key" ON "LicenseKey"("assignedItemId", "unitIndex");

-- CreateIndex
CREATE INDEX "CatalogSyncRecord_organizationId_catalogId_status_createdAt_idx" ON "CatalogSyncRecord"("organizationId", "catalogId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogSyncRecord_organizationId_productId_idx" ON "CatalogSyncRecord"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "BundleSlot_organizationId_bundleId_sortOrder_idx" ON "BundleSlot"("organizationId", "bundleId", "sortOrder");

-- CreateIndex
CREATE INDEX "BundleSlot_bundleId_idx" ON "BundleSlot"("bundleId");

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleSlot" ADD CONSTRAINT "BundleSlot_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

