-- CB3 (Campaign Builder Advanced, CA10 + CA12 + CA13) — migration
-- claim 20261030200000 (CB3's single migration; CB1 used
-- 20261030000000, CB2 used 20261030100000). All additive:
--
-- CA10: AutomationRule.mode (execute | suggest) — the DB
-- default is "execute" so every pre-CA10 rule keeps executing
-- exactly as before; the SERVICE defaults NEW rules to
-- "suggest". RuleSuggestion is the approval queue: a
-- suggest-mode trigger stores the action it would have taken
-- plus its evidence; nothing executes until a human approves.
--
-- CA12: CampaignPlan pause window (pauseAt / resumeAt) with
-- exactly-once execution stamps, run by the per-org
-- plan_schedule_sweep automation job.
--
-- CA13: BusinessProfile.campaignNamingTemplate — the org's
-- naming convention (tokens {product} {audience} {objective}
-- {date} {platform}). Null = no convention.
ALTER TABLE "AutomationRule" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'execute';

CREATE TABLE "RuleSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "campaignPlanId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionPayload" JSONB,
    "reason" TEXT NOT NULL,
    "facts" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RuleSuggestion_organizationId_status_createdAt_idx" ON "RuleSuggestion"("organizationId", "status", "createdAt");

CREATE INDEX "RuleSuggestion_ruleId_campaignPlanId_status_idx" ON "RuleSuggestion"("ruleId", "campaignPlanId", "status");

ALTER TABLE "RuleSuggestion" ADD CONSTRAINT "RuleSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignPlan" ADD COLUMN "pauseAt" TIMESTAMP(3);
ALTER TABLE "CampaignPlan" ADD COLUMN "resumeAt" TIMESTAMP(3);
ALTER TABLE "CampaignPlan" ADD COLUMN "pauseExecutedAt" TIMESTAMP(3);
ALTER TABLE "CampaignPlan" ADD COLUMN "resumeExecutedAt" TIMESTAMP(3);

ALTER TABLE "BusinessProfile" ADD COLUMN "campaignNamingTemplate" TEXT;
