-- StorefrontSetting marketing tracking fields: Meta Pixel, TikTok Pixel, Microsoft Clarity. All additive.
ALTER TABLE "StorefrontSetting" ADD COLUMN IF NOT EXISTS "metaPixelId" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN IF NOT EXISTS "tikTokPixelId" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN IF NOT EXISTS "clarityId" TEXT;
