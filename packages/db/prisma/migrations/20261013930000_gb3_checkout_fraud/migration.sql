-- GB3 (GC8 Checkout Trust + GC9 Fraud Hardening): terms-consent
-- + COD rule columns, FraudShieldSetting gate policy + Turnstile
-- CAPTCHA columns, and the IdempotencyRecord / BlockedIdentifier
-- / TrustedIdentifier / FraudAttemptLog / FraudRule /
-- FraudRuleHit tables. The new tables use the scalar-id style
-- (no Organization FK), matching FraudShieldSetting /
-- BlockedPhone precedent — see schema.prisma.
-- All additive: new columns carry defaults or are nullable; the
-- six new tables are fresh.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "requireTermsConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "termsUrl" TEXT;

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN "codMaxOrderMinor" BIGINT,
ADD COLUMN "codBlockedDistricts" JSONB,
ADD COLUMN "codAdvanceRequiredAboveMinor" BIGINT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "termsConsentedAt" TIMESTAMP(3),
ADD COLUMN "termsRef" TEXT,
ADD COLUMN "codAdvanceRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FraudShieldSetting" ADD COLUMN "openOrderPolicy" TEXT NOT NULL DEFAULT 'off',
ADD COLUMN "openOrderWindowHours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN "waitingPeriodMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxOrdersPerPhonePerDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "turnstileSiteKey" TEXT,
ADD COLUMN "turnstileSecretEncrypted" TEXT,
ADD COLUMN "captchaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "captchaOnCheckout" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "captchaOnOtp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "orderId" TEXT,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedIdentifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedIdentifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustedIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAttemptLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identifierSummary" TEXT NOT NULL,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "tagValue" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudRuleHit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "orderId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudRuleHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_key_key" ON "IdempotencyRecord"("organizationId", "key");
CREATE INDEX "IdempotencyRecord_organizationId_createdAt_idx" ON "IdempotencyRecord"("organizationId", "createdAt");
CREATE UNIQUE INDEX "BlockedIdentifier_organizationId_kind_matchKey_key" ON "BlockedIdentifier"("organizationId", "kind", "matchKey");
CREATE INDEX "BlockedIdentifier_organizationId_kind_idx" ON "BlockedIdentifier"("organizationId", "kind");
CREATE UNIQUE INDEX "TrustedIdentifier_organizationId_kind_matchKey_key" ON "TrustedIdentifier"("organizationId", "kind", "matchKey");
CREATE INDEX "TrustedIdentifier_organizationId_kind_idx" ON "TrustedIdentifier"("organizationId", "kind");
CREATE INDEX "FraudAttemptLog_organizationId_createdAt_idx" ON "FraudAttemptLog"("organizationId", "createdAt");
CREATE INDEX "FraudAttemptLog_organizationId_kind_idx" ON "FraudAttemptLog"("organizationId", "kind");
CREATE INDEX "FraudRule_organizationId_idx" ON "FraudRule"("organizationId");
CREATE INDEX "FraudRuleHit_organizationId_ruleId_idx" ON "FraudRuleHit"("organizationId", "ruleId");
CREATE INDEX "FraudRuleHit_organizationId_orderId_idx" ON "FraudRuleHit"("organizationId", "orderId");
