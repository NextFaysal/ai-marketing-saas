-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "attribution" TEXT;

-- CreateTable
CREATE TABLE "OrgStockConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pexels',
    "encryptedData" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgStockConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialCoachDigest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "weekStart" VARCHAR(10) NOT NULL,
    "payload" JSONB NOT NULL,
    "narrationSource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialCoachDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgStockConfig_organizationId_key" ON "OrgStockConfig"("organizationId");

-- CreateIndex
CREATE INDEX "OrgStockConfig_organizationId_idx" ON "OrgStockConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialCoachDigest_organizationId_weekStart_key" ON "SocialCoachDigest"("organizationId", "weekStart");

-- CreateIndex
CREATE INDEX "SocialCoachDigest_organizationId_idx" ON "SocialCoachDigest"("organizationId");

-- AddForeignKey
ALTER TABLE "OrgStockConfig" ADD CONSTRAINT "OrgStockConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialCoachDigest" ADD CONSTRAINT "SocialCoachDigest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
