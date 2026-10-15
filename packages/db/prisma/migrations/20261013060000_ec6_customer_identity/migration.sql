-- EC6 (Customers Two-Way): CustomerStoreIdentity table.
-- All additive: one new table only.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "CustomerStoreIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "emailSnapshot" TEXT,
    "phoneSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerStoreIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerStoreIdentity_storeId_externalId_key" ON "CustomerStoreIdentity"("storeId", "externalId");
CREATE INDEX "CustomerStoreIdentity_organizationId_customerId_idx" ON "CustomerStoreIdentity"("organizationId", "customerId");
CREATE INDEX "CustomerStoreIdentity_organizationId_storeId_idx" ON "CustomerStoreIdentity"("organizationId", "storeId");

-- AddForeignKey
ALTER TABLE "CustomerStoreIdentity" ADD CONSTRAINT "CustomerStoreIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerStoreIdentity" ADD CONSTRAINT "CustomerStoreIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerStoreIdentity" ADD CONSTRAINT "CustomerStoreIdentity_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
