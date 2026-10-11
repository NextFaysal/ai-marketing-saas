-- Migration: Add order bump fields to Product and Meta Pixel / Custom Domain to BusinessProfile

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "bumpTitle" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "bumpPriceMinor" BIGINT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "bumpImageUrl" TEXT;

ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "metaPixelId" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "metaCapiToken" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "tikTokPixelId" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN IF NOT EXISTS "customDomain" TEXT;
