-- EC7 (Discounts & Promotions): StoreDiscount + StoreDiscountSync.
-- All additive: two new tables only. NOT the SaaS-plan Coupon table.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "StoreDiscount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "minOrderMinor" BIGINT,
    "scopeType" TEXT NOT NULL DEFAULT 'all',
    "scopeIds" JSONB,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreDiscountSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreDiscountSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreDiscount_organizationId_code_key" ON "StoreDiscount"("organizationId", "code");
CREATE INDEX "StoreDiscount_organizationId_active_idx" ON "StoreDiscount"("organizationId", "active");
CREATE UNIQUE INDEX "StoreDiscountSync_discountId_storeId_key" ON "StoreDiscountSync"("discountId", "storeId");
CREATE INDEX "StoreDiscountSync_organizationId_storeId_idx" ON "StoreDiscountSync"("organizationId", "storeId");

-- AddForeignKey
ALTER TABLE "StoreDiscount" ADD CONSTRAINT "StoreDiscount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreDiscountSync" ADD CONSTRAINT "StoreDiscountSync_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "StoreDiscount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreDiscountSync" ADD CONSTRAINT "StoreDiscountSync_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
