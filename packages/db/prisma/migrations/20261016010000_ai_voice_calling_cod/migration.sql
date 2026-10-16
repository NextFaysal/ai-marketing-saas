-- CreateTable
CREATE TABLE "VoiceCallSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoCallNewCod" BOOLEAN NOT NULL DEFAULT false,
    "delayMinutes" INTEGER NOT NULL DEFAULT 2,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "twilioAccountSid" TEXT,
    "twilioAuthToken" TEXT,
    "twilioCallerId" TEXT,
    "promptIntro" TEXT,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "retryIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceCallSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderVoiceCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "callSid" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "digitsPressed" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "speechPrompt" TEXT,
    "recordingUrl" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderVoiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCallSetting_organizationId_key" ON "VoiceCallSetting"("organizationId");
CREATE INDEX "VoiceCallSetting_organizationId_enabled_idx" ON "VoiceCallSetting"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "OrderVoiceCall_callSid_key" ON "OrderVoiceCall"("callSid");
CREATE INDEX "OrderVoiceCall_organizationId_createdAt_idx" ON "OrderVoiceCall"("organizationId", "createdAt");
CREATE INDEX "OrderVoiceCall_organizationId_orderId_idx" ON "OrderVoiceCall"("organizationId", "orderId");
CREATE INDEX "OrderVoiceCall_orderId_status_idx" ON "OrderVoiceCall"("orderId", "status");

-- AddForeignKey
ALTER TABLE "VoiceCallSetting" ADD CONSTRAINT "VoiceCallSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderVoiceCall" ADD CONSTRAINT "OrderVoiceCall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderVoiceCall" ADD CONSTRAINT "OrderVoiceCall_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
