-- AB4 (AX5 Checkout Completion + AX6 POS Depth):
--  * BusinessProfile deposit config (AX5a): depositMode
--    (null = off | percent | fixed), depositPercent (1–90),
--    depositFixedMinor (paisa), depositAppliesTo
--    (cod | online | all, default cod), depositNote — the
--    merchant copy shown to the buyer. Sits beside the GB3 COD
--    rule columns the checkout already loads.
--  * Order.depositDueMinor (AX5a): the deposit amount stamped
--    at placement (server-computed); null = no deposit applied.
--    Paid-toward-it is NEVER stamped — it derives from approved
--    PaymentVerifications.
--  * Order.checkoutFields (AX5b): validated custom-field
--    answers (key → string | boolean).
--  * TenantPaymentTransaction.purpose (full | deposit |
--    balance, default "full" — every pre-AB4 row reads as a
--    full payment) + depositVerificationId: the exactly-once
--    claim for the approved PaymentVerification row a verified
--    deposit writes (source "gateway_deposit").
--  * CheckoutFieldDef (AX5b): merchant-defined checkout fields.
--  * PosOfflineSync (AX6b): the server ledger of offline POS
--    sale sync attempts. Additive only — no existing column or
--    table is altered in meaning.

ALTER TABLE "BusinessProfile" ADD COLUMN "depositMode" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "depositPercent" INTEGER;
ALTER TABLE "BusinessProfile" ADD COLUMN "depositFixedMinor" BIGINT;
ALTER TABLE "BusinessProfile" ADD COLUMN "depositAppliesTo" TEXT NOT NULL DEFAULT 'cod';
ALTER TABLE "BusinessProfile" ADD COLUMN "depositNote" TEXT;

ALTER TABLE "Order" ADD COLUMN "depositDueMinor" BIGINT;
ALTER TABLE "Order" ADD COLUMN "checkoutFields" JSONB;

ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "TenantPaymentTransaction" ADD COLUMN "depositVerificationId" TEXT;

CREATE TABLE "CheckoutFieldDef" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutFieldDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutFieldDef_organizationId_key_key" ON "CheckoutFieldDef"("organizationId", "key");
CREATE INDEX "CheckoutFieldDef_organizationId_appliesTo_active_idx" ON "CheckoutFieldDef"("organizationId", "appliesTo", "active");

CREATE TABLE "PosOfflineSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "cashierId" TEXT,
    "localReceiptNo" TEXT,
    "localTotalMinor" BIGINT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "serverOrderId" TEXT,
    "serverTotalMinor" BIGINT,
    "varianceMinor" BIGINT,
    "discardNote" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PosOfflineSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosOfflineSync_organizationId_idempotencyKey_key" ON "PosOfflineSync"("organizationId", "idempotencyKey");
CREATE INDEX "PosOfflineSync_organizationId_status_createdAt_idx" ON "PosOfflineSync"("organizationId", "status", "createdAt");
