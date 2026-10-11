-- Billing Package B4: bKash auto-renew agreement (sealed id).
CREATE TABLE "AutoRenewAgreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL DEFAULT 'bkash',
    "agreementIdSealed" TEXT,
    "payerReference" TEXT NOT NULL,
    "pendingPaymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastChargeAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutoRenewAgreement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutoRenewAgreement_organizationId_key" ON "AutoRenewAgreement"("organizationId");
