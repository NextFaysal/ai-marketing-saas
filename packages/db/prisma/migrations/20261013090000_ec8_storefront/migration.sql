-- EC8 (Native Storefront v2): StorefrontSetting, ShippingZone,
-- StoreCart + StoreCartItem. All additive: new tables only.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "StorefrontSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shopName" TEXT,
    "announcementText" TEXT,
    "showFeatured" BOOLEAN NOT NULL DEFAULT true,
    "showCategories" BOOLEAN NOT NULL DEFAULT true,
    "showSearch" BOOLEAN NOT NULL DEFAULT true,
    "metaDescription" TEXT,
    "featuredProductIds" JSONB,
    "domainVerifyToken" TEXT,
    "domainVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorefrontSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "districts" JSONB,
    "chargeMinor" BIGINT NOT NULL,
    "deliveryDays" INTEGER,
    "freeAboveMinor" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCartItem" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "includeBump" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontSetting_organizationId_key" ON "StorefrontSetting"("organizationId");
CREATE INDEX "ShippingZone_organizationId_active_position_idx" ON "ShippingZone"("organizationId", "active", "position");
CREATE UNIQUE INDEX "StoreCart_token_key" ON "StoreCart"("token");
CREATE INDEX "StoreCart_organizationId_status_updatedAt_idx" ON "StoreCart"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "StoreCartItem_cartId_productId_variantId_key" ON "StoreCartItem"("cartId", "productId", "variantId");
CREATE INDEX "StoreCartItem_cartId_idx" ON "StoreCartItem"("cartId");
CREATE INDEX "StoreCartItem_productId_idx" ON "StoreCartItem"("productId");

-- AddForeignKey
ALTER TABLE "StorefrontSetting" ADD CONSTRAINT "StorefrontSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCart" ADD CONSTRAINT "StoreCart_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCartItem" ADD CONSTRAINT "StoreCartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "StoreCart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCartItem" ADD CONSTRAINT "StoreCartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCartItem" ADD CONSTRAINT "StoreCartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
