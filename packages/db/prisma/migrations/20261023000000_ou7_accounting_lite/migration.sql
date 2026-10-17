-- OU7 (One-Umbrella): accounting-lite — chart of accounts, derived
-- journal (entries + lines) and bank statement lines for manual
-- reconciliation. All tables are new; no existing table is altered
-- and nothing is backfilled: journal entries are created only when
-- the merchant runs posting (idempotency-keyed per source record),
-- and bank lines start "unmatched" until a human confirms a match.

-- CreateTable
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normalSide" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ou7JournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ou7JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ou7JournalLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debitMinor" BIGINT NOT NULL DEFAULT 0,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ou7JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedSourceType" TEXT,
    "matchedSourceId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceAccount_organizationId_active_idx" ON "FinanceAccount"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAccount_organizationId_code_key" ON "FinanceAccount"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Ou7JournalEntry_organizationId_entryDate_idx" ON "Ou7JournalEntry"("organizationId", "entryDate");

-- CreateIndex
CREATE INDEX "Ou7JournalEntry_organizationId_sourceType_idx" ON "Ou7JournalEntry"("organizationId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "Ou7JournalEntry_organizationId_idempotencyKey_key" ON "Ou7JournalEntry"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Ou7JournalLine_organizationId_entryId_idx" ON "Ou7JournalLine"("organizationId", "entryId");

-- CreateIndex
CREATE INDEX "Ou7JournalLine_organizationId_accountCode_idx" ON "Ou7JournalLine"("organizationId", "accountCode");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_status_idx" ON "BankStatementLine"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_statementDate_idx" ON "BankStatementLine"("organizationId", "statementDate");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_importId_idx" ON "BankStatementLine"("organizationId", "importId");

-- AddForeignKey
ALTER TABLE "Ou7JournalLine" ADD CONSTRAINT "Ou7JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Ou7JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
