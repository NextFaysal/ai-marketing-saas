-- Milestones 25-28: Admin Console (all phases' tables in one migration)
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN "adminTier" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "totpSecretEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Organization" ADD COLUMN "aiDailyLimitOverride" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "broadcastCapOverride" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "seatLimit" INTEGER;
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
    "body" TEXT NOT NULL, "authorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminNote_targetType_targetId_idx" ON "AdminNote"("targetType", "targetId");
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL, "value" JSONB NOT NULL, "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "OrgFeatureFlag" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "OrgFeatureFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrgFeatureFlag_organizationId_key_key" ON "OrgFeatureFlag"("organizationId", "key");
CREATE INDEX "OrgFeatureFlag_organizationId_idx" ON "OrgFeatureFlag"("organizationId");
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SaasPayment" (
    "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT', "method" TEXT NOT NULL, "reference" TEXT,
    "periodStart" TIMESTAMP(3), "periodEnd" TIMESTAMP(3), "recordedById" TEXT NOT NULL,
    "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaasPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaasPayment_organizationId_idx" ON "SaasPayment"("organizationId");
