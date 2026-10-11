-- Campaign Builder CB4: submission snapshot + plan comments.
ALTER TABLE "CampaignPlan" ADD COLUMN "submissionSnapshot" JSONB;

CREATE TABLE "CampaignPlanComment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignPlanComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CampaignPlanComment_planId_createdAt_idx" ON "CampaignPlanComment"("planId", "createdAt");
