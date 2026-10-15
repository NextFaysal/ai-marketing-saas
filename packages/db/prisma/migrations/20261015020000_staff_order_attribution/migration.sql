-- AlterTable
ALTER TABLE "Order" ADD COLUMN "agentId" TEXT,
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "commissionMinor" BIGINT NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Order_organizationId_agentId_idx" ON "Order"("organizationId", "agentId");
