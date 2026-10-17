-- Campaign Builder Advanced CA23 (CB6): Advantage+ truth.
-- (1) CampaignPlan gains Meta's own Advantage+ read-back:
-- after an Advantage+ publish the service GETs the
-- campaign's advantage_state_info and stores Meta's
-- verdict verbatim (the local advantagePlus flag remains
-- only the merchant's intent). (2) CampaignAdSet gains
-- the app-promotion pair (application id + store URL)
-- that publish sends as promoted_object for the new
-- OUTCOME_APP_PROMOTION objective. All additive nullable.
ALTER TABLE "CampaignPlan" ADD COLUMN IF NOT EXISTS "advantageState" TEXT;
ALTER TABLE "CampaignPlan" ADD COLUMN IF NOT EXISTS "advantageStateInfo" JSONB;
ALTER TABLE "CampaignPlan" ADD COLUMN IF NOT EXISTS "advantageStateCheckedAt" TIMESTAMP(3);

ALTER TABLE "CampaignAdSet" ADD COLUMN IF NOT EXISTS "appId" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN IF NOT EXISTS "appStoreUrl" TEXT;
