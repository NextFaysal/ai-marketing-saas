-- Campaign Builder CB2: optional plan-level daily budget cap.
ALTER TABLE "CampaignPlan" ADD COLUMN "dailyBudgetCapMinor" BIGINT;
