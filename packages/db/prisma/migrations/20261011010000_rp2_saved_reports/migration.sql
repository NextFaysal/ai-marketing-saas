-- Reports Advanced RP2: tenant-built saved report definitions.
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dimension" TEXT NOT NULL,
    "rangePreset" TEXT NOT NULL DEFAULT 'last_30d',
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedReport_organizationId_idx" ON "SavedReport"("organizationId");
