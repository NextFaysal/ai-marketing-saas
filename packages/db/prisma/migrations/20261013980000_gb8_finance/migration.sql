-- GB8 (GC19 Reports Completion + GC20 Finance Completion):
--  * Expense: one staff-recorded business expense (fixed category
--    vocabulary enforced at the service DTO; amountMinor BIGINT
--    paisa; spentAt = Dhaka-midnight instant of the chosen date).
--  * ScheduledReport + ScheduledReportRun: recurring email
--    delivery of the GC19 reports (+ ON7 profit). lastRunAt is
--    stamped inside a run before delivery (exactly-once stance);
--    a run is "sent" only when EmailProvider returns a message
--    id for at least one recipient.
--  * ReconciliationImport.mismatchAlertedAt: the GC20 settlement
--    mismatch alert fires exactly once per import batch.
-- All additive: existing rows keep the new column NULL.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "ReconciliationImport" ADD COLUMN "mismatchAlertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "paymentMethod" TEXT,
    "receiptUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "recipients" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReportRun" (
    "id" TEXT NOT NULL,
    "scheduledReportId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "testRun" BOOLEAN NOT NULL DEFAULT false,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_organizationId_spentAt_idx" ON "Expense"("organizationId", "spentAt");

-- CreateIndex
CREATE INDEX "Expense_organizationId_category_spentAt_idx" ON "Expense"("organizationId", "category", "spentAt");

-- CreateIndex
CREATE INDEX "ScheduledReport_organizationId_enabled_idx" ON "ScheduledReport"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "ScheduledReportRun_scheduledReportId_createdAt_idx" ON "ScheduledReportRun"("scheduledReportId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledReportRun_organizationId_createdAt_idx" ON "ScheduledReportRun"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ScheduledReportRun" ADD CONSTRAINT "ScheduledReportRun_scheduledReportId_fkey" FOREIGN KEY ("scheduledReportId") REFERENCES "ScheduledReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
