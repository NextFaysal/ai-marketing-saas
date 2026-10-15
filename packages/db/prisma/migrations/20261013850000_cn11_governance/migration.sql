-- Campaign Builder Next CN11: governance — plan versions,
-- two-step approval chain, hub saved views.
-- Additive only: two nullable columns on CampaignPlan,
-- three new tables, no changes to existing data.
ALTER TABLE "CampaignPlan" ADD COLUMN "firstApproverId" TEXT;
ALTER TABLE "CampaignPlan" ADD COLUMN "firstApprovedAt" TIMESTAMP(3);

CREATE TABLE "CampaignPlanVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPlanVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignPlanVersion_planId_createdAt_idx" ON "CampaignPlanVersion"("planId", "createdAt");

CREATE TABLE "CampaignApprovalSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "twoStepApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignApprovalSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignApprovalSetting_organizationId_key" ON "CampaignApprovalSetting"("organizationId");

CREATE TABLE "CampaignSavedView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSavedView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignSavedView_organizationId_userId_idx" ON "CampaignSavedView"("organizationId", "userId");
