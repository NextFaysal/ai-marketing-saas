-- EC33 (inventory intelligence): org-level InventorySetting —
-- today just leadTimeDays for the velocity reorder mode.
-- All additive.
-- NOT run on any real DB from the build sandbox; required at
-- deploy.

-- CreateTable
CREATE TABLE "InventorySetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventorySetting_organizationId_key" ON "InventorySetting"("organizationId");
