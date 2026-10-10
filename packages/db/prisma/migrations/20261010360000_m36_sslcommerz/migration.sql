-- Milestone 36 (Phase N1): SSLCommerz plan checkouts.
CREATE TABLE "PlanCheckout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "tranId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "valId" TEXT,
    "gatewayDetail" JSONB,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanCheckout_tranId_key" ON "PlanCheckout"("tranId");
CREATE INDEX "PlanCheckout_organizationId_idx" ON "PlanCheckout"("organizationId");
