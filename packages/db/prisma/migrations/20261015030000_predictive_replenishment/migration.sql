-- AlterTable
ALTER TABLE "Product" ADD COLUMN "replenishmentDays" INTEGER,
ADD COLUMN "replenishmentReminderText" TEXT;

-- CreateTable
CREATE TABLE "PredictiveReplenishment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "replenishmentDays" INTEGER NOT NULL,
    "predictedDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastRemindedAt" TIMESTAMP(3),
    "reorderOrderId" TEXT,
    "discountCode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictiveReplenishment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PredictiveReplenishment_organizationId_status_idx" ON "PredictiveReplenishment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PredictiveReplenishment_organizationId_predictedDate_idx" ON "PredictiveReplenishment"("organizationId", "predictedDate");

-- CreateIndex
CREATE INDEX "PredictiveReplenishment_organizationId_customerPhone_idx" ON "PredictiveReplenishment"("organizationId", "customerPhone");
