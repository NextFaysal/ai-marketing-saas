-- Campaign Builder Frontier NB6: CN13 Click-to-WhatsApp
-- destinations (CampaignAdSet destination columns +
-- CampaignAd.whatsappWelcome) and CN14 Meta conversion
-- feedback (OfflineConversionSetting.datasetId for the
-- Meta dataset + leadFeedbackEnabled opt-in). All changes
-- are additive and nullable/defaulted: a null
-- destinationType is a website ad set exactly as before;
-- pre-existing offline settings keep working untouched
-- (leadFeedbackEnabled defaults false — nothing new is
-- sent anywhere until an org saves a meta setting).
-- NOT run on any real DB from the build sandbox; the full
-- sequence is verified on a fresh Postgres only.

-- AlterTable
ALTER TABLE "CampaignAdSet" ADD COLUMN "destinationType" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "whatsappIntegrationId" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "whatsappPhoneNumberId" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "whatsappPhoneNumber" TEXT;

-- AlterTable
ALTER TABLE "CampaignAd" ADD COLUMN "whatsappWelcome" JSONB;

-- AlterTable
ALTER TABLE "OfflineConversionSetting" ADD COLUMN "datasetId" TEXT;
ALTER TABLE "OfflineConversionSetting" ADD COLUMN "leadFeedbackEnabled" BOOLEAN NOT NULL DEFAULT false;
