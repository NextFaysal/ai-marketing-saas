-- Milestone 22: Phase J (published-object status sync, audience membership)
ALTER TABLE "CampaignPlan" ADD COLUMN "metaEffectiveStatus" TEXT;
ALTER TABLE "CampaignPlan" ADD COLUMN "lastStatusSyncAt" TIMESTAMP(3);
ALTER TABLE "CampaignAdSet" ADD COLUMN "effectiveStatus" TEXT;
ALTER TABLE "CampaignAd" ADD COLUMN "effectiveStatus" TEXT;
ALTER TABLE "CampaignAd" ADD COLUMN "issuesInfo" JSONB;
ALTER TABLE "AudienceRecord" ADD COLUMN "lastMembershipSyncAt" TIMESTAMP(3);
ALTER TABLE "AudienceRecord" ADD COLUMN "lastMembershipCount" INTEGER;
