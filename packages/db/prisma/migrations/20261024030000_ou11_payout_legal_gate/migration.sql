-- OU11 (One-Umbrella, OB6): payout automation with the LEGAL
-- GATE encoded. Two new tables; no existing table is altered.
--
-- "PayoutLegalGate" is the platform-level record where a SUPER
-- admin records that the wallet legal review (holding tenant
-- funds in the platform wallet — the Connect Center program's
-- OPEN legal item) has been completed: who confirmed it, when,
-- and the reference (reviewer / law firm / memo). Payout
-- AUTOMATION stays OFF until this record carries a confirmation
-- AND the separate automationEnabled switch is turned on
-- (default false). The record does not replace the review — it
-- records it. The existing MANUAL admin mark-paid process is
-- not gated by this table and is unchanged.
--
-- "PayoutExecution" is one disbursement execution on the v1
-- bank-instruction rail (no bKash disbursement API is evidenced
-- in this codebase; the bKash clients wire tokenized checkout
-- only). Created only from an APPROVED payout and only while
-- the gate is open; confirmation completes the payout through
-- the EXISTING bookkeeping (admin mark-paid ledger debit for
-- wallet payouts, AffiliatePayout create + FIFO flip for
-- affiliate payouts) — never a parallel ledger.

-- CreateTable
CREATE TABLE "PayoutLegalGate" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "legalConfirmedById" TEXT,
    "legalConfirmedAt" TIMESTAMP(3),
    "legalReference" TEXT,
    "legalNote" TEXT,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "automationEnabledById" TEXT,
    "automationEnabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutLegalGate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutLegalGate_scope_key" ON "PayoutLegalGate"("scope");

-- CreateTable
CREATE TABLE "PayoutExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "payoutRequestId" TEXT,
    "partnerId" TEXT,
    "affiliatePayoutId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "rail" TEXT NOT NULL DEFAULT 'bank_instruction',
    "status" TEXT NOT NULL DEFAULT 'instruction_issued',
    "instructionRef" TEXT NOT NULL,
    "bankReference" TEXT,
    "failureReason" TEXT,
    "issuedById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "failedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutExecution_payoutRequestId_key" ON "PayoutExecution"("payoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutExecution_instructionRef_key" ON "PayoutExecution"("instructionRef");

-- CreateIndex
CREATE INDEX "PayoutExecution_organizationId_status_idx" ON "PayoutExecution"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PayoutExecution_organizationId_partnerId_status_idx" ON "PayoutExecution"("organizationId", "partnerId", "status");

-- AddForeignKey
ALTER TABLE "PayoutExecution" ADD CONSTRAINT "PayoutExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
