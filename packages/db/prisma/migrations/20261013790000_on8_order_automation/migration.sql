-- ON8 (Orders Automation Studio): merchant no-code if/then
-- rules over ORDER operations (dedicated engine — the
-- WorkflowsService vocabulary is lead/conversation-scoped
-- and cannot express order hold/assign/tag or the
-- parcel-stuck / due-overdue time triggers).
-- OrderAutomationRule holds the rule (trigger + triggerConfig
-- + conditions + ordered actions, all validated in the
-- service against the ON8 vocabulary); OrderAutomationLog is
-- one row per firing, and its (ruleId, orderId, triggerKey)
-- unique is the exactly-once guard. Scalar-id style like
-- FraudShieldSetting; the log carries a Rule relation.
-- All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- CreateTable
CREATE TABLE "OrderAutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "triggerConfig" JSONB,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "presetKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAutomationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "actionsResult" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAutomationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderAutomationRule_organizationId_enabled_trigger_idx" ON "OrderAutomationRule"("organizationId", "enabled", "trigger");
CREATE UNIQUE INDEX "OrderAutomationLog_ruleId_orderId_triggerKey_key" ON "OrderAutomationLog"("ruleId", "orderId", "triggerKey");
CREATE INDEX "OrderAutomationLog_organizationId_ruleId_createdAt_idx" ON "OrderAutomationLog"("organizationId", "ruleId", "createdAt");
CREATE INDEX "OrderAutomationLog_organizationId_orderId_createdAt_idx" ON "OrderAutomationLog"("organizationId", "orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderAutomationLog" ADD CONSTRAINT "OrderAutomationLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "OrderAutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
