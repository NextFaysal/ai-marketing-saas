-- Milestone 16: Phase E (courier, payment verification, transcription)
ALTER TABLE "Order" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "transcription" TEXT;
ALTER TABLE "ChannelMessage" ADD COLUMN "transcriptionProvider" TEXT;

CREATE TABLE "CourierShipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "consignmentId" TEXT,
    "trackingCode" TEXT,
    "invoice" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_review',
    "codAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "lastNotifiedStatus" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourierShipment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CourierShipment_organizationId_orderId_idx" ON "CourierShipment"("organizationId", "orderId");
CREATE INDEX "CourierShipment_organizationId_status_idx" ON "CourierShipment"("organizationId", "status");

CREATE TABLE "PaymentVerification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "provider" TEXT,
    "trxId" TEXT,
    "amountMinor" BIGINT,
    "expectedAmountMinor" BIGINT,
    "verdict" TEXT NOT NULL,
    "flags" JSONB,
    "rawExtraction" JSONB,
    "modelProvider" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentVerification_messageId_key" ON "PaymentVerification"("messageId");
CREATE INDEX "PaymentVerification_organizationId_trxId_idx" ON "PaymentVerification"("organizationId", "trxId");
