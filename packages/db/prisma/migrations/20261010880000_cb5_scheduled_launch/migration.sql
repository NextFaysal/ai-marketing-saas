-- Campaign Builder CB5: scheduled launch for approved plans.
ALTER TABLE "CampaignPlan" ADD COLUMN "publishAt" TIMESTAMP(3);
