-- CC24/CC25/CC26 (Connect Center Next, B11): gateway refunds,
-- settlement reconciliation, payout automation + payment links.
--
-- PaymentRefund: one gateway refund against one verified
-- TenantPaymentTransaction. Initiation is never proof — only a
-- gateway status query confirming success moves a row to
-- "refunded", and only then do Order.refundedMinor and (for
-- platform-source payments) the Wallet refund_debit move.
--
-- SettlementImport / SettlementRow: a gateway settlement CSV
-- imported by the tenant and matched once, at import time,
-- against verified_paid TenantPaymentTransaction rows. Neither
-- gateway exposes a wired bulk settlement API in this codebase,
-- so nothing is fetched — the file is the source.
--
-- PayoutDestination / PayoutSchedule: saved payout destinations
-- (details masked beyond last 4 in list views) and the org's
-- automatic payout-REQUEST schedule. The wallet_payout_sweep
-- only ever creates pending requests; approve + mark-paid stay
-- human (CC10 chain). PayoutRequest gains destinationId (the
-- request snapshots details at creation) and createdBySystem.
--
-- PaymentLink: a shareable pay link for one order. Only the
-- SHA-256 hash of the bearer token is stored; the plaintext is
-- shown once at creation. Links are live-only.
--
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked in the full fresh-Postgres run).

-- AlterTable
ALTER TABLE "PayoutRequest" ADD COLUMN "destinationId" TEXT;
ALTER TABLE "PayoutRequest" ADD COLUMN "createdBySystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantPaymentTransactionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'own',
    "environment" TEXT NOT NULL DEFAULT 'live',
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "gatewayRefundRef" TEXT,
    "gatewayStatusRaw" JSONB,
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentRefund_organizationId_createdAt_idx" ON "PaymentRefund"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRefund_tenantPaymentTransactionId_status_idx" ON "PaymentRefund"("tenantPaymentTransactionId", "status");

-- CreateIndex
CREATE INDEX "PaymentRefund_organizationId_orderId_idx" ON "PaymentRefund"("organizationId", "orderId");

-- CreateTable
CREATE TABLE "SettlementImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'own',
    "periodLabel" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementImport_organizationId_createdAt_idx" ON "SettlementImport"("organizationId", "createdAt");

-- CreateTable
CREATE TABLE "SettlementRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "rawStatus" TEXT,
    "matchState" TEXT NOT NULL,
    "matchedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementRow_importId_matchState_idx" ON "SettlementRow"("importId", "matchState");

-- CreateIndex
CREATE INDEX "SettlementRow_externalRef_idx" ON "SettlementRow"("externalRef");

-- CreateTable
CREATE TABLE "PayoutDestination" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutDestination_organizationId_isDefault_idx" ON "PayoutDestination"("organizationId", "isDefault");

-- CreateTable
CREATE TABLE "PayoutSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "thresholdMinor" BIGINT NOT NULL DEFAULT 0,
    "destinationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutSchedule_organizationId_key" ON "PayoutSchedule"("organizationId");

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'own',
    "environment" TEXT NOT NULL DEFAULT 'live',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_tokenHash_key" ON "PaymentLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PaymentLink_organizationId_orderId_idx" ON "PaymentLink"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "PaymentLink_organizationId_status_idx" ON "PaymentLink"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_tenantPaymentTransactionId_fkey" FOREIGN KEY ("tenantPaymentTransactionId") REFERENCES "TenantPaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementImport" ADD CONSTRAINT "SettlementImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRow" ADD CONSTRAINT "SettlementRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SettlementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutDestination" ADD CONSTRAINT "PayoutDestination_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutSchedule" ADD CONSTRAINT "PayoutSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
