-- Campaign Builder Next NB3 (CN5): creative v2 on CampaignAd.
-- All additive Json columns; existing ads keep their exact
-- pre-CN5 behaviour (null = legacy single-text, no placement
-- overrides, no enhancement toggles). CN6 needs no schema:
-- AudienceRecord.source is a free string and the new studio
-- sources (buyers / recent_purchasers / product_viewers /
-- cart_abandoners) ride the existing rows.
ALTER TABLE "CampaignAd" ADD COLUMN "textOptions" JSONB;
ALTER TABLE "CampaignAd" ADD COLUMN "placementAssets" JSONB;
ALTER TABLE "CampaignAd" ADD COLUMN "creativeEnhancements" JSONB;
