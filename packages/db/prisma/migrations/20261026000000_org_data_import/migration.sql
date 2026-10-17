-- ORG16 (Organization Next OB5): org bundle import/restore job
-- record. Mirrors "DataExport" (AB8): string status vocabulary,
-- the real error recorded on the row, org cascade delete.
-- CreateTable
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "fileName" TEXT,
    "sourceOrgName" TEXT,
    "report" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataImport_organizationId_createdAt_idx" ON "DataImport"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
