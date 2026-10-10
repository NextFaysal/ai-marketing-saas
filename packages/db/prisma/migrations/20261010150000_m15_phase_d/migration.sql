-- Milestone 15: Phase D (workflow waits/branches, order-taking bot)
ALTER TABLE "WorkflowRun" ADD COLUMN "resumeAt" TIMESTAMP(3);
ALTER TABLE "WorkflowRun" ADD COLUMN "nextStepIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InboxSetting" ADD COLUMN "botEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxSetting" ADD COLUMN "botDeliveryChargeMinor" INTEGER;

CREATE TABLE "BotSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BotSession_conversationId_key" ON "BotSession"("conversationId");
CREATE INDEX "BotSession_organizationId_status_idx" ON "BotSession"("organizationId", "status");
