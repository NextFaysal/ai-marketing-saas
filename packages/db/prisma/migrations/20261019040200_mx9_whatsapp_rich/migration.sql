-- MX9: WhatsApp Commerce & Rich v2.
-- Additive only, no backfill:
--   MessagingSenderConfig.whatsapp{Marketing,Utility,Authentication}
--     CostPerMessageMinor — OPTIONAL org-entered per-category
--     WhatsApp rates (minor units). NULL = not set; estimates for a
--     template of that category then fall back to the org's flat
--     whatsappCostPerMessageMinor, and to NO estimate when that is
--     also null. A price is never derived from Meta.
--   MessagingSetting.whatsappQualityGuardEnabled — when TRUE, new
--     broadcast sends are refused for a template whose real
--     Meta-synced qualityRating is "RED" or whose status is
--     "REJECTED". Default FALSE = pre-MX9 behaviour; a template
--     with no synced quality data is never blocked.
ALTER TABLE "MessagingSenderConfig" ADD COLUMN "whatsappMarketingCostPerMessageMinor" INTEGER;
ALTER TABLE "MessagingSenderConfig" ADD COLUMN "whatsappUtilityCostPerMessageMinor" INTEGER;
ALTER TABLE "MessagingSenderConfig" ADD COLUMN "whatsappAuthenticationCostPerMessageMinor" INTEGER;
ALTER TABLE "MessagingSetting" ADD COLUMN "whatsappQualityGuardEnabled" BOOLEAN NOT NULL DEFAULT false;
