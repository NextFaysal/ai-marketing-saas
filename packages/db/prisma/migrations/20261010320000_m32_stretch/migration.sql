-- Milestone 32: Advantage+ sales flag on campaign plans
ALTER TABLE "CampaignPlan" ADD COLUMN "advantagePlus" BOOLEAN NOT NULL DEFAULT false;
