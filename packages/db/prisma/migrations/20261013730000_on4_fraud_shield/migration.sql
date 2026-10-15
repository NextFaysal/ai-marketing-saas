-- ON4 (Fraud Shield v2): persisted order risk assessment + review
-- hold + COD call bookkeeping on Order; per-org FraudShieldSetting;
-- org BlockedPhone list. All additive. Scalar-id style for the new
-- tables (org resolved in services, like the EC-era tables).
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "riskScore" INTEGER;
ALTER TABLE "Order" ADD COLUMN "riskBand" TEXT;
ALTER TABLE "Order" ADD COLUMN "riskReasons" JSONB;
ALTER TABLE "Order" ADD COLUMN "riskAssessedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "reviewHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "reviewHoldReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "reviewHeldAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "codCallAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "codLastCallAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "codLastCallOutcome" TEXT;

-- CreateTable
CREATE TABLE "FraudShieldSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoHoldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoHoldBand" TEXT NOT NULL DEFAULT 'high',
    "highValueMinor" BIGINT NOT NULL DEFAULT 500000,
    "burstCount" INTEGER NOT NULL DEFAULT 3,
    "burstWindowHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudShieldSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedPhone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedPhone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FraudShieldSetting_organizationId_key" ON "FraudShieldSetting"("organizationId");
CREATE UNIQUE INDEX "BlockedPhone_organizationId_phoneKey_key" ON "BlockedPhone"("organizationId", "phoneKey");
CREATE INDEX "BlockedPhone_organizationId_phoneKey_idx" ON "BlockedPhone"("organizationId", "phoneKey");
CREATE INDEX "Order_organizationId_riskBand_idx" ON "Order"("organizationId", "riskBand");
CREATE INDEX "Order_organizationId_reviewHold_idx" ON "Order"("organizationId", "reviewHold");
