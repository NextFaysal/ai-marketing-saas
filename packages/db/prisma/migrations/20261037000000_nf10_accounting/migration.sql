-- NF10 (FB4): Full accounting upgrade — chart of accounts,
-- double-entry journal, and the bank-statement extension of the
-- EXISTING EC26 reconciliation machinery.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style).
--
-- ChartAccount / JournalEntry / JournalLine are new org-scoped
-- tables. JournalEntry carries a UNIQUE (organizationId,
-- sourceType, sourceId): auto-generation is idempotent per
-- source record, and manual entries (sourceId NULL) never
-- collide because Postgres treats NULLs as distinct.
--
-- ReconciliationImport/ReconciliationLine are EXTENDED, never
-- forked: courierIntegrationId becomes nullable (a bank
-- statement has no courier account; every courier row keeps its
-- value), kind defaults to "courier_cod" so all existing rows
-- keep their EC26 meaning, and statement lines ride the same
-- tables with outcome = "statement" + matchState tracking.

CREATE TABLE "ChartAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitMinor" BIGINT NOT NULL DEFAULT 0,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartAccount_organizationId_code_key" ON "ChartAccount"("organizationId", "code");
CREATE UNIQUE INDEX "ChartAccount_organizationId_systemKey_key" ON "ChartAccount"("organizationId", "systemKey");
CREATE INDEX "ChartAccount_organizationId_type_idx" ON "ChartAccount"("organizationId", "type");

CREATE UNIQUE INDEX "JournalEntry_organizationId_sourceType_sourceId_key" ON "JournalEntry"("organizationId", "sourceType", "sourceId");
CREATE INDEX "JournalEntry_organizationId_date_idx" ON "JournalEntry"("organizationId", "date");
CREATE INDEX "JournalEntry_organizationId_sourceType_idx" ON "JournalEntry"("organizationId", "sourceType");

CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

ALTER TABLE "ChartAccount" ADD CONSTRAINT "ChartAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReconciliationImport" ALTER COLUMN "courierIntegrationId" DROP NOT NULL;
ALTER TABLE "ReconciliationImport" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'courier_cod';
ALTER TABLE "ReconciliationImport" ADD COLUMN "accountLabel" TEXT;

ALTER TABLE "ReconciliationLine" ADD COLUMN "statementDate" TIMESTAMP(3);
ALTER TABLE "ReconciliationLine" ADD COLUMN "description" TEXT;
ALTER TABLE "ReconciliationLine" ADD COLUMN "direction" TEXT;
ALTER TABLE "ReconciliationLine" ADD COLUMN "matchState" TEXT NOT NULL DEFAULT 'unmatched';
ALTER TABLE "ReconciliationLine" ADD COLUMN "suggestedRefType" TEXT;
ALTER TABLE "ReconciliationLine" ADD COLUMN "suggestedRefId" TEXT;

CREATE INDEX "ReconciliationLine_organizationId_matchState_idx" ON "ReconciliationLine"("organizationId", "matchState");
