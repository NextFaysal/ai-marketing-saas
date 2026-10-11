-- Referral Advanced R1: reward facts on Referral + the credit ledger.
ALTER TABLE "Referral" ADD COLUMN "refereeBonusMinor" BIGINT;
ALTER TABLE "Referral" ADD COLUMN "firstPaymentMinor" BIGINT;
ALTER TABLE "Referral" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'user';
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deltaMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "referralId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditLedger_organizationId_createdAt_idx" ON "CreditLedger"("organizationId", "createdAt");
