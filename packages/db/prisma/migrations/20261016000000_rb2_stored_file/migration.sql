-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_key_key" ON "StoredFile"("key");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_idx" ON "StoredFile"("organizationId");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_status_idx" ON "StoredFile"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_surface_idx" ON "StoredFile"("organizationId", "surface");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
