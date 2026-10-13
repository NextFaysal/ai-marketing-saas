-- EC28 (Retention Pack): back-in-stock subscriptions, product
-- Q&A, wishlist price-drop alert bookkeeping, and the
-- customer/staff source marker on ReturnRequest. All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable: wishlist price-drop alert bookkeeping (EC28)
ALTER TABLE "WishlistItem" ADD COLUMN "lastNotifiedPriceMinor" BIGINT;
ALTER TABLE "WishlistItem" ADD COLUMN "lastAlertStatus" TEXT;
ALTER TABLE "WishlistItem" ADD COLUMN "lastAlertAt" TIMESTAMP(3);

-- AlterTable: who opened a return request (EC28 self-service RMA)
ALTER TABLE "ReturnRequest" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE "ReturnRequest" ADD COLUMN "requestType" TEXT;

-- CreateTable
CREATE TABLE "StockAlertSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantSku" TEXT,
    "phone" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "StockAlertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockAlertSubscription_organizationId_productId_status_idx" ON "StockAlertSubscription"("organizationId", "productId", "status");
CREATE INDEX "StockAlertSubscription_organizationId_phone_idx" ON "StockAlertSubscription"("organizationId", "phone");

-- CreateTable
CREATE TABLE "ProductQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answeredById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ProductQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductQuestion_organizationId_productId_status_idx" ON "ProductQuestion"("organizationId", "productId", "status");
CREATE INDEX "ProductQuestion_organizationId_status_createdAt_idx" ON "ProductQuestion"("organizationId", "status", "createdAt");
