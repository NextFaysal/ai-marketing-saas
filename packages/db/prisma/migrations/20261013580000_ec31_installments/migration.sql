-- EC31 (Installment / কিস্তি Plans): installment plans + items
-- over an order's amount due, and the PaymentVerification link
-- that makes a collection the SAME approved record the EC19 due
-- math sums. All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable: a verification row may collect one installment item
ALTER TABLE "PaymentVerification" ADD COLUMN "installmentItemId" TEXT;

-- CreateIndex
CREATE INDEX "PaymentVerification_organizationId_installmentItemId_idx" ON "PaymentVerification"("organizationId", "installmentItemId");

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstallmentPlan_organizationId_status_idx" ON "InstallmentPlan"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_orderId_key" ON "InstallmentPlan"("orderId");

-- CreateTable
CREATE TABLE "InstallmentItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "dueSoonRemindedAt" TIMESTAMP(3),
    "dueSoonRemindStatus" TEXT,
    "overdueRemindedAt" TIMESTAMP(3),
    "overdueRemindStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstallmentItem_planId_idx" ON "InstallmentItem"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentItem_planId_seq_key" ON "InstallmentItem"("planId", "seq");

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentItem" ADD CONSTRAINT "InstallmentItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
