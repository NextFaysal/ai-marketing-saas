-- AB8 (AX21–AX27): platform & developer — merchant developer API
-- keys (MerchantApiKey), per-shop custom CSS/JS (StorefrontSetting),
-- white-label flag (Organization.whiteLabel), merchant data tools
-- (DataExport + OrgBackupPreference), Google SSO state (SsoLoginState
-- + LoginEvent.method), and the device-hash fraud signal
-- (Order.deviceHash). Additive only: new tables + nullable/defaulted
-- columns + indexes.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "whiteLabel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deviceHash" TEXT;

-- AlterTable
ALTER TABLE "LoginEvent" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'password';

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN     "customCss" TEXT,
ADD COLUMN     "customJs" TEXT,
ADD COLUMN     "customJsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MerchantApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileRef" TEXT,
    "sizeBytes" INTEGER,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgBackupPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastBackupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgBackupPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoLoginState" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoLoginState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantApiKey_keyHash_key" ON "MerchantApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "MerchantApiKey_organizationId_createdAt_idx" ON "MerchantApiKey"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DataExport_organizationId_createdAt_idx" ON "DataExport"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DataExport_organizationId_kind_status_createdAt_idx" ON "DataExport"("organizationId", "kind", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgBackupPreference_organizationId_key" ON "OrgBackupPreference"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoLoginState_tokenHash_key" ON "SsoLoginState"("tokenHash");

-- CreateIndex
CREATE INDEX "SsoLoginState_userId_kind_idx" ON "SsoLoginState"("userId", "kind");

-- CreateIndex
CREATE INDEX "SsoLoginState_expiresAt_idx" ON "SsoLoginState"("expiresAt");

-- AddForeignKey
ALTER TABLE "MerchantApiKey" ADD CONSTRAINT "MerchantApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgBackupPreference" ADD CONSTRAINT "OrgBackupPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoLoginState" ADD CONSTRAINT "SsoLoginState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

