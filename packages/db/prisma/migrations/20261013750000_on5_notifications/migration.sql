-- ON5 (Transactional Notification Engine): per-org notification
-- settings (one row per org, config Json merged over in-code
-- defaults on read) + per-order notification attempt/skip log.
-- All additive. OrderNotificationSetting uses scalar-id style
-- (like FraudShieldSetting); OrderNotificationLog carries an
-- Order relation like OrderComment.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "OrderNotificationSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderNotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderNotificationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderNotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderNotificationSetting_organizationId_key" ON "OrderNotificationSetting"("organizationId");
CREATE INDEX "OrderNotificationLog_organizationId_orderId_idx" ON "OrderNotificationLog"("organizationId", "orderId");
CREATE INDEX "OrderNotificationLog_organizationId_orderId_event_status_idx" ON "OrderNotificationLog"("organizationId", "orderId", "event", "status");

-- AddForeignKey
ALTER TABLE "OrderNotificationLog" ADD CONSTRAINT "OrderNotificationLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
