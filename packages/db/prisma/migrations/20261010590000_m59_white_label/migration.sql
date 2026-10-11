-- Milestone 59: Agency White-Label v1 — per-organization branding.
-- Additive nullable columns only; existing rows keep platform defaults.
ALTER TABLE "Organization" ADD COLUMN "brandName" TEXT;
ALTER TABLE "Organization" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN "logoContentType" TEXT;
ALTER TABLE "Organization" ADD COLUMN "primaryColor" TEXT;
ALTER TABLE "Organization" ADD COLUMN "customDomain" TEXT;
