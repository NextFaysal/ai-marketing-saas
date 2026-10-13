-- EC24 (Product Model Expansion): pre-order fields, digital
-- product fields, subscription plan fields + wholesale tiers on
-- Product; Customer.isWholesale; CustomerSubscription table;
-- OrderItem.isPreorder; Order digital/wholesale/subscription
-- bookkeeping columns.
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "preorderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "preorderReleaseDate" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "preorderLimit" INTEGER;
ALTER TABLE "Product" ADD COLUMN "digital" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "digitalFileUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN "digitalAccessLimit" INTEGER;
ALTER TABLE "Product" ADD COLUMN "subscriptionEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "subscriptionIntervalDays" INTEGER;
ALTER TABLE "Product" ADD COLUMN "subscriptionDiscountPercent" INTEGER;
ALTER TABLE "Product" ADD COLUMN "wholesaleTiers" JSONB;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "isWholesale" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "isPreorder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "digitalAccessCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "digitalLastAccessedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "wholesaleBreakdown" JSONB;
ALTER TABLE "Order" ADD COLUMN "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "CustomerSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountPercent" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastOrderId" TEXT,
    "createdFromOrderId" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerSubscription_organizationId_status_nextRunAt_idx" ON "CustomerSubscription"("organizationId", "status", "nextRunAt");
CREATE INDEX "CustomerSubscription_organizationId_customerId_idx" ON "CustomerSubscription"("organizationId", "customerId");

-- AddForeignKey
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSubscription" ADD CONSTRAINT "CustomerSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
