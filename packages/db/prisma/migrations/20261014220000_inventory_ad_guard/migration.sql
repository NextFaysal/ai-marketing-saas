-- CreateTable
CREATE TABLE "InventoryAdGuardLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "campaignPlanId" TEXT,
    "campaignName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdGuardLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryAdGuardLog_organizationId_productId_idx" ON "InventoryAdGuardLog"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "InventoryAdGuardLog_organizationId_createdAt_idx" ON "InventoryAdGuardLog"("organizationId", "createdAt");
