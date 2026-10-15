-- CC10 (Connect Center, Platform Payment + Wallet):
-- TenantPaymentTransaction gains a `source` marker ("own" = CC9
-- tenant gateway, "platform" = CC10 platform gateway) and its
-- gatewayId becomes nullable (platform transactions have no
-- tenant gateway row — the platform's credentials live only in
-- the admin platform config). New tables: PlatformPaymentEnablement
-- (the tenant's per-provider choice to accept platform payments;
-- stores NO secret), WalletAccount + WalletTransaction (the
-- append-only wallet ledger) and PayoutRequest.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013230000_cc9_tenant_payment).

-- AlterTable
ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'own';
ALTER TABLE "TenantPaymentTransaction" ALTER COLUMN "gatewayId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PlatformPaymentEnablement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPaymentEnablement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformPaymentEnablement_organizationId_idx" ON "PlatformPaymentEnablement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPaymentEnablement_organizationId_provider_key" ON "PlatformPaymentEnablement"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "PlatformPaymentEnablement" ADD CONSTRAINT "PlatformPaymentEnablement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "balanceMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletAccount_organizationId_idx" ON "WalletAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_organizationId_key" ON "WalletAccount"("organizationId");

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "balanceAfterMinor" BIGINT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletTransaction_organizationId_createdAt_idx" ON "WalletTransaction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_refType_refId_idx" ON "WalletTransaction"("refType", "refId");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "payoutRef" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutRequest_organizationId_status_idx" ON "PayoutRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PayoutRequest_status_createdAt_idx" ON "PayoutRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
