-- EC10 (Abandoned Checkout for Connected Stores):
-- AbandonedStoreCheckout table. All additive: one new table only.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "AbandonedStoreCheckout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalCheckoutId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "items" JSONB,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "checkoutUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "abandonedAt" TIMESTAMP(3) NOT NULL,
    "recoveredOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedStoreCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedStoreCheckout_storeId_externalCheckoutId_key" ON "AbandonedStoreCheckout"("storeId", "externalCheckoutId");
CREATE INDEX "AbandonedStoreCheckout_organizationId_abandonedAt_idx" ON "AbandonedStoreCheckout"("organizationId", "abandonedAt");
CREATE INDEX "AbandonedStoreCheckout_organizationId_status_idx" ON "AbandonedStoreCheckout"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "AbandonedStoreCheckout" ADD CONSTRAINT "AbandonedStoreCheckout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbandonedStoreCheckout" ADD CONSTRAINT "AbandonedStoreCheckout_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
