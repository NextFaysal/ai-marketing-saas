-- EC29 (bundles & gifts): fixed-price Bundle sets (items Json —
-- distinct from the EC4 BundleItem stock composition), cart
-- bundle lines, Order gift stamps (gift promotion id / skipped
-- flag / wrap fee / gift message), OrderItem gift + bundle
-- stamps, StorefrontSetting gift-wrap config. All additive.
-- NOT run on any real DB from the build sandbox; required at
-- deploy.

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "items" JSONB NOT NULL,
    "bundlePriceMinor" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bundle_organizationId_active_sortOrder_idx" ON "Bundle"("organizationId", "active", "sortOrder");

-- CreateTable
CREATE TABLE "StoreCartBundle" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCartBundle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreCartBundle_cartId_bundleId_key" ON "StoreCartBundle"("cartId", "bundleId");
CREATE INDEX "StoreCartBundle_cartId_idx" ON "StoreCartBundle"("cartId");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "giftPromotionId" TEXT;
ALTER TABLE "Order" ADD COLUMN "giftSkipped" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "giftWrapMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "giftMessage" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderItem" ADD COLUMN "bundleId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "bundleName" TEXT;

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "giftWrapEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorefrontSetting" ADD COLUMN "giftWrapFeeMinor" BIGINT;
