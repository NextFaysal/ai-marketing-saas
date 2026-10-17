-- OU8 (One-Umbrella): storefront freedom — section customizer
-- fields on StorefrontSetting + lead-capture mode on StorePopup.
-- All additive with defaults; existing rows keep today's rendering
-- (every new toggle defaults ON, sectionOrder NULL = canonical
-- order, popup mode defaults to the original "promo").

ALTER TABLE "StorefrontSetting" ADD COLUMN "showHero" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontSetting" ADD COLUMN "showBrands" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontSetting" ADD COLUMN "showBundles" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontSetting" ADD COLUMN "showFlashSale" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontSetting" ADD COLUMN "showRecentlyViewed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorefrontSetting" ADD COLUMN "sectionOrder" JSONB;

ALTER TABLE "StorePopup" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'promo';
ALTER TABLE "StorePopup" ADD COLUMN "captureName" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorePopup" ADD COLUMN "capturePhone" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StorePopup" ADD COLUMN "captureEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StorePopup" ADD COLUMN "successMessage" TEXT;
ALTER TABLE "StorePopup" ADD COLUMN "captures" INTEGER NOT NULL DEFAULT 0;
