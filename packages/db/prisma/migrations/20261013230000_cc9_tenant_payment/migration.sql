-- CC8 + CC9 (Connect Center, Senders/AI keys + the tenant's OWN
-- payment gateway): OrgLlmConfig (per-org LLM key, CC8) +
-- TenantPaymentGateway / TenantPaymentTransaction (CC9). All
-- additive — no existing table is altered. Money through a
-- TenantPaymentGateway settles DIRECTLY to the tenant's merchant
-- account; platform payment + wallet is CC10 and is NOT here.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013220000_cc3_tenant_app_config).

-- CreateTable
CREATE TABLE "OrgLlmConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "encryptedData" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgLlmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgLlmConfig_organizationId_idx" ON "OrgLlmConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgLlmConfig_organizationId_key" ON "OrgLlmConfig"("organizationId");

-- AddForeignKey
ALTER TABLE "OrgLlmConfig" ADD CONSTRAINT "OrgLlmConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TenantPaymentGateway" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantPaymentGateway_organizationId_idx" ON "TenantPaymentGateway"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPaymentGateway_organizationId_provider_key" ON "TenantPaymentGateway"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "TenantPaymentGateway" ADD CONSTRAINT "TenantPaymentGateway_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TenantPaymentTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "providerTxnId" TEXT,
    "valId" TEXT,
    "ipnPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantPaymentTransaction_organizationId_orderId_idx" ON "TenantPaymentTransaction"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "TenantPaymentTransaction_providerTxnId_idx" ON "TenantPaymentTransaction"("providerTxnId");

-- AddForeignKey
ALTER TABLE "TenantPaymentTransaction" ADD CONSTRAINT "TenantPaymentTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPaymentTransaction" ADD CONSTRAINT "TenantPaymentTransaction_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "TenantPaymentGateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
