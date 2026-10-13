-- CC3/CC4 (Connect Center, Own App vs Platform App): the tenant's
-- own developer-app configs (TenantAppConfig) + the appSource
-- marker on Integration and SocialAccount. All additive — every
-- existing Integration/SocialAccount row reads appSource
-- "platform", which is exactly how those connections were made.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013210000_cc2_multi_account).

-- CreateTable
CREATE TABLE "TenantAppConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantAppConfig_organizationId_idx" ON "TenantAppConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAppConfig_organizationId_platform_key" ON "TenantAppConfig"("organizationId", "platform");

-- AddForeignKey
ALTER TABLE "TenantAppConfig" ADD CONSTRAINT "TenantAppConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "appSource" TEXT NOT NULL DEFAULT 'platform';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "appSource" TEXT NOT NULL DEFAULT 'platform';
