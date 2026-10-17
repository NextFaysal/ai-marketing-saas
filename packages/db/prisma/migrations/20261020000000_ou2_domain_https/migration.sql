-- OU2 (One-Umbrella): Cloudflare for SaaS per-merchant HTTPS state
-- on StorefrontSetting. Written only from real adapter outcomes by
-- the storefront verification hook / manual refresh; httpsStatus is
-- not_configured | pending | active | failed, NULL = never attempted
-- for the current domain. No backfill: existing rows honestly read
-- as "never attempted" until the merchant re-verifies / refreshes.
-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "customHostnameId" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "httpsStatus" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "httpsStatusDetail" TEXT;
ALTER TABLE "StorefrontSetting" ADD COLUMN "httpsUpdatedAt" TIMESTAMP(3);
